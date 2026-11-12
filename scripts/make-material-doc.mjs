// Writes docs/素材规格与提示词.md from src/core/material-guide.ts (the 素材指南 page shows the same entries).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guideMarkdown } from '../src/core/material-guide.ts'

writeFileSync(fileURLToPath(new URL('../docs/素材规格与提示词.md', import.meta.url)), guideMarkdown())
console.log('docs/素材规格与提示词.md written')
