/**
 * 作品墙: design packs people sent in with the 设计包投稿 form and a
 * maintainer marked 精选. Read live from GitHub's public API, so a new pick
 * shows up without touching this page. Everything from an issue is shown as
 * text; only https links are followed.
 */

const REPO = 'AIcivilization/dsh-her'
const SEARCH = `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue label:设计包 label:精选`)}&sort=created&order=desc&per_page=24`

interface Issue { html_url: string; title: string; body: string | null; user: { login: string; html_url: string } }

/** The answers of an issue form: `### 名字\n\n值`. */
function answers(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of body.split(/^### /m).slice(1)) {
    const nl = part.indexOf('\n')
    const value = part.slice(nl + 1).trim()
    out[part.slice(0, nl).trim()] = value === '_No response_' ? '' : value
  }
  return out
}

const httpsOnly = (s: string | undefined): string | undefined => {
  const m = /https:\/\/[^\s)"'<>]+/.exec(s ?? '')
  return m?.[0]
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function card(issue: Issue): HTMLElement {
  const a = answers(issue.body ?? '')
  const about = a['介绍和预览'] ?? ''
  const picture = /!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/.exec(about)?.[1] ?? /<img[^>]*src="(https:\/\/[^"]+)"/.exec(about)?.[1]
  const words = about.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

  const box = el('article', 'work')
  if (picture) {
    const img = el('img')
    img.src = picture
    img.alt = ''
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    box.append(img)
  } else box.append(el('div', 'work-blank', '🐳'))
  const text = el('div', 'work-text')
  text.append(el('h3', '', a['名字'] || issue.title.replace(/^\[?设计包\]?[:：]?\s*/, '')))
  if (a['是什么']) text.append(el('p', 'work-kind', a['是什么'].split(/,\s*/).join(' · ')))
  if (words) text.append(el('p', 'work-about', words.length > 90 ? `${words.slice(0, 90)}…` : words))
  const foot = el('p', 'work-foot')
  const by = el('a', '', `@${issue.user.login}`)
  by.href = issue.user.html_url
  foot.append(by)
  if (a['许可']) foot.append(` · ${a['许可']}`)
  text.append(foot)
  const links = el('p', 'work-links')
  const get = httpsOnly(a['下载链接'])
  if (get) {
    const g = el('a', 'btn small', '下载')
    g.href = get
    g.rel = 'noopener nofollow'
    links.append(g)
  }
  const more = el('a', 'btn small ghost', '介绍')
  more.href = issue.html_url
  links.append(more)
  text.append(links)
  box.append(text)
  return box
}

const wall = document.getElementById('works-wall')
if (wall !== null) {
  fetch(SEARCH, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data: { items: Issue[] }) => {
      if (data.items.length === 0) return
      wall.replaceChildren(...data.items.map(card))
    })
    .catch(() => { /* the empty note stays */ })
}
