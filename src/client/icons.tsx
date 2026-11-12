/**
 * Small line icons for her page, drawn inline (one stroke weight, 20 px
 * grid) so they follow the text colour and need no icon font.
 */

import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  home: <><path d="M3.5 9.5 10 4l6.5 5.5" /><path d="M5.5 8.5V16h9V8.5" /></>,
  persona: <><circle cx="10" cy="7" r="3" /><path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" /></>,
  voice: <><path d="M4 8v4M7 5.5v9M10 3.5v13M13 6.5v7M16 8.5v3" /></>,
  memory: <><path d="M5 3.5h8.5a1.5 1.5 0 0 1 1.5 1.5v11.5l-5-2.5-5 2.5z" /></>,
  look: <><rect x="3.5" y="4" width="13" height="12" rx="2" /><circle cx="7.5" cy="8" r="1.3" /><path d="m4 14 3.5-3.5 3 3 2-2 3.5 3.5" /></>,
  stage: <><rect x="3.5" y="3.5" width="13" height="13" rx="2" /><path d="M3.5 8.5h13M8.5 3.5v13" /></>,
  library: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5H15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /></>,
  skin: <><path d="M10 3.5a6.5 6.5 0 1 0 0 13c1.2 0 1.6-.9 1.2-1.8-.5-1.2.3-2.2 1.6-2.2h1.7a2 2 0 0 0 2-2c0-3.9-2.9-7-6.5-7z" /><circle cx="7" cy="8" r=".8" /><circle cx="10.5" cy="6.5" r=".8" /><circle cx="6.8" cy="11.5" r=".8" /></>,
  workshop: <><path d="m4 16 8-8" /><path d="m13 3.5.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" /><path d="m15.5 10.5.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z" /></>,
  speak: <><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 10a5 5 0 0 0 10 0M10 15v2.5" /></>,
  initiative: <><path d="M4 5.5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M8 8.5h4" /></>,
  talk: <><path d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13.5 5v4.5A1.5 1.5 0 0 1 12 11H8l-2.5 2v-2H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M15 8h.5A1.5 1.5 0 0 1 17 9.5V13a1.5 1.5 0 0 1-1.5 1.5v2l-2.5-2h-3" /></>,
  model: <><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" /><path d="M8 3v2.5M12 3v2.5M8 14.5V17M12 14.5V17M3 8h2.5M3 12h2.5M14.5 8H17M14.5 12H17" /></>,
  body: <><rect x="3" y="4" width="14" height="9.5" rx="1.5" /><path d="M7.5 16.5h5M10 13.5v3" /></>,
  voices: <><path d="M7.5 3v4M12.5 3v4" /><path d="M5.5 7h9v2.5a4.5 4.5 0 0 1-9 0z" /><path d="M10 14v3" /></>,
  about: <><circle cx="10" cy="10" r="6.5" /><path d="M10 9v4.5" /><circle cx="10" cy="6.7" r=".6" fill="currentColor" /></>,
  power: <><path d="M10 3.5v6" /><path d="M6.2 5.8a6 6 0 1 0 7.6 0" /></>,
  arrow: <path d="m8 5 5 5-5 5" />,
  check: <path d="m5 10.5 3.5 3.5 6.5-7.5" />,
  alert: <><path d="M10 3.5 17 16H3z" /><path d="M10 8.5v3.5" /><circle cx="10" cy="14" r=".6" fill="currentColor" /></>,
  moon: <path d="M15.5 11.5A6 6 0 0 1 8.5 4.5a6 6 0 1 0 7 7z" />,
  play: <path d="M7 4.5v11l9-5.5z" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  copy: <><rect x="7" y="7" width="9.5" height="9.5" rx="1.5" /><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2" /></>,
  guide: <><path d="M10 5.5C8.5 4.3 6.5 4 4 4v11c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V4c-2.5 0-4.5.3-6 1.5z" /><path d="M10 5.5v11" /></>,
  eye: <><path d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z" /><circle cx="10" cy="10" r="2" /></>,
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="her-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
