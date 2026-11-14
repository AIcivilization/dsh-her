/**
 * Her voices, shared by the brain and the "她" page. Which service speaks
 * follows from the voice she uses:
 * - edge: Microsoft Edge "Read aloud" voices via the edge-tts tool (free,
 *   needs the internet; voice/edge.ts);
 * - cosyvoice: Alibaba Cloud Model Studio (百炼) CosyVoice, model
 *   cosyvoice-v3-flash (needs a key and paid quota; voice/cosyvoice.ts). Its
 *   ids are the API's `voice` parameter, exactly as listed;
 * - ming: Ming-3.0-tts on this computer (Mac, Windows and Linux on x64; voice/ming.ts). Built-in
 *   voices are `ming:<name>`; voices made on the "她" page (designed from a
 *   description, or cloned from a recording) are `ming-own:<id>`.
 */

export const VOICE_MODEL = 'cosyvoice-v3-flash'

export type VoiceService = 'edge' | 'cosyvoice' | 'ming' | 'ext'

export interface VoiceOption {
  id: string
  name: string
  desc: string
  service: VoiceService
  /** Ming voices recorded in several moods: the moods it has (`灵风信_高兴` …). */
  moods?: readonly string[]
}

export const VOICES: readonly VoiceOption[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', desc: '温暖，自然', service: 'edge' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', desc: '活泼，可爱', service: 'edge' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻', desc: '温柔，台湾腔', service: 'edge' },
  { id: 'zh-TW-HsiaoYuNeural', name: '曉雨', desc: '清亮，台湾腔', service: 'edge' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北', desc: '爽朗，东北话', service: 'edge' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮', desc: '陕西话', service: 'edge' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼', desc: '粤语', service: 'edge' },
  { id: 'longanrou_v3', name: '龙安柔', desc: '温柔，像闺蜜', service: 'cosyvoice' },
  { id: 'longxing_v3', name: '龙星', desc: '温婉，邻家女孩', service: 'cosyvoice' },
  { id: 'longanhuan_v3', name: '龙安欢', desc: '欢脱元气', service: 'cosyvoice' },
  { id: 'longanqin_v3', name: '龙安亲', desc: '亲和，开朗', service: 'cosyvoice' },
  { id: 'longanling_v3', name: '龙安灵', desc: '机灵，活泼', service: 'cosyvoice' },
  { id: 'longhua_v3', name: '龙华', desc: '元气，甜美', service: 'cosyvoice' },
  { id: 'longfeifei_v3', name: '龙菲菲', desc: '甜美，爱撒娇', service: 'cosyvoice' },
  { id: 'longantai_v3', name: '龙安台', desc: '嗲甜，台湾腔', service: 'cosyvoice' },
  { id: 'longwan_v3', name: '龙婉', desc: '细腻，柔声', service: 'cosyvoice' },
  { id: 'longyingling_v3', name: '龙应聆', desc: '温和，会共情', service: 'cosyvoice' },
  { id: 'longanwen_v3', name: '龙安温', desc: '优雅，知性', service: 'cosyvoice' },
  { id: 'longxiaochun_v3', name: '龙小淳', desc: '知性，积极', service: 'cosyvoice' },
  // Ming's built-in voices that suit her: grown-up women, warm or sweet (the catalog's "girlfriend" voices).
  { id: 'ming:灵风信', name: '灵风信', desc: '体贴，温暖安心，带情绪', service: 'ming', moods: ['中性', '高兴', '悲伤', '生气', '厌恶'] },
  { id: 'ming:灵雨汐', name: '灵雨汐', desc: '软糯，有气声，带情绪', service: 'ming', moods: ['中性', '高兴', '悲伤', '惊讶', '恐惧'] },
  { id: 'ming:灵梦', name: '灵梦', desc: '很甜，爱撒娇', service: 'ming' },
  { id: 'ming:灵恬', name: '灵恬', desc: '甜蜜，温柔', service: 'ming' },
  { id: 'ming:灵小汐', name: '灵小汐', desc: '清甜，自然', service: 'ming' },
  { id: 'ming:灵小芸', name: '灵小芸', desc: '温和，像知心朋友', service: 'ming' },
]

export const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

export function voiceName(id: string): string {
  return VOICES.find(v => v.id === id)?.name ?? id
}

/** Which service a voice belongs to; an id not in the list goes by its shape (Edge ids end in "Neural"). */
export function serviceOf(id: string): VoiceService {
  if (id.startsWith('ming:') || id.startsWith(OWN_PREFIX)) return 'ming'
  // A voice of an outside service (讯飞, an OpenAI-style one, GPT-SoVITS, a plugin): ext:<provider>:<voice>.
  if (id.startsWith('ext:')) return 'ext'
  return VOICES.find(v => v.id === id)?.service ?? (/Neural$/.test(id) ? 'edge' : 'cosyvoice')
}

/** A Ming voice made on the "她" page. */
export const OWN_PREFIX = 'ming-own:'

/** Her emotions (core/cues.ts) as Ming moods; the others are said plainly. */
export const MING_MOODS: Record<string, string> = { happy: '高兴', sad: '悲伤', angry: '生气', surprised: '惊讶' }

/** How Ming says a sentence in a voice: a built-in voice (its mood version when it has one) or one of your own, plus mood and speed. */
export function mingSpeech(id: string, emotion: string | undefined, speed: number): { voice?: string; own?: string; emotion?: string; speed?: string } {
  const mood = emotion === undefined ? undefined : MING_MOODS[emotion]
  const pace = speed < 0.9 ? '慢速' : speed > 1.1 ? '快速' : undefined
  const extra = { ...(pace === undefined ? {} : { speed: pace }) }
  if (id.startsWith(OWN_PREFIX)) return { own: id.slice(OWN_PREFIX.length), ...(mood === undefined ? {} : { emotion: mood }), ...extra }
  const name = id.slice('ming:'.length)
  const moods = VOICES.find(v => v.id === id)?.moods
  if (moods !== undefined) return { voice: `${name}_${mood !== undefined && moods.includes(mood) ? mood : '中性'}`, ...extra }
  return { voice: name, ...(mood === undefined ? {} : { emotion: mood }), ...extra }
}

export const SERVICE_NAMES: Record<VoiceService, string> = {
  edge: '微软 Edge（免费，要联网）',
  cosyvoice: '阿里云百炼 CosyVoice（要 key，按字数付费）',
  ming: '本机 Ming（离线、免费、能表达情绪；Mac、Windows、Linux 都能用，下载约 2 GB）',
  ext: '外接的语音服务（讯飞、OpenAI 兼容、GPT-SoVITS、别的插件）',
}
