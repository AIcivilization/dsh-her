// Before publishing to npm (prepack): her icon for dshmarket's listing, drawn by
// code as everywhere else (the repository holds no pictures): lib/icon.png.

import { writeFileSync } from 'node:fs'
import { iconPixels } from '../body/shared/icon.ts'
import { png } from '../body/scripts/ico.mjs'

const SIZE = 256
writeFileSync('lib/icon.png', png(SIZE, iconPixels(SIZE)))
console.log(`lib/icon.png: ${SIZE}×${SIZE}`)
