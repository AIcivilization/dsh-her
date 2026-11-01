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
.her-manual{margin-top:10px;padding:10px 12px;border:1px solid ${LINE};border-radius:10px;background:${LAYER2}}
.her-manual p{margin:8px 0 4px}
.her-manual-row{display:flex;align-items:center;gap:8px;margin:4px 0}
.her-manual-row .her-muted{flex:none;min-width:9em;font-size:12px}
.her-manual-row code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;user-select:all}
.her-manual .her-faint code{word-break:break-all;font-size:11px;user-select:all}
.her-versions{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:-6px 0 12px;padding-bottom:8px;border-bottom:1px solid ${LINE};font-size:12px;color:${MUTED};max-width:760px}
.her-versions b{font-weight:600;color:${TEXT}}
.her-versions code{font-size:11px}
.her-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.her-head h1{font-size:18px;font-weight:600;margin:0}
.her-muted{color:${MUTED}}.her-faint{color:${FAINT}}
.her-ok{color:${OK}}.her-warn{color:${WARN}}.her-danger{color:${DANGER}}
.her-card{background:${LAYER1};border-radius:12px;padding:14px 16px;margin-bottom:12px;max-width:760px}
.her-card h2{font-size:15px;font-weight:600;margin:0 0 6px}
.her-card p{margin:4px 0}
.her-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.her-fold{display:flex;align-items:center;gap:10px;width:100%;border:none;background:none;padding:2px 0;color:${TEXT};font:inherit;cursor:pointer;text-align:left}
.her-fold h2{margin:0;flex:none}
.her-fold-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${ACCENT};color:${ON_ACCENT};transition:transform .15s,opacity .15s}
.her-fold-arrow.open{transform:rotate(90deg)}
.her-fold:hover .her-fold-arrow{opacity:.85}
.her-fold:focus-visible{outline:2px solid ${ACCENT};outline-offset:4px;border-radius:6px}
.her-fold-sum{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.her-fold-toggle{flex:none;font-size:12px;padding:3px 12px;border-radius:999px;border:1px solid ${LINE};background:${LAYER2};color:${TEXT}}
.her-fold:hover .her-fold-toggle{background:${HOVER}}
.her-foldcard.open .her-fold{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid ${LINE}}
.her-subtabs{margin:4px 0 6px}
.her-badge-inline{margin:0 0 0 6px;font-size:10px;padding:0 5px}
.her-examples{margin-top:12px}
.her-example-row{display:flex;gap:10px;flex-wrap:wrap}
.her-example{margin:0;width:150px}
.her-example img,.her-example video,.her-example-empty{width:150px;height:110px;object-fit:cover;border-radius:8px;background:${LAYER2};display:block}
.her-example-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed ${LINE};color:${FAINT};font-size:11px;text-align:center;padding:6px}
.her-example-empty code{font-size:10px;word-break:break-all}
.her-example figcaption{font-size:11px;color:${MUTED};margin-top:3px}
.her-scenes{margin-top:14px;border-top:1px solid ${LINE};padding-top:10px}
.her-scene{margin:4px 0}.her-scene label{min-width:7em}.her-scene .her-muted{flex:1}
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
.her-badge{display:inline-block;font-size:11px;line-height:16px;padding:0 6px;margin-right:6px;border-radius:999px;background:${ACCENT};color:${ON_ACCENT};font-weight:600}
.her-choice.trying{border-style:dashed;border-color:${ACCENT}}
.her-now{margin:2px 0 8px}
.her-now b{font-weight:600}
.her-now .her-dot{margin-left:10px}
.her-pending{position:sticky;bottom:8px;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;padding:8px 12px;border-radius:10px;border:1px dashed ${ACCENT};background:${v("bg-layer-1-solid", "Canvas")};box-shadow:0 4px 16px rgba(0,0,0,.25)}
.her-pending span{flex:1;min-width:200px}
.her-alert{border:1px solid ${DANGER};border-radius:10px;padding:8px 12px;color:${TEXT}}
.her-card.her-alert{padding:14px 16px}
.her-card.her-alert h2{color:${DANGER}}
.her-summary{display:grid;grid-template-columns:auto 1fr auto auto;gap:6px 12px;align-items:center}
.her-summary-row{display:contents}
.her-summary-row b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.her-summary-note{font-size:12px;color:${MUTED};white-space:nowrap}
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
.her-tag.warn{color:${WARN}}.her-tag.bad{color:${DANGER}}.her-tag.ok{color:${OK}}
.her-chat{background:${LAYER2};border-radius:10px;padding:8px 10px;margin:8px 0;max-height:220px;overflow:auto}
.her-chat div{margin:3px 0}
.her-chat .you{color:${MUTED}}
.her-report{margin:6px 0;padding-left:0;list-style:none}
.her-report li{margin:2px 0}
.her-progress{height:6px;background:${LAYER2};border-radius:3px;overflow:hidden;margin:6px 0}
.her-progress div{height:100%;background:${ACCENT};transition:width .3s}
.her-error{color:${DANGER};margin:6px 0}
`
