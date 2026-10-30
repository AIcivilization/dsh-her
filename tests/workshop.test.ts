import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clipPrompt, customClip, describe, isAdult, minimaxTask, newProject, newScene, plannedClips, presetClips, referencePrompt, screenColor, validateProject,
} from '../src/core/workshop.ts'
import { examples, exportProject, importProject, listProjects, prepareImport, projectStatus, saveProject } from '../src/dsh/workshop.ts'

test('the card becomes one sentence, used in every prompt', () => {
  const project = newProject('p1', '居家眼镜')
  project.card = { ...project.card, accessories: '细框眼镜', outfit: '棕色吊带和米白短裙' }
  const sentence = describe(project.card)
  assert.match(sentence, /^二十多岁的成年女性，自然肤色皮肤，深棕色长卷发，戴细框眼镜，穿棕色吊带和米白短裙，身材匀称$/)
  const clip = project.desk.clips[0]!
  assert.ok(clipPrompt(project, 'desk', clip).includes(sentence))
  assert.ok(referencePrompt(project).startsWith(sentence))
  // The user's own sentence wins.
  project.card.sentence = '戴眼镜的插画师'
  assert.equal(describe(project.card), '戴眼镜的插画师')
})

test('rules differ for the desk pet and scenes', () => {
  const project = newProject('p1', '测试')
  const scene = newScene('s1', '卧室', 'sit')
  assert.match(clipPrompt(project, 'desk', project.desk.clips[0]!), /纯绿色背景/)
  const sceneClip = clipPrompt(project, 'scene', scene.clips[0]!, scene)
  assert.match(sceneClip, /在卧室里坐着/)
  assert.doesNotMatch(sceneClip, /绿色/)
})

test('green clothes get a grey screen', () => {
  const project = newProject('p1', '测试')
  assert.equal(screenColor(project.card).hex, '#00B140')
  project.card.outfit = '墨绿色毛衣'
  assert.equal(screenColor(project.card).hex, '#808080')
})

test('presets: the minimum ticked, the rest offered; custom clips get their own names', () => {
  const clips = presetClips('sit')
  assert.deepEqual(clips.filter(c => c.required).map(c => c.file), ['sit_idle_01', 'sit_talk_01', 'sit_talk_02'])
  assert.ok(clips.filter(c => !c.required).every(c => c.off === true))
  assert.match(clips[0]!.action, /坐着/)
  const one = customClip('sit', clips, '翻一页书')
  assert.equal(one.file, 'sit_act1_01')
  assert.equal(customClip('sit', [...clips, one], '喝口茶').file, 'sit_act2_01')
})

test('only adults', () => {
  assert.equal(isAdult('二十多岁'), true)
  assert.equal(isAdult('25 岁'), true)
  assert.equal(isAdult('16岁'), false)
  assert.equal(isAdult('少女'), false)
  const project = newProject('p1', '测试')
  project.card.age = '十六岁'
  assert.throws(() => validateProject(project), /成年/)
})

test('the task lists every ticked clip with its first frame and destination', () => {
  const project = newProject('p1', '测试')
  project.scenes.push(newScene('s1', '卧室'))
  const planned = plannedClips(project)
  assert.equal(planned.length, 6)
  const task = minimaxTask(project, '/root')
  assert.match(task, /首帧：`\/root\/参考图\.png`/)
  assert.match(task, /保存到：`\/root\/场景-卧室\/stand_talk_02\.mp4`/)
  assert.match(task, /Hailuo-2\.3/)
})

test('saving writes the folders and prompts; status follows the files', () => {
  const root = mkdtempSync(join(tmpdir(), 'her-workshop-'))
  try {
    const project = newProject('p1', '居家')
    project.scenes.push(newScene('s1', '卧室'))
    const saved = saveProject(project, { width: 3024, height: 1964 }, root)
    const dir = saved.status.dir
    for (const file of ['形象.json', '参考图提示词.txt', 'MiniMax生成任务.md', '桌宠/提示词.txt', '场景-卧室/提示词.txt', '场景-卧室/照片提示词.txt']) {
      assert.ok(existsSync(join(dir, file)), file)
    }
    assert.match(readFileSync(join(dir, '场景-卧室/照片提示词.txt'), 'utf8'), /3024×1964/)
    assert.equal(saved.status.importable, false)

    // The desk pet's minimum and the reference picture: importable.
    for (const f of ['stand_idle_01', 'stand_talk_01', 'stand_talk_02']) writeFileSync(join(dir, '桌宠', `${f}.mp4`), '')
    writeFileSync(join(dir, '参考图.png'), '')
    const status = projectStatus(project, dir)
    assert.deepEqual(status.parts.map(p => [p.name, p.made, p.enough, p.framed]), [['桌宠', 3, true, undefined], ['卧室', 0, false, false]])
    assert.equal(status.importable, true)
    prepareImport(project, dir)
    assert.ok(existsSync(join(dir, '桌宠', 'anchor_stand.png')))

    // Saving again (renamed) keeps the same folder; listing finds it.
    project.name = '居家（改）'
    assert.equal(saveProject(project, undefined, root).status.dir, dir)
    assert.deepEqual(listProjects(root).map(p => p.project.name), ['居家（改）'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('export copies the settings (or everything); import brings a copy back as a new project', () => {
  const root = mkdtempSync(join(tmpdir(), 'her-workshop-'))
  const out = mkdtempSync(join(tmpdir(), 'her-export-'))
  try {
    const project = newProject('p1', '居家')
    project.scenes.push(newScene('s1', '卧室'))
    const { status } = saveProject(project, undefined, root)
    writeFileSync(join(status.dir, '参考图.png'), 'png')
    writeFileSync(join(status.dir, '场景-卧室', 'stand_idle_01.mp4'), 'mp4')

    const light = exportProject('p1', out, false, root)
    assert.ok(existsSync(join(light.dir, '形象.json')) && existsSync(join(light.dir, '场景-卧室', '提示词.txt')))
    assert.ok(!existsSync(join(light.dir, '参考图.png')) && !existsSync(join(light.dir, '场景-卧室', 'stand_idle_01.mp4')))
    const full = exportProject('p1', out, true, root)
    assert.notEqual(full.dir, light.dir)
    assert.ok(existsSync(join(full.dir, '场景-卧室', 'stand_idle_01.mp4')))
    assert.throws(() => exportProject('p1', join(status.dir, '桌宠'), false, root), /自己的文件夹/)

    // Its id is taken here: it comes in as a new project, with its clips.
    const back = importProject(full.dir, undefined, root)
    assert.notEqual(back.project.id, 'p1')
    assert.equal(back.status.parts.find(p => p.name === '卧室')?.made, 1)
    assert.equal(listProjects(root).length, 2)
    // Its 形象.json alone works too; the project itself is refused.
    assert.ok(importProject(join(light.dir, '形象.json'), undefined, root).project.id)
    assert.throws(() => importProject(status.dir, undefined, root), /已经在形象工坊里/)
    assert.throws(() => importProject(out, undefined, root), /没有 形象\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('every card has example slots, reported as not ready until the files are there', () => {
  const home = mkdtempSync(join(tmpdir(), 'her-home-'))
  try {
    const list = examples(home)
    assert.deepEqual([...new Set(list.map(e => e.card))], ['look', 'reference', 'desk', 'scene', 'import'])
    assert.ok(list.every(e => !e.ready))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
