// "她" page styles on DSH's own theme variables (with fallbacks), so the page
// follows DSH's light and dark themes and whatever skin dsh wears. Every class
// is prefixed `her-`.
//
// One accent, `--her-ink`: a blue that reads on the page in either mode (a
// skin's talk-bar accent takes its place). Filled controls use it as their
// fill with `--her-on-ink` on top, so they stay readable whatever the skin.

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
const INK = 'var(--her-ink)'
const ON_INK = 'var(--her-on-ink)'
/** A wash of a colour over whatever is behind. */
const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`
const FIELD = tint(TEXT, 5)
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E")`

export const STYLES = `
.her-page{--her-ink:var(--her-bar-accent,#2f6fe0);--her-on-ink:#fff;container-type:inline-size;box-sizing:border-box;height:100%;overflow:auto;padding:22px 28px 48px;color:${TEXT};font-size:13px;line-height:1.6}
body[data-ds-dark-theme] .her-page{--her-ink:var(--her-bar-accent,#86b4ff);--her-on-ink:#0c1524}
.her-page *{box-sizing:border-box}
.her-page code{font-size:12px;padding:1px 5px;border-radius:5px;background:${FIELD}}
.her-page a{color:${INK}}
.her-icon{flex:none;display:block}
.her-grow{flex:1}

.her-shell,.her-wizard{max-width:1040px;margin:0 auto}
.her-wizard{max-width:760px}

.her-hero{display:flex;align-items:center;gap:16px;padding:16px 20px;margin-bottom:18px;border-radius:18px;border:1px solid ${LINE};background:linear-gradient(120deg,${tint(INK, 16)},${tint(INK, 3)} 55%,transparent),${LAYER1}}
.her-hero.off{background:${LAYER1}}
.her-hero-ava{flex:none;width:60px;height:60px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${tint(INK, 22)};color:${INK};font-size:24px;font-weight:600;box-shadow:0 0 0 2px ${LAYER1},0 0 0 4px ${tint(INK, 45)}}
.her-hero.off .her-hero-ava{filter:grayscale(1);opacity:.6}
.her-hero-ava img,.her-hero-ava video{width:100%;height:100%;object-fit:cover}
.her-hero-text{flex:1;min-width:0}
.her-hero-text h1{margin:0;font-size:21px;font-weight:650;letter-spacing:.01em}
.her-hero-text p{margin:2px 0 0;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.her-power{flex:none;display:flex;align-items:center;gap:10px;padding:8px 12px 8px 14px;border-radius:999px;border:1px solid ${LINE};background:${LAYER1};cursor:pointer;font-weight:600}

.her-layout{display:flex;gap:26px;align-items:flex-start}
.her-nav{flex:none;width:172px;position:sticky;top:0;display:flex;flex-direction:column;gap:14px}
.her-nav-group{display:flex;flex-direction:column;gap:2px}
.her-nav-title{padding:0 10px 4px;font-size:11px;font-weight:600;letter-spacing:.08em;color:${FAINT}}
.her-nav-item{display:flex;align-items:center;gap:9px;width:100%;height:34px;padding:0 10px;border:none;border-radius:9px;background:none;color:${MUTED};font:inherit;cursor:pointer;text-align:left;white-space:nowrap}
.her-nav-item span{flex:1}
.her-nav-item .her-dot{margin:0}
.her-nav-item:hover{background:${HOVER};color:${TEXT}}
.her-nav-item.on{background:${tint(INK, 14)};color:${INK};font-weight:600}
.her-nav-item:focus-visible,.her-btn:focus-visible,.her-tile:focus-visible,.her-linkrow:focus-visible,.her-choice:focus-visible{outline:2px solid ${INK};outline-offset:2px}
.her-main{flex:1;min-width:0;max-width:820px}
.her-title{margin:2px 0 16px}
.her-title h1{margin:0;font-size:20px;font-weight:650}
.her-title p{margin:4px 0 0;color:${MUTED}}

@container (max-width: 760px){
  .her-layout{display:block}
  .her-nav{position:sticky;top:-22px;z-index:3;width:auto;flex-direction:row;gap:4px;overflow-x:auto;margin:0 -28px 14px;padding:8px 28px;background:${v('bg-base', 'Canvas')};border-bottom:1px solid ${LINE};scrollbar-width:none}
  .her-nav-group{flex-direction:row;gap:2px}
  .her-nav-title{display:none}
  .her-nav-item{width:auto;height:32px}
  .her-home-top{grid-template-columns:1fr!important}
  .her-show-stage{aspect-ratio:auto!important;display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}
  .her-show-screen{position:relative!important;left:0!important;top:0!important;width:100%!important;height:auto!important;aspect-ratio:16/10;grid-column:1/-1;margin-bottom:8px}
  .her-show-lines{display:none!important}
  .her-show-label,.her-show-label.left,.her-show-label.right,.her-show-label.top,.her-show-label.bottom{position:static!important;translate:none!important;max-width:none!important;align-items:flex-start!important;text-align:left!important}
  .her-show-label.left b{flex-direction:row!important}
  .her-show-head{flex-direction:column;align-items:flex-start;gap:2px}
  .her-sheet{grid-template-columns:1fr}
  .her-hero{padding:12px 14px;gap:12px}
  .her-hero-ava{width:46px;height:46px;font-size:19px}
  .her-power span{display:none}
}

.her-muted{color:${MUTED}}.her-faint{color:${FAINT}}
.her-ok{color:${OK}}.her-warn{color:${WARN}}.her-danger{color:${DANGER}}
.her-error{color:${DANGER};margin:8px 0}
.her-disabled{opacity:.5;pointer-events:none}
.her-intro{margin:0 0 12px;color:${MUTED}}
.her-sub{margin:22px 2px 8px;font-size:13px;font-weight:600;color:${MUTED}}

.her-card{background:${LAYER1};border:1px solid ${LINE};border-radius:14px;padding:16px 18px;margin-bottom:14px}
.her-card h2{font-size:14.5px;font-weight:650;margin:0 0 8px}
.her-card p{margin:6px 0}
.her-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.her-card-head h2{margin:0}
.her-card-badge{font-size:12px;color:${MUTED};white-space:nowrap}
.her-nested .her-card,.her-card .her-card{border:none;padding:0;margin:0 0 14px;background:none}
.her-card .her-card.her-voice-provider{border:1px solid ${LINE};padding:12px 14px;border-radius:12px;background:${tint(TEXT, 2)}}
.her-details{padding:0}
.her-details summary{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;list-style:none;color:${TEXT}}
.her-details summary::-webkit-details-marker{display:none}
.her-details summary h2{margin:0}
.her-details summary .her-icon{color:${FAINT};transition:transform .15s}
.her-details[open] summary .her-icon{transform:rotate(90deg)}
.her-details-body{padding:0 18px 16px}
.her-more{margin:8px 0;color:${MUTED}}
.her-more summary{cursor:pointer;color:${INK};width:fit-content}
.her-more ul{margin:8px 0;padding-left:18px}
.her-more li{margin:4px 0}

.her-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.her-toolbar{margin-top:0}
.her-setrow{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:11px 0;border-top:1px solid ${LINE}}
.her-setrow:first-child,.her-card>h2+.her-setrow,.her-card-head+.her-setrow{border-top:none;padding-top:2px}
.her-setrow:last-child{padding-bottom:2px}
.her-setrow>div{min-width:0}
.her-setrow b{display:block;font-weight:600}
.her-setrow>div>span{display:block;font-size:12.5px;color:${MUTED}}

.her-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 13px;border:1px solid ${LINE};background:${FIELD};color:${TEXT};border-radius:9px;font:inherit;font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background .12s,border-color .12s}
.her-btn:hover{background:${HOVER}}
.her-btn:disabled{opacity:.45;cursor:default}
.her-btn.primary{background:${INK};border-color:${INK};color:${ON_INK};font-weight:600}
.her-btn.primary:hover{background:${INK};filter:brightness(1.08)}
.her-btn.small{min-height:26px;padding:0 9px;font-size:12px;border-radius:7px}
.her-btn.link{border:none;background:none;color:${INK};padding:0 4px;min-height:24px}
.her-btn.her-ai{border-color:${tint(INK, 45)};background:${tint(INK, 10)};color:${INK}}
.her-btn.her-ai:hover{background:${tint(INK, 18)}}
.her-off{border-color:${DANGER};color:${DANGER}}

.her-page input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:36px;height:20px;margin:0;border-radius:999px;background:${tint(TEXT, 22)};cursor:pointer;vertical-align:-5px;transition:background .15s}
.her-page input[type=checkbox]::before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
.her-page input[type=checkbox]:checked{background:${INK}}
.her-page input[type=checkbox]:checked::before{transform:translateX(16px)}
.her-page input[type=checkbox]:disabled{opacity:.45;cursor:default}
.her-page input[type=checkbox]:focus-visible{outline:2px solid ${INK};outline-offset:2px}
.her-page input[type=radio],.her-page input[type=range]{accent-color:${INK}}
.her-page label:has(>input[type=checkbox]),.her-page label:has(>input[type=radio]){display:inline-flex;align-items:center;gap:8px;cursor:pointer}

.her-input,.her-textarea,.her-select{width:100%;min-height:34px;border:1px solid ${LINE};background:${FIELD};color:${TEXT};border-radius:9px;padding:6px 10px;font:inherit;transition:border-color .12s,box-shadow .12s}
.her-input:focus,.her-textarea:focus,.her-select:focus{outline:none;border-color:${INK};box-shadow:0 0 0 3px ${tint(INK, 18)}}
.her-select{appearance:none;-webkit-appearance:none;padding-right:28px;background-image:${CHEVRON};background-repeat:no-repeat;background-position:right 9px center;cursor:pointer}
.her-textarea{min-height:128px;resize:vertical;line-height:1.6}
.her-label{display:block;font-size:12px;font-weight:500;color:${MUTED};margin:12px 0 5px}

.her-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;margin-right:7px;background:${FAINT};vertical-align:0}
.her-dot.ok{background:${OK}}.her-dot.warn{background:${WARN}}.her-dot.bad{background:${DANGER}}
.her-tag{font-size:11px;padding:1px 7px;border-radius:999px;background:${FIELD};color:${MUTED};white-space:nowrap}
.her-tag.warn{color:${WARN};background:${tint(WARN, 12)}}.her-tag.bad{color:${DANGER};background:${tint(DANGER, 12)}}.her-tag.ok{color:${OK};background:${tint(OK, 12)}}
.her-badge{display:inline-block;font-size:11px;line-height:17px;padding:0 7px;margin-right:6px;border-radius:999px;background:${tint(INK, 16)};color:${INK};font-weight:600}
.her-badge-inline{margin:0 0 0 6px;font-size:10px;padding:0 5px}
.her-chip{display:inline-block;margin:0 4px 4px 0;padding:1px 8px;border-radius:999px;background:${tint(INK, 12)};color:${INK};font-size:12px}
.her-chip.bad{color:${DANGER};background:${tint(DANGER, 12)}}
.her-keys{flex:none;display:inline-flex;gap:4px;min-width:112px}
.her-page kbd{display:inline-block;min-width:24px;padding:2px 7px;border-radius:6px;border:1px solid ${LINE};border-bottom-width:2px;background:${FIELD};font:inherit;font-size:12px;text-align:center}

.her-banner{display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:14px;border-radius:12px;border:1px solid ${LINE};background:${LAYER1}}
.her-banner>span:not(.her-dot){flex:1;min-width:0}
.her-banner.ok{border-color:${tint(OK, 40)};background:${tint(OK, 8)}}.her-banner.ok .her-icon{color:${OK}}
.her-banner.bad,.her-banner.warn{border-color:${tint(DANGER, 45)};background:${tint(DANGER, 8)}}.her-banner.bad .her-icon{color:${DANGER}}
.her-banner.off{max-width:1040px;margin-left:auto;margin-right:auto;border-color:${tint(DANGER, 45)}}
.her-banner.off .her-icon{color:${DANGER}}
.her-alert{border:1px solid ${tint(DANGER, 45)};border-radius:10px;padding:8px 12px;color:${TEXT}}
.her-card.her-alert{padding:14px 16px}
.her-card.her-alert h2{color:${DANGER}}
.her-warnlist{margin:8px 0;padding:8px 12px 8px 28px;border-radius:10px;background:${tint(WARN, 9)};color:${TEXT}}
.her-warnlist li{margin:2px 0}
.her-warnlist li::marker{color:${WARN}}

.her-linkrow{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;margin-bottom:14px;border-radius:14px;border:1px dashed ${LINE};background:none;color:${TEXT};font:inherit;text-align:left;cursor:pointer}
.her-linkrow:hover{background:${HOVER};border-style:solid}
.her-linkrow>.her-icon:first-child{color:${INK}}
.her-linkrow>.her-icon:last-child{color:${FAINT}}
.her-linkrow span{flex:1;min-width:0}
.her-linkrow b{display:block;font-weight:600}
.her-linkrow small{display:block;font-size:12.5px;color:${MUTED}}

.her-home-top{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:stretch}
.her-home-top>.her-card{margin-bottom:14px}
.her-todo{border-color:${tint(WARN, 45)}}
.her-todo-row{display:flex;align-items:center;gap:6px;padding:8px 0;border-top:1px solid ${LINE}}
.her-todo-row:first-of-type{border-top:none}
.her-todo-row>span:not(.her-dot){flex:1;min-width:0}
.her-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:8px;margin:4px 0 10px}
.her-tile{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid ${LINE};background:none;color:${TEXT};font:inherit;text-align:left;cursor:pointer;min-width:0}
.her-tile:hover{background:${HOVER};border-color:${tint(INK, 45)}}
.her-tile .her-icon{grid-row:1 / span 2;color:${INK}}
.her-tile-label{font-size:12px;color:${MUTED}}
.her-tile-value{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.her-ways{list-style:none;margin:0;padding:0}
.her-ways li{display:flex;align-items:flex-start;gap:14px;padding:10px 0;border-top:1px solid ${LINE}}
.her-ways li:first-child{border-top:none;padding-top:2px}
.her-ways b{display:block;font-weight:600}
.her-ways span span,.her-ways div span{display:block;font-size:12.5px;color:${MUTED}}

.her-tabs{display:inline-flex;gap:2px;padding:3px;margin-bottom:12px;border-radius:10px;background:${FIELD};flex-wrap:wrap}
.her-tab{border:none;background:none;color:${MUTED};padding:5px 12px;border-radius:8px;cursor:pointer;font:inherit}
.her-tab:hover{color:${TEXT}}
.her-tab.on{background:${LAYER1};color:${TEXT};font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.her-subtabs{margin:4px 0 8px}
.her-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(156px,1fr));gap:8px;margin:10px 0}
.her-place{justify-content:flex-start;gap:14px}
.her-place>div{flex:1}
.her-place-pic{flex:none;width:56px;height:40px;color:${FAINT};--her-paper:${v('bg-layer-1-solid', 'Canvas')};opacity:.55;transition:opacity .15s}
.her-place.on .her-place-pic{opacity:1}
.her-place.sub{padding-top:4px;border-top:none}
.her-place-note{color:${WARN} !important}
.her-range{flex:none;display:inline-flex;align-items:center;gap:10px}
.her-range input{width:170px;accent-color:${INK}}
.her-range i{width:4.5em;font-style:normal;font-size:12px;color:${MUTED};font-variant-numeric:tabular-nums}
.her-flow{margin:10px 0;padding:0;list-style:none;counter-reset:step;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.her-flow li{counter-increment:step;position:relative;padding:10px 12px 10px 42px;border:1px solid ${LINE};border-radius:12px;background:${FIELD}}
.her-flow li::before{content:counter(step);position:absolute;left:11px;top:11px;width:22px;height:22px;border-radius:50%;background:${INK};color:${ON_INK};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.her-flow b{display:block}
.her-flow span{display:block;font-size:12.5px;color:${MUTED}}
.her-guide-tabs{margin:4px 0 6px}
.her-guide-tabs .her-pick{font:inherit;color:${TEXT};background:none;padding:5px 13px}
.her-guide-tabs .her-pick.on{color:${INK}}
.her-guide-tabs small{margin-left:5px;padding:0 6px;border-radius:999px;background:${tint(TEXT, 9)};color:${MUTED};font-size:11px;font-weight:500}
.her-guide-about{margin:0 2px 12px}
.her-guide-head{margin:0 0 2px}
.her-guide-head h2{margin:0;flex:1}
.her-spec{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.her-spec>div{flex:1 1 150px;padding:7px 11px;border-radius:10px;background:${FIELD}}
.her-spec dt{font-size:11.5px;color:${MUTED}}
.her-spec dd{margin:0;font-weight:600}
.her-guide-rules{margin:8px 0;padding-left:1.3em}
.her-guide-rules li{margin:2px 0}
.her-prompt{position:relative;margin:10px 0;border:1px solid ${tint(INK, 35)};border-radius:12px;background:${tint(INK, 6)}}
.her-prompt pre{margin:0;padding:12px 14px 44px;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12.5px;line-height:1.65;user-select:text;max-height:260px;overflow:auto}
.her-prompt .her-btn{position:absolute;right:10px;bottom:9px}
.her-guide-foot{margin:6px 0 0;align-items:flex-start}
.her-show-head{margin:0 0 10px;align-items:baseline}
.her-show-head h2{margin:0;flex:none}
.her-show-stage{position:relative;width:100%;aspect-ratio:100/50}
.her-show-screen{position:absolute;left:20%;top:10%;width:60%;height:76%;border-radius:10px;overflow:hidden;background:linear-gradient(160deg,#27527e,#0d2036);box-shadow:0 0 0 3px ${tint(TEXT, 18)},0 14px 34px rgba(0,0,0,.25);container-type:inline-size}
.her-show-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;display:block}
.her-show-fill.cover{object-fit:cover;object-position:50% 50%}
.her-show-canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%}
.her-show-screen .off{opacity:.22;filter:grayscale(1)}
.her-show-desk{position:absolute;inset:0}
.her-show-menubar{position:absolute;left:0;right:0;top:0;height:4.8%;display:flex;align-items:center;gap:1.6cqw;padding:0 2cqw;background:rgba(18,22,32,.5);backdrop-filter:blur(6px);color:#fff;font-size:1.7cqw;line-height:1}
.her-show-menubar i{width:3.6cqw;height:.7cqw;border-radius:99px;background:rgba(255,255,255,.55)}
.her-show-menubar i:first-child{width:1.4cqw;height:1.4cqw;border-radius:50%}
.her-show-menubar b{font-weight:700}
.her-show-menubar em{font-style:normal;opacity:.8}
.her-show-dsh{position:absolute;left:4%;top:11%;width:56%;height:69%;display:flex;border-radius:1.4cqw;overflow:hidden;background:${v('bg-base', 'Canvas')};color:${TEXT};box-shadow:0 1.4cqw 4cqw rgba(0,0,0,.4)}
.her-show-side{flex:none;width:22%;padding:9% 2.4cqw 0;display:flex;flex-direction:column;gap:1.5cqw;background:${LAYER2}}
.her-show-side i{height:1.5cqw;border-radius:99px;background:${tint(TEXT, 16)}}
.her-show-side i.on{background:${INK}}
.her-show-chat{position:relative;flex:1;padding:5% 4% 0;display:flex;flex-direction:column;gap:1.4cqw}
.her-show-chat p{margin:0;width:62%;height:2.6cqw;border-radius:1.3cqw 1.3cqw 1.3cqw .3cqw;background:${tint(INK, 20)}}
.her-show-chat p.you{align-self:flex-end;width:44%;border-radius:1.3cqw 1.3cqw .3cqw 1.3cqw;background:${tint(TEXT, 12)}}
.her-show-chat p.short{width:38%}
.her-show-box{position:absolute;left:7%;right:5%;bottom:7%;height:15%;display:flex;align-items:center;padding:0 2.2cqw;border-radius:1.6cqw;border:1px solid ${LINE};background:${LAYER1};color:${FAINT};font-size:1.5cqw;white-space:nowrap}
.her-show-ava{position:absolute;right:20%;bottom:100%;width:16%;aspect-ratio:1}
.her-show-ava img,.her-show-ava video{width:100%;height:100%;object-fit:contain;display:block}
.her-show-ava.none{border-radius:50%;border:1.5px dashed ${tint(TEXT, 40)};margin-bottom:.4cqw}
.her-show-webher{position:absolute;right:2%;bottom:24%;height:38%;aspect-ratio:9/16}
.her-show-pet{position:absolute;right:6%;bottom:0;height:60%;aspect-ratio:9/16;filter:drop-shadow(0 1cqw 1.6cqw rgba(0,0,0,.35))}
.her-show-pet.none,.her-show-webher.none{border-radius:45% 45% 10% 10%;border:1.5px dashed rgba(255,255,255,.7);background:rgba(255,255,255,.12);aspect-ratio:9/19;filter:none}
.her-show-webher.none{border-color:${tint(TEXT, 40)};background:${tint(TEXT, 6)}}
.her-show-bubble{position:absolute;right:4%;bottom:62%;max-width:34%;padding:1.1cqw 1.8cqw;border-radius:1.8cqw 1.8cqw .4cqw 1.8cqw;background:rgba(24,26,38,.88);color:#f2f3f8;font-size:1.75cqw;line-height:1.45;box-shadow:0 .8cqw 2.4cqw rgba(0,0,0,.3),0 0 0 1px ${tint(INK, 45)}}
.her-show-bar{position:absolute;left:30%;top:85.5%;width:32%;height:10%;display:flex;align-items:center;gap:1cqw;padding:0 1.2cqw 0 2cqw;border-radius:99px;background:rgba(24,26,38,.92);color:rgba(242,243,248,.55);font-size:1.5cqw;white-space:nowrap;box-shadow:0 .8cqw 2.4cqw rgba(0,0,0,.35),0 0 0 1px ${tint(INK, 45)}}
.her-show-bar span{flex:1;overflow:hidden;text-overflow:ellipsis}
.her-show-bar i{flex:none;width:3.4cqw;height:3.4cqw;border-radius:50%;background:rgba(242,243,248,.16)}
.her-show-bar i.send{background:${INK}}
.her-show-mark{position:absolute;translate:-50% -50%;width:17px;height:17px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${INK};color:${ON_INK};font-size:10.5px;font-weight:700;line-height:1;box-shadow:0 0 0 2px rgba(255,255,255,.9),0 2px 6px rgba(0,0,0,.4);opacity:1!important;filter:none!important}
.her-show-mark.warn{background:${WARN};color:#fff}
.her-show-mark.off{background:#8a8f99;color:#fff}
.her-show-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.her-show-lines line{stroke:${INK};stroke-width:1.3;opacity:.75}
.her-show-lines line.warn{stroke:${WARN}}
.her-show-lines line.off{stroke:${FAINT};stroke-dasharray:3 3}
.her-show-label{position:absolute;display:flex;flex-direction:column;gap:1px;max-width:18.6%;padding:5px 8px;border:1px solid transparent;border-radius:10px;background:none;color:${TEXT};font:inherit;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.her-show-label:hover{background:${HOVER};border-color:${LINE}}
.her-show-label b{display:flex;align-items:center;gap:5px;font-weight:600;font-size:12.5px;line-height:1.3}
.her-show-label b i{flex:none;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${tint(INK, 16)};color:${INK};font-style:normal;font-size:10px;font-weight:700}
.her-show-label small{display:block;font-size:11.5px;line-height:1.35;color:${MUTED}}
.her-show-label small .her-dot{margin-right:5px}
.her-show-label.left{left:0;translate:0 -50%;text-align:right;align-items:flex-end}
.her-show-label.left b{flex-direction:row-reverse}
.her-show-label.right{right:0;translate:0 -50%}
.her-show-label.top{top:0;translate:-50% 0;max-width:22%;align-items:center;text-align:center}
.her-show-label.bottom{bottom:0;translate:-50% 0;max-width:30%;align-items:center;text-align:center}
.her-sheet{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:18px;align-items:center}
.her-sheet-pic{border-radius:12px;overflow:hidden;background:${FIELD};aspect-ratio:16/9;display:flex}
.her-sheet-pic a{display:flex;width:100%}
.her-sheet-pic img{width:100%;height:100%;object-fit:contain;background:#fff}
.her-sheet-none{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:16px;border:1.5px dashed ${tint(TEXT, 30)};border-radius:12px;background:none;color:${TEXT};font:inherit;cursor:pointer;text-align:center}
.her-sheet-none:hover{border-color:${INK};color:${INK}}
.her-sheet-none span{max-width:30em;font-size:12.5px;color:${MUTED}}
.her-sheet-text h2{margin-top:0}
.her-sheet-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0}
.her-sheet-flow span{padding:2px 10px;border-radius:999px;background:${FIELD};font-size:12px}
.her-sheet-flow span.on{background:${INK};color:${ON_INK};font-weight:600}
.her-sheet-flow i{width:16px;height:1.5px;background:${FAINT};position:relative}
.her-sheet-flow i::after{content:"";position:absolute;right:-1px;top:-3px;border:3.5px solid transparent;border-left-color:${FAINT};border-right:none}
.her-hero-text h1{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px}
.her-hero-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.her-hero-who{flex:none;max-width:150px;height:24px;padding:0 22px 0 9px;border:1px solid ${LINE};border-radius:999px;background:${FIELD} ${CHEVRON} no-repeat right 7px center;color:${MUTED};font:inherit;font-size:12px;font-weight:500;appearance:none;-webkit-appearance:none;cursor:pointer}
.her-hero-who:hover{border-color:${INK};color:${INK}}
.her-title-who{margin-left:10px;padding:1px 9px;border-radius:999px;background:${tint(INK, 12)};color:${INK};font-size:12px;font-weight:600;vertical-align:middle}
.her-people-box{margin-bottom:16px}
.her-people{display:flex;gap:10px;overflow-x:auto;padding:3px 3px 8px;scrollbar-width:thin}
.her-person{position:relative;flex:none;width:132px;border:1px solid ${LINE};border-radius:14px;background:${LAYER1};transition:border-color .12s,background .12s}
.her-person:hover{background:${HOVER}}
.her-person.on{border-color:${INK};box-shadow:0 0 0 1px ${INK};background:${tint(INK, 9)}}
.her-person-main,.her-person.add{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;padding:12px 10px 10px;border:none;background:none;color:${TEXT};font:inherit;cursor:pointer;text-align:center;border-radius:14px}
.her-person.add{flex:none;width:132px;border:1px dashed ${LINE};background:none;color:${MUTED}}
.her-person.add:hover{border-color:${INK};color:${INK}}
.her-person-main:disabled{cursor:default}
.her-person-ava{width:52px;height:52px;margin-bottom:4px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${tint(INK, 18)};color:${INK};font-size:21px;font-weight:600}
.her-person-ava i{font-style:normal}
.her-person-ava img,.her-person-ava video{width:100%;height:100%;object-fit:cover}
.her-person.on .her-person-ava{box-shadow:0 0 0 2px ${LAYER1},0 0 0 4px ${tint(INK, 55)}}
.her-person b{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.her-person small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${MUTED};font-size:11.5px}
.her-person.on small{color:${INK};font-weight:600}
.her-person-x{position:absolute;right:4px;top:4px;width:22px;height:22px;border:none;border-radius:50%;background:none;color:${FAINT};font-size:15px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s}
.her-person:hover .her-person-x,.her-person-x:focus-visible{opacity:1}
.her-person-x:hover{background:${tint(DANGER, 16)};color:${DANGER}}
.her-person-ask{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-radius:14px;background:${v('bg-layer-1-solid', 'Canvas')};font-size:12px}
.her-people-new{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:4px 0 8px;padding:10px 12px;border:1px solid ${LINE};border-radius:12px;background:${LAYER1}}
.her-people-new .her-input{width:220px}
.her-check{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.her-people-note{margin:2px 3px 0;font-size:12px}
.her-changing{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;border-radius:12px;border:1px solid ${INK};background:${v('bg-layer-1-solid', 'Canvas')};box-shadow:0 6px 20px rgba(0,0,0,.18)}
.her-changing i{width:14px;height:14px;border-radius:50%;border:2px solid ${tint(INK, 30)};border-top-color:${INK};animation:her-spin .8s linear infinite}
@keyframes her-spin{to{transform:rotate(360deg)}}
.her-choice{border:1px solid ${LINE};background:none;border-radius:12px;padding:10px 12px;cursor:pointer;text-align:left;color:${TEXT};font:inherit;font-weight:600;transition:border-color .12s,background .12s}
.her-choice:hover{background:${HOVER}}
.her-choice:disabled{opacity:.5;cursor:default}
.her-choice.on{border-color:${INK};background:${tint(INK, 9)};box-shadow:0 0 0 1px ${INK}}
.her-choice small{display:block;color:${MUTED};margin-top:3px;font-weight:400}
.her-choice.trying{border-style:dashed;border-color:${INK}}
.her-skins{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.her-swatch{position:relative;display:block;height:74px;margin-bottom:8px;border-radius:8px;overflow:hidden;border:1px solid ${LINE}}
.her-swatch i{position:absolute;left:0;top:0;bottom:0;width:26%}
.her-swatch b{position:absolute;right:10%;top:22%;width:44%;height:22%;border-radius:6px}
.her-swatch em{position:absolute;right:10%;bottom:16%;width:30%;height:14%;border-radius:999px}
.her-choices{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.her-pick{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border:1px solid ${LINE};border-radius:999px;cursor:pointer}
.her-pick input{display:none}
.her-pick:hover{background:${HOVER}}
.her-pick.on{border-color:${INK};background:${tint(INK, 12)};color:${INK};font-weight:600}
.her-pick.bad{color:${DANGER};border-color:${tint(DANGER, 50)};background:none}
.her-now{margin:2px 0 10px}
.her-now b{font-weight:600}
.her-now .her-dot{margin-left:10px}
.her-pending{position:sticky;bottom:8px;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;padding:8px 12px;border-radius:12px;border:1px solid ${INK};background:${v('bg-layer-1-solid', 'Canvas')};box-shadow:0 6px 20px rgba(0,0,0,.2)}
.her-pending span{flex:1;min-width:200px}
.her-summary{display:grid;grid-template-columns:auto 1fr auto auto;gap:6px 12px;align-items:center}
.her-summary-row{display:contents}
.her-summary-row b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.her-summary-note{font-size:12px;color:${MUTED};white-space:nowrap}

.her-list{list-style:none;margin:6px 0;padding:0}
.her-list li{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid ${LINE}}
.her-list li:last-child{border-bottom:none}
.her-list li .grow{flex:1;min-width:0;word-break:break-word}
.her-chat{background:${FIELD};border-radius:12px;padding:10px 12px;margin:8px 0;max-height:220px;overflow:auto}
.her-chat div{margin:3px 0}
.her-chat .you{color:${MUTED}}
.her-report{margin:6px 0;padding-left:0;list-style:none}
.her-report li{margin:2px 0}
.her-progress{height:6px;background:${FIELD};border-radius:3px;overflow:hidden;margin:8px 0}
.her-progress div{height:100%;background:${INK};transition:width .3s}

.her-versions{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:0 0 14px;padding:8px 14px;border-radius:12px;border:1px solid ${LINE};font-size:12px;color:${MUTED}}
.her-card .her-versions{border:none;padding:0;margin:0}
.her-versions b{font-weight:600;color:${TEXT}}
.her-versions code{font-size:11px}
.her-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.her-head h1{font-size:21px;font-weight:650;margin:0}
.her-head-right{display:flex;align-items:center;gap:10px}
.her-steps{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 16px}
.her-step{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;padding:4px 12px 4px 4px;border-radius:999px;background:none;color:${MUTED};border:1px solid transparent;cursor:pointer;font-family:inherit}
.her-step i{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${FIELD};font-style:normal;font-size:11.5px;font-weight:600}
.her-step:hover{background:${HOVER}}
.her-step.on{color:${INK};font-weight:600;border-color:${tint(INK, 40)};background:${tint(INK, 8)}}
.her-step.on i{background:${INK};color:${ON_INK}}
.her-step.done i{background:${tint(OK, 18)};color:${OK}}

.her-fold{display:flex;align-items:center;gap:10px;width:100%;border:none;background:none;padding:2px 0;color:${TEXT};font:inherit;cursor:pointer;text-align:left}
.her-fold h2{margin:0;flex:none}
.her-fold-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${tint(INK, 14)};color:${INK};transition:transform .15s}
.her-fold-arrow.open{transform:rotate(90deg)}
.her-fold:focus-visible{outline:2px solid ${INK};outline-offset:4px;border-radius:6px}
.her-fold-sum{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.her-fold-toggle{flex:none;font-size:12px;color:${FAINT}}
.her-foldcard.open .her-fold{margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid ${LINE}}

.her-manual{margin-top:10px;padding:10px 12px;border:1px solid ${LINE};border-radius:12px;background:${FIELD}}
.her-manual p{margin:8px 0 4px}
.her-manual-row{display:flex;align-items:center;gap:8px;margin:4px 0}
.her-manual-row .her-muted{flex:none;min-width:9em;font-size:12px}
.her-manual-row code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;user-select:all}
.her-manual .her-faint code{word-break:break-all;font-size:11px;user-select:all}
.her-frame{position:relative;margin:8px 0;cursor:crosshair;user-select:none;line-height:0;overflow:hidden}
.her-frame img{width:100%;display:block;border-radius:8px}
.her-frame-box{position:absolute;border:2px solid ${INK};box-shadow:0 0 0 9999px rgba(0,0,0,.45);pointer-events:none}
.her-examples{margin-top:12px}
.her-example-row{display:flex;gap:10px;flex-wrap:wrap}
.her-example{margin:0;width:150px}
.her-example img,.her-example video,.her-example-empty{width:150px;height:110px;object-fit:cover;border-radius:10px;background:${FIELD};display:block}
.her-example-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed ${LINE};color:${FAINT};font-size:11px;text-align:center;padding:6px}
.her-example-empty code{font-size:10px;word-break:break-all}
.her-example figcaption{font-size:11px;color:${MUTED};margin-top:3px}
.her-scenes{margin-top:4px}
.her-scene{margin:0;padding:8px 0;border-top:1px solid ${LINE}}
.her-scene label{min-width:8em}.her-scene .her-muted{flex:1}

.her-clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
.her-clips.avatar{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
.her-clips.desktop{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.her-clip{display:flex;flex-direction:column;gap:4px;min-width:0;padding:8px;border-radius:12px;border:1px solid ${LINE}}
.her-clip video,.her-clip-img{width:100%;aspect-ratio:9/16;object-fit:contain;background:${FIELD};border-radius:8px}
.her-clips.avatar video,.her-clips.avatar .her-clip-img{aspect-ratio:1}
.her-clips.desktop video,.her-clips.desktop .her-clip-img,.her-clips.intro video{aspect-ratio:16/9}
.her-clips.sheet{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.her-clips.sheet .her-clip-img{aspect-ratio:16/9}
.her-clips.pet video,.her-clips.pet .her-clip-img,.her-clips.avatar video,.her-clips.avatar .her-clip-img{background-color:${FIELD};background-image:linear-gradient(45deg,${tint(TEXT, 7)} 25%,transparent 25%,transparent 75%,${tint(TEXT, 7)} 75%),linear-gradient(45deg,${tint(TEXT, 7)} 25%,transparent 25%,transparent 75%,${tint(TEXT, 7)} 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.her-clip.off video{opacity:.35}
.her-clip .her-input{width:100%}
.her-clip .her-row{margin:4px 0 0;gap:4px}

.her-playcard.on{border-color:${tint(OK, 55)};background:linear-gradient(${tint(OK, 7)},${tint(OK, 7)}),${LAYER1}}
.her-playbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.her-stage-scroll{overflow-x:auto;margin:12px 0 4px;border:1px solid ${LINE};border-radius:12px}
.her-stage-table{border-collapse:separate;border-spacing:0;font-size:12px;min-width:100%}
.her-stage-table th,.her-stage-table td{border-right:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:8px;vertical-align:top;text-align:left;font-weight:400;min-width:150px;max-width:210px}
.her-stage-table tr:last-child td{border-bottom:none}
.her-stage-table th:last-child,.her-stage-table td:last-child{border-right:none}
.her-stage-table th{cursor:pointer;background:${tint(TEXT, 3)}}
.her-stage-table th:hover{background:${HOVER}}
.her-stage-table th.on,.her-stage-cell.on{outline:2px solid ${INK};outline-offset:-2px}
.her-stage-table th.off{opacity:.55}
.her-stage-table .her-stage-row,.her-stage-table th:first-child{min-width:52px;width:52px;color:${MUTED};font-weight:600;background:${tint(TEXT, 3)};cursor:default;vertical-align:middle}
.her-stage-table .her-stage-add{min-width:56px;width:56px;vertical-align:middle;text-align:center;cursor:default;background:none}
.her-stage-cell{cursor:pointer}
.her-stage-cell:hover{background:${HOVER}}
.her-stage-name{font-weight:650;font-size:13px;margin-top:6px}
.her-stage-panel{margin-top:0}
.her-thumb{position:relative;width:100%;max-width:190px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#0d1b2a;border:1px solid ${LINE}}
.her-thumb-desk{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.her-thumb-text{display:block;padding:3px 6px;color:#cfe3ff;font-size:10px;line-height:1.3;background:#1d3557;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.her-thumb-her{width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;font-size:11px;color:#0d1b2a;background:#9cc3ff;border-radius:40% 40% 6px 6px}
.her-thumb-dsh{position:absolute;right:6%;top:12%;width:38%;height:62%;border:1px solid rgba(255,255,255,.55);border-radius:3px;background:rgba(20,20,26,.55)}
.her-thumb-ava{position:absolute;right:12%;bottom:18%;width:22%;aspect-ratio:1;border-radius:50%;overflow:hidden;background:rgba(127,180,255,.6)}
.her-thumb-pet{position:absolute;left:6%;bottom:4%;width:22%;height:48%;overflow:hidden;color:#cfe3ff;font-size:10px;display:flex;align-items:flex-end;justify-content:center}
.her-thumb-fill{width:100%;height:100%;object-fit:contain}
.her-bigstage{position:relative;width:100%;max-width:720px;aspect-ratio:16/9;margin:8px 0;touch-action:none;user-select:none}
.her-bigstage>.her-thumb{position:absolute;inset:0;width:100%;height:100%;max-width:none}
.her-bigstage .her-thumb-pet{display:none}
.her-bigpet{position:absolute;transform:translate(-50%,-100%);border:2px dashed #9cc3ff;border-radius:40% 40% 8px 8px;background:rgba(156,195,255,.25);cursor:grab;display:flex;align-items:flex-end;justify-content:center;color:#cfe3ff;font-size:13px}
.her-bigpet-size{position:absolute;right:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:#9cc3ff;cursor:ns-resize}

`
