import { app } from 'electron'
import { resolve } from 'node:path'

/**
 * Started from a package (body/scripts/package.mjs), not from a development
 * folder. Not `app.isPackaged`: that only looks at the program's file name, and
 * the macOS package keeps Electron's (`Contents/MacOS/Electron`).
 */
export const PACKAGED = (() => {
  try {
    return app.isPackaged || resolve(app.getAppPath()) === resolve(process.resourcesPath, 'app')
  } catch {
    return false
  }
})()
