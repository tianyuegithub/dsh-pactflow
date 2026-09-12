const hidden = '[凭证已隐藏]'
const sensitiveKey = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i
/** Structural credential forms plus known runtime values; not arbitrary secret inference. */
export function redactWorkerText(text: string, known: readonly string[] = []): string {
  let value = known.reduce((current, secret) => secret.length >= 8 ? current.split(secret).join(hidden) : current, text)
  value = value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, hidden)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, hidden)
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, `$1${hidden}`)
  return value.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try {
      const url = new URL(raw)
      if (url.username || url.password) { url.username = 'redacted'; url.password = '' }
      for (const key of [...url.searchParams.keys()]) if (sensitiveKey.test(key)) url.searchParams.set(key, 'redacted')
      return url.toString()
    } catch { return '[无效地址已隐藏]' }
  })
}
export function redactWorkerArguments(raw: string, known: readonly string[] = []): string {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return raw ? '[非结构化工具参数不向宿主传输]' : '' }
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 12) return '[内容层级超限]'
    if (typeof value === 'string') return redactWorkerText(value, known)
    if (Array.isArray(value)) return value.slice(0, 128).map(item => walk(item, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 128)
      .map(([key, item]) => [key, sensitiveKey.test(key) ? hidden : walk(item, depth + 1)]))
    return value
  }
  return JSON.stringify(walk(parsed, 0), null, 2)
}
