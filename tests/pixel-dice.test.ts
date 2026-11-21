import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPixelInfo, wrapPixelCode } from '../src/core/pixel.ts'
import { makeGrid, seeded } from '../src/core/pixel-grid.ts'
import { DICE_GRIDS, diceCode, FACES, hslHex, hueName, pickFace, rollDice, type DiceSpec } from '../src/core/pixel-dice.ts'

type Anim = { info?: unknown; setup?: (g: unknown) => void; frame?: (g: unknown, t: number, n: number) => void }
function load(code: string): Anim {
  const { script, problems } = wrapPixelCode(code)
  assert.deepEqual(problems, [])
  // eslint-disable-next-line no-new-func
  return new Function(`${script}\nreturn __anim`)() as Anim
}

/** Play a file the way the player does (every third frame, 6 s): what it drew, and its slowest frame. */
function play(code: string): { drawn: number; slowest: number } {
  const anim = load(code)
  const { info, problems } = cleanPixelInfo(anim.info)
  assert.deepEqual(problems, [])
  const g = makeGrid(info!.grid[0], info!.grid[1], info!.color)
  anim.setup?.(g)
  let drawn = 0
  let slowest = 0
  for (let n = 0; n < 6 * info!.fps; n += 3) {
    const started = performance.now()
    anim.frame!(g, n / info!.fps, n)
    slowest = Math.max(slowest, performance.now() - started)
    for (let i = 3; i < g.data.length; i += 4) if (g.data[i]! > 0) drawn++
  }
  return { drawn, slowest }
}

test('six faces, their chances add up to 100, and a roll lands on each about that often', () => {
  assert.equal(FACES.length, 6)
  assert.equal(FACES.reduce((s, f) => s + f.weight, 0), 100)
  assert.equal(new Set(FACES.flatMap(f => f.recipes.map(r => r.id))).size, FACES.reduce((s, f) => s + f.recipes.length, 0))
  const random = seeded(7)
  const count: Record<string, number> = {}
  const N = 30_000
  for (let i = 0; i < N; i++) {
    const f = pickFace(random)
    count[f.id] = (count[f.id] ?? 0) + 1
  }
  for (const f of FACES) assert.ok(Math.abs(count[f.id]! / N * 100 - f.weight) < 1.5, `${f.name}: ${(count[f.id]! / N * 100).toFixed(1)}%`)
})

test('every recipe, at its low, middle and high numbers, runs, draws something and is quick enough', () => {
  const [mid, fine] = [DICE_GRIDS[1]!.grid, DICE_GRIDS[2]!.grid]
  for (const face of FACES) {
    for (const recipe of face.recipes) {
      const at = (p: number) => Object.fromEntries(Object.entries(recipe.params).map(([k, [lo, hi, whole]]) => [k, whole ? Math.round(lo + (hi - lo) * p) : lo + (hi - lo) * p]))
      for (const [p, grid] of [[0, mid], [0.5, mid], [1, mid], [1, fine]] as Array<[number, [number, number]]>) {
        const spec: DiceSpec = { name: recipe.name, grid, fps: 24, seconds: 0, layers: [{ face: face.id, recipe: recipe.id, params: at(p), seed: 12345, k: 1 }] }
        const { drawn, slowest } = play(diceCode(spec))
        assert.ok(drawn > 300, `${recipe.name} at ${p} on ${grid}: drew ${drawn}`)
        assert.ok(slowest < 40, `${recipe.name} at ${p} on ${grid}: slowest frame ${slowest.toFixed(1)} ms`)
      }
    }
  }
})

test('two layers mix: the lower one weaker, the file still plain', () => {
  const spec: DiceSpec = {
    name: '烟花·星空', grid: [192, 108], fps: 24, seconds: 5,
    layers: [{ face: 'sky', recipe: 'stars', params: { n: 120, tw: 1, big: 0.1 }, seed: 9, k: 0.4 }, { face: 'fire', recipe: 'fireworks', params: { rate: 1, n: 50, size: 30, grav: 20 }, seed: 10, k: 1 }],
  }
  const code = diceCode(spec)
  assert.match(code, /叠在 🌌 天空 · 星空 上面/)
  assert.ok(play(code).drawn > 300)
})

test('rolls are all different, never the same recipe twice running, and every one is a file that reads', () => {
  const random = seeded(42)
  const codes = new Set<string>()
  const recent: string[] = []
  let last = ''
  for (let i = 0; i < 1000; i++) {
    const roll = rollDice(recent, random)
    codes.add(roll.code)
    assert.notEqual(roll.recipe.id, last)
    last = roll.recipe.id
    recent.unshift(roll.print)
    recent.length = Math.min(recent.length, 50)
    if (i < 60) {
      const { info, problems } = cleanPixelInfo(load(roll.code).info)
      assert.deepEqual(problems, [])
      assert.equal(info!.name, roll.spec.name)
      assert.ok(roll.look.color === 'theme' || /^#[0-9a-f]{6}$/.test(roll.look.color))
    }
  }
  assert.equal(codes.size, 1000)
})

test('colours from the wheel and their names', () => {
  assert.equal(hslHex(0, 1, 0.5), '#ff0000')
  assert.equal(hslHex(240, 1, 0.5), '#0000ff')
  assert.equal(hueName('#3b82f6'), '蓝')
  assert.equal(hueName('#ff0000'), '红')
  assert.equal(hueName('#888888'), '银')
})
