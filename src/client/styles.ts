// "她" page styles on DSH's own theme variables (with fallbacks), so the page
// follows DSH's light and dark themes. Every class is prefixed `her-`.

const v = (name: string, fallback: string) => `var(--dsw-alias-${name}, ${fallback})`

const TEXT = v('label-primary', 'CanvasText')
const MUTED = v('label-secondary', 'GrayText')
const FAINT = v('label-tertiary', 'GrayText')
const LINE = v('border-l2', 'rgba(127,127,127,.22)')
const LAYER1 = v('bg-layer-1', 'rgba(127,127,127,.06)')
const LAYER2 = v('bg-layer-2', 'rgba(127,127,127,.10)')
const HOVER = v('interactive-bg-hover', 'rgba(127,127,127,.12)')
const DANGER = v('state-error-primary', '#d14343')
const WARN = v('state-warn-primary', '#b7791f')
const OK = v('state-success-primary', '#2f855a')
const ACCENT = v('button-primary-fill', '#4d6bfe')
// Text on an accent fill: DSH's primary is near-white in dark mode, so never a fixed white.
const ON_ACCENT = v('label-primary-foreground', '#fff')

export const STYLES = `
.her-page{box-sizing:border-box;height:100%;overflow:auto;padding:20px 24px 40px;color:${TEXT};font-size:13px;line-height:1.55}
.her-page *{box-sizing:border-box}
.her-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.her-head h1{font-size:18px;font-weight:600;margin:0}
.her-muted{color:${MUTED}}.her-faint{color:${FAINT}}
.her-ok{color:${OK}}.her-warn{color:${WARN}}.her-danger{color:${DANGER}}
.her-card{background:${LAYER1};border-radius:12px;padding:14px 16px;margin-bottom:12px;max-width:760px}
.her-card h2{font-size:15px;font-weight:600;margin:0 0 6px}
.her-card p{margin:4px 0}
.her-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.her-btn{border:1px solid ${LINE};background:${LAYER2};color:${TEXT};border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer}
.her-btn:hover{background:${HOVER}}
.her-btn:disabled{opacity:.5;cursor:default}
.her-btn.primary{background:${ACCENT};border-color:${ACCENT};color:${ON_ACCENT}}
.her-btn.small{padding:2px 8px;font-size:12px}
.her-btn.link{border:none;background:none;color:${ACCENT};padding:2px 4px}
.her-input,.her-textarea,.her-select{width:100%;border:1px solid ${LINE};background:${LAYER2};color:${TEXT};border-radius:8px;padding:7px 10px;font:inherit}
.her-textarea{min-height:120px;resize:vertical}
.her-label{display:block;font-size:12px;color:${MUTED};margin:10px 0 4px}
.her-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}
.her-choice{border:1px solid ${LINE};background:${LAYER2};border-radius:10px;padding:10px;cursor:pointer;text-align:left;color:${TEXT};font:inherit}
.her-choice:hover{background:${HOVER}}
.her-choice.on{border-color:${ACCENT};box-shadow:0 0 0 1px ${ACCENT}}
.her-choice small{display:block;color:${MUTED};margin-top:2px}
.her-steps{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;max-width:760px}
.her-step{font-size:12px;padding:3px 10px;border-radius:999px;background:${LAYER1};color:${MUTED};border:none;cursor:pointer;font-family:inherit}
.her-step.on{background:${ACCENT};color:${ON_ACCENT}}
.her-step.done{color:${OK}}
.her-tabs{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap}
.her-tab{border:none;background:none;color:${MUTED};padding:6px 10px;border-radius:8px;cursor:pointer;font:inherit}
.her-tab.on{background:${LAYER2};color:${TEXT};font-weight:600}
.her-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${FAINT};vertical-align:0}
.her-dot.ok{background:${OK}}.her-dot.warn{background:${WARN}}.her-dot.bad{background:${DANGER}}
.her-list{list-style:none;margin:6px 0;padding:0}
.her-list li{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid ${LINE}}
.her-list li:last-child{border-bottom:none}
.her-list li .grow{flex:1;min-width:0;word-break:break-word}
.her-tag{font-size:11px;padding:0 6px;border-radius:999px;background:${LAYER2};color:${MUTED};white-space:nowrap}
.her-tag.warn{color:${WARN}}.her-tag.bad{color:${DANGER}}
.her-chat{background:${LAYER2};border-radius:10px;padding:8px 10px;margin:8px 0;max-height:220px;overflow:auto}
.her-chat div{margin:3px 0}
.her-chat .you{color:${MUTED}}
.her-report{margin:6px 0;padding-left:0;list-style:none}
.her-report li{margin:2px 0}
.her-progress{height:6px;background:${LAYER2};border-radius:3px;overflow:hidden;margin:6px 0}
.her-progress div{height:100%;background:${ACCENT};transition:width .3s}
.her-error{color:${DANGER};margin:6px 0}
`
