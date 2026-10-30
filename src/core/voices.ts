/**
 * Her voices, shared by the brain and the "她" page. Which service speaks
 * follows from the voice she uses:
 * - edge: Microsoft Edge "Read aloud" voices via the edge-tts tool (free,
 *   needs the internet; voice/edge.ts);
 * - cosyvoice: Alibaba Cloud Model Studio (百炼) CosyVoice, model
 *   cosyvoice-v3-flash (needs a key and paid quota; voice/cosyvoice.ts). Its
 *   ids are the API's `voice` parameter, exactly as listed.
 */

export const VOICE_MODEL = 'cosyvoice-v3-flash'

export type VoiceService = 'edge' | 'cosyvoice'

export interface VoiceOption {
  id: string
  name: string
  desc: string
  service: VoiceService
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
]

export const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

export function voiceName(id: string): string {
  return VOICES.find(v => v.id === id)?.name ?? id
}

/** Which service a voice belongs to; an id not in the list goes by its shape (Edge ids end in "Neural"). */
export function serviceOf(id: string): VoiceService {
  return VOICES.find(v => v.id === id)?.service ?? (/Neural$/.test(id) ? 'edge' : 'cosyvoice')
}

export const SERVICE_NAMES: Record<VoiceService, string> = {
  edge: '微软 Edge（免费，要联网）',
  cosyvoice: '阿里云百炼 CosyVoice（要 key，按字数付费）',
}
