/**
 * Digits and a few symbols written out the way they are said, for the Ming
 * voice, which reads "2个" as "二个" (its MLX port has no text
 * normalization). Only what turns up in her chat: counts, times, dates,
 * years, percentages, decimals, phone numbers and codes, ranges, degrees.
 */

const DIGITS = '零一二三四五六七八九'
const SMALL_UNITS = ['', '十', '百', '千']
const BIG_UNITS = ['', '万', '亿']

/** Measure words after which 2 is 两 (两个, 两点, 两次 …). */
const MEASURE = /^(?:个|位|点|次|天|只|本|件|张|条|岁|种|遍|杯|分钟|小时|周|斤|块|台|辆|家|句|下|口|双|对|份|层|片|场|首|部|回|趟|步|顿|碗|瓶|盒|袋|根|颗|粒|间|座|所|名|人|样|批|年|星期|礼拜|倍)/
/** Words before a number that is read digit by digit. */
const DIGIT_CONTEXT = /(?:验证码|号码|电话|手机|编号|尾号|房间|门牌|邮编|工号|学号|密码|单号)[是为:：\s]*$/

/** "2026" → 二零二六. */
export function readDigits(digits: string): string {
  return [...digits].map(d => DIGITS[Number(d)]).join('')
}

/** "1205" → 一千二百零五; "12" → 十二; "20000" → 两万. Longer than 12 digits: one by one. */
export function readInteger(number: string): string {
  const digits = number.replace(/^0+(?=\d)/, '')
  if (digits.length > 12) return readDigits(digits)
  if (/^0+$/.test(digits)) return '零'
  const groups: number[] = []
  for (let end = digits.length; end > 0; end -= 4) groups.unshift(Number(digits.slice(Math.max(0, end - 4), end)))
  let out = ''
  let zero = false
  groups.forEach((group, i) => {
    const big = BIG_UNITS[groups.length - 1 - i]!
    if (group === 0) {
      zero = out !== ''
      return
    }
    if (out !== '' && (zero || group < 1000)) out += '零'
    zero = false
    out += readGroup(group) + big
  })
  return out.replace(/^一十/, '十').replace(/^二(?=[百千万亿])/, '两')
}

function readGroup(group: number): string {
  let out = ''
  let zero = false
  for (let pos = 3; pos >= 0; pos--) {
    const d = Math.floor(group / 10 ** pos) % 10
    if (d === 0) {
      zero = out !== ''
      continue
    }
    if (zero) out += '零'
    zero = false
    out += DIGITS[d]! + SMALL_UNITS[pos]!
  }
  return out
}

export function spokenNumbers(text: string): string {
  return text
    // 30% → 百分之三十; 2.5% → 百分之二点五
    .replace(/(\d+(?:\.\d+)?)\s*[%％]/g, (_w, n: string) => `百分之${readNumber(n)}`)
    // 15:30 → 十五点三十分; 9:05 → 九点零五分; 8:00 → 八点
    .replace(/(\d{1,2})[:：](\d{2})(?!\d)/g, (_w, h: string, m: string) => `${hour(h)}点${m === '00' ? '' : `${m.startsWith('0') ? '零' : ''}${readInteger(m)}分`}`)
    // 2026-10-31 → 二零二六年十月三十一日
    .replace(/(?<!\d)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g, (_w, y: string, m: string, d: string) => `${readDigits(y)}年${readInteger(m)}月${readInteger(d)}日`)
    // 2026年 → 二零二六年
    .replace(/(\d{4})(?=\s*年)/g, (_w, y: string) => readDigits(y))
    // 20~25度, 3-5个 → 到 (short numbers only: 2026-10-31 is a date)
    .replace(/(?<![\d-])(\d{1,3})\s*[~～—–-]\s*(\d{1,3})(?![\d-])/g, '$1到$2')
    .replace(/\s*(?:℃|°C|°)/g, '度')
    .replace(/(\d+)\.(\d+)/g, (_w, i: string, f: string) => `${readInteger(i)}点${readDigits(f)}`)
    .replace(/\d+/g, (n: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset)
      const after = whole.slice(offset + n.length)
      if (n.length >= 7 || (n.length > 1 && n.startsWith('0')) || DIGIT_CONTEXT.test(before)) return readDigits(n)
      if (n === '2' && MEASURE.test(after)) return '两'
      return readInteger(n)
    })
}

function readNumber(n: string): string {
  const [i, f] = n.split('.')
  return f === undefined ? readInteger(i!) : `${readInteger(i!)}点${readDigits(f)}`
}

/** 2 o'clock is 两点. */
function hour(h: string): string {
  return Number(h) === 2 ? '两' : readInteger(h)
}
