/**
 * 做场景: the first steps of a scene of your own. You choose a full-screen
 * photo (the scene with her in it) and box the region she moves in; this
 * writes a material folder with
 *
 *   plate.jpg / plate.png   the photo, as it is (it fills the screen behind her)
 *   scene.json              the photo's size and her region on it
 *   crop.png                that region cut out: generate her clips from it (first and last frame)
 *   怎么继续.txt             what to do next
 *
 * Her clips then only cover that region, so they are small and quick to make
 * while the photo stays sharp. Once the clips are in the folder, it is
 * imported like any other ("导入我的素材…"); the importer reads scene.json.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, nativeImage, shell } from 'electron'
import type { SceneLayout } from '../shared/types.ts'

/** Where scene folders are made: next to the user's documents, easy to find and fill. */
export const SCENES_DIR = join(homedir(), 'Documents', 'dsh-her 素材')

type Photo = { path: string; url: string; width: number; height: number }

function photoAt(path: string): Photo {
  const { width, height } = nativeImage.createFromPath(path).getSize()
  if (width === 0 || height === 0) throw new Error('这张图打不开')
  return { path, url: pathToFileURL(path).href, width, height }
}

/** A 形象工坊 scene folder's photo (plate.png or plate.jpg). */
export function scenePhotoIn(dir: string): Photo {
  const file = ['plate.png', 'plate.jpg', 'plate.jpeg'].map(f => join(dir, f)).find(f => existsSync(f))
  if (file === undefined) throw new Error('这个场景文件夹里还没有 plate.png：先按「照片提示词.txt」生成照片，存成 plate.png 放进去')
  return photoAt(file)
}

export async function pickScenePhoto(): Promise<Photo | undefined> {
  const choice = await dialog.showOpenDialog({ title: '选择全屏照片（场景里有她）', buttonLabel: '用这张', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }] })
  const path = choice.filePaths[0]
  if (choice.canceled || path === undefined) return undefined
  return photoAt(path)
}

/**
 * Write the scene folder. With `dir` (a 形象工坊 scene folder that has its
 * photo already) the frame is written there and may be redone; otherwise a
 * new folder is made under SCENES_DIR.
 */
export function saveScene(input: { path: string; name: string; region: SceneLayout['region']; dir?: string }): { dir: string } {
  const name = input.name.trim().replace(/[\\/:*?"<>|]+/g, '-')
  if (name === '') throw new Error('先给场景起个名字')
  const image = nativeImage.createFromPath(input.path)
  const { width, height } = image.getSize()
  const r = {
    x: Math.max(0, Math.round(input.region.x)), y: Math.max(0, Math.round(input.region.y)),
    width: Math.round(input.region.width), height: Math.round(input.region.height),
  }
  r.width = Math.min(r.width, width - r.x)
  r.height = Math.min(r.height, height - r.y)
  if (r.width < 64 || r.height < 64) throw new Error('人物区太小了')
  const dir = input.dir ?? join(SCENES_DIR, name)
  if (input.dir === undefined && existsSync(join(dir, 'scene.json'))) throw new Error(`已经有一个叫「${name}」的场景了，换个名字`)
  mkdirSync(dir, { recursive: true })
  const ext = extname(input.path).toLowerCase() === '.png' ? 'png' : 'jpg'
  if (resolve(dirname(input.path)) !== resolve(dir)) copyFileSync(input.path, join(dir, `plate.${ext}`))
  const scene: SceneLayout = { width, height, region: r }
  writeFileSync(join(dir, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`)
  writeFileSync(join(dir, 'crop.png'), image.crop(r).toPNG())
  // A 形象工坊 folder has its own instructions (提示词.txt).
  if (input.dir === undefined) writeFileSync(join(dir, '怎么继续.txt'), [
    `场景「${name}」：全屏照片 ${width}×${height}，人物区 ${r.width}×${r.height}（左上角在 ${r.x}, ${r.y}）。`,
    '',
    '1. 用 crop.png 去生成她的视频片段：首帧和尾帧都用 crop.png，提示词见 dsh-her 的 docs/素材生成提示词.md（场景包那一节）。',
    '   生成时长宽比和 crop.png 一样；她的动作不要超出画面。',
    '2. 片段按文档里的名字命名（比如 stand_idle_01.mp4、stand_talk_01.mp4），放进这个文件夹。',
    '3. 在 dsh 的「她」页面 → 设置 → 外形 → 导入我的素材…，选这个文件夹。',
    '',
    '不要改 plate 和 scene.json：她的视频会贴在照片的这个位置上。',
  ].join('\n') + '\n')
  shell.showItemInFolder(join(dir, 'crop.png'))
  return { dir }
}
