/**
 * The web body's page (lib/web-body/renderer.js): the bridge first, so
 * `window.her` is there when the desktop body's unchanged renderer starts.
 */

import './web-bridge.ts'
import '../../body/renderer/main.ts'
