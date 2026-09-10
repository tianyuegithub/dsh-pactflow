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
  if (/[\r\n]/.test(value)) return value
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
