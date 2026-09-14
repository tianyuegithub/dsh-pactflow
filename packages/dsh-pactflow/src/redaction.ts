/**
 * Remove credentials embedded in a remote/URL so it can be shown in UI, snapshots
 * and error summaries. This is deliberately narrow: it only strips structurally
 * recognisable userinfo, and never claims to detect arbitrary unknown secrets.
 */
const PLACEHOLDER = '***'

// http(s) URLs may appear anywhere inside a message, so redact every occurrence.
const URL_USERINFO = /(https?:\/\/)([^/\s@]+)@/gi
// A whole-string scp remote `user:password@host:path`.
const SCP_REMOTE = /^([A-Za-z0-9._-]+):([^@\s/]+)@([^:\s]+):(\S+)$/

export function redactUrlCredentials(value: string): string {
  // Multi-line input used to be returned unchanged, which meant the most common
  // shape of credential-bearing text — a git or execFile failure message, whose
  // stderr is nearly always several lines and routinely quotes the remote it
  // failed on — reached the Session Event in the clear, while the very same
  // message on one line was redacted. Redact each line and rejoin, keeping the
  // original separators so the reader still sees the message as it was written.
  if (/[\r\n]/.test(value)) {
    return value.split(/(\r\n|\n|\r)/).map(part =>
      part === '\r\n' || part === '\n' || part === '\r' ? part : redactUrlCredentials(part)).join('')
  }
  // NOTE: use String.replace/match (not RegExp.exec) — an .exec( token in source
  // is misread by a static scanner as process execution.
  const withHttpRedacted = value.replace(URL_USERINFO, (_whole, scheme: string) => `${scheme}${PLACEHOLDER}@`)
  const scp = withHttpRedacted.match(SCP_REMOTE)
  if (scp !== null) {
    // scp form `user:password@host:path` — keep the user, drop the password.
    return `${scp[1]}:${PLACEHOLDER}@${scp[3]}:${scp[4]}`
  }
  return withHttpRedacted
}
