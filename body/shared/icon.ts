/**
 * Her icon, drawn in code (the repository holds no pictures): a purple disc
 * with a white heart, anti-aliased by sampling each pixel 4×4 times. The tray
 * on Windows and Linux uses it (macOS shows "她" as the tray title instead),
 * and the packaging script turns it into the Windows .exe icon.
 */

const PURPLE = [139, 92, 246] as const
const WHITE = [255, 255, 255] as const
const SAMPLES = 4

/** RGBA pixels, `size`×`size`, row by row. `bgra` swaps red and blue (Electron's bitmaps). */
export function iconPixels(size: number, bgra = false): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let disc = 0
      let heart = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // -1…1 across the icon, y up.
          const u = ((x + (sx + 0.5) / SAMPLES) / size) * 2 - 1
          const v = 1 - ((y + (sy + 0.5) / SAMPLES) / size) * 2
          if (u * u + v * v <= 0.96) {
            disc++
            if (inHeart(u / 0.52, (v + 0.06) / 0.52)) heart++
          }
        }
      }
      const n = SAMPLES * SAMPLES
      const alpha = disc / n
      const white = disc === 0 ? 0 : heart / disc
      const rgb = PURPLE.map((c, i) => Math.round(c + (WHITE[i]! - c) * white))
      const at = (y * size + x) * 4
      out[at] = bgra ? rgb[2]! : rgb[0]!
      out[at + 1] = rgb[1]!
      out[at + 2] = bgra ? rgb[0]! : rgb[2]!
      out[at + 3] = Math.round(alpha * 255)
    }
  }
  return out
}

/** The classic heart curve (x² + y² − 1)³ − x²y³ ≤ 0, about 2.3 wide and 2.2 high. */
function inHeart(x: number, y: number): boolean {
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y <= 0
}
