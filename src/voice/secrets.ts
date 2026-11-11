/**
 * Keys for outside voice services, never in chat, logs or ordinary config:
 * on macOS in the keychain (service `dsh-her-<name>`, written through
 * `security -i` on stdin so the key is not on any command line); elsewhere
 * in `<home>/secrets.json`, readable by you only (600).
 */

import { execFile, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const keychainService = (name: string) => `dsh-her-${name}`
const quote = (value: string) => `"${value.replace(/["\\]/g, c => `\\${c}`)}"`

export class Secrets {
  private readonly file: string
  private readonly keychain: boolean

  constructor(home: string, keychain = process.platform === 'darwin') {
    this.file = join(home, 'secrets.json')
    this.keychain = keychain
  }

  private readFile(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  async get(name: string): Promise<string | undefined> {
    if (!/^[\w.-]+$/.test(name)) return undefined
    if (!this.keychain) return this.readFile()[name] || undefined
    return new Promise(resolve => {
      execFile('security', ['find-generic-password', '-a', 'dsh-her', '-s', keychainService(name), '-w'], { timeout: 10_000 }, (error, stdout) => {
        const value = String(stdout).trim()
        resolve(error === null && value !== '' ? value : undefined)
      })
    })
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined
  }

  /** Keep a key (empty: forget it). */
  async set(name: string, value: string): Promise<void> {
    if (!/^[\w.-]+$/.test(name)) throw new Error('名字不对')
    const key = value.trim()
    if (/[\r\n]/.test(key)) throw new Error('key 里不能有换行')
    if (!this.keychain) {
      const all = this.readFile()
      if (key === '') delete all[name]
      else all[name] = key
      mkdirSync(join(this.file, '..'), { recursive: true })
      writeFileSync(this.file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
      chmodSync(this.file, 0o600)
      return
    }
    const command = key === ''
      ? `delete-generic-password -a dsh-her -s ${quote(keychainService(name))}\n`
      : `add-generic-password -U -a dsh-her -s ${quote(keychainService(name))} -w ${quote(key)}\n`
    await new Promise<void>((resolve, reject) => {
      const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let error = ''
      child.stderr.on('data', chunk => { error += String(chunk) })
      child.on('error', reject)
      child.on('close', () => (key !== '' && /error/i.test(error) ? reject(new Error('存进钥匙串没成功')) : resolve()))
      child.stdin.end(command)
    })
  }
}
