/**
 * Monotonic request gate for one selection context (an overlay session/generation
 * or a project panel workspace/cluster choice). Only the most recently issued
 * request may apply its response; superseded or invalidated tokens never do.
 */
export interface PactFlowRequestToken {
  readonly seq: number
}

export interface PactFlowRequestGate {
  /** Issue a new token; it becomes the only authoritative one. */
  next(): PactFlowRequestToken
  /** Whether this token is still the latest issued one. */
  isLatest(token: PactFlowRequestToken): boolean
  /** Supersede every outstanding token (context change); later tokens are authoritative again. */
  invalidate(): void
}

export function createRequestGate(): PactFlowRequestGate {
  let issued = 0
  // Starts at 0, so an invalidate() that jumps the watermark past every live token
  // cannot collide with a token that was never issued.
  let authoritative = -1
  return {
    next(): PactFlowRequestToken {
      issued += 1
      authoritative = issued
      return { seq: issued }
    },
    isLatest(token: PactFlowRequestToken): boolean {
      return token.seq === authoritative
    },
    invalidate(): void {
      authoritative = -1
    },
  }
}
