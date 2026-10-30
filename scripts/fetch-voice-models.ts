/**
 * Download the local speech recognition models into `$DSH_HER_HOME/models` (default
 * ~/.dsh-her). The plugin does the same on first use; this is for development.
 */

import { herPaths } from '../src/core/index.ts'
import { fetchModel, missingModels, modelPath } from '../src/voice/models.ts'

const paths = herPaths(process.env.DSH_HER_HOME ?? '~/.dsh-her')
const missing = missingModels(paths.models)
if (missing.length === 0) console.log(`models already in ${paths.models}`)
for (const spec of missing) {
  let shown = -1
  await fetchModel(paths.models, spec, (received, total) => {
    const percent = Math.floor((received / total) * 100)
    if (percent >= shown + 10) {
      shown = percent
      console.log(`${spec.id} ${percent}% (${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB)`)
    }
  })
  console.log(`${spec.id} → ${modelPath(paths.models, spec)}`)
}
