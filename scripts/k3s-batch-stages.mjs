/**
 * Pure judgement helpers for the real-K3s batch TTL and zero-proof stages.
 *
 * Kept separate from the kubectl-driving stage functions so the decision logic is
 * unit-testable without a cluster. Running the stages against a real cluster is a
 * B-class operation and is not covered here.
 */

/** Build a short-TTL probe Job whose only purpose is to prove ttl-after-finished. */
export function buildTtlProbeJob(input) {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      ttlSecondsAfterFinished: input.ttlSeconds,
      backoffLimit: 0,
      template: {
        spec: {
          restartPolicy: 'Never',
          containers: [{
            name: 'ttl-probe',
            image: input.image,
            command: ['sh', '-c', 'exit 0'],
          }],
        },
      },
    },
  }
}

/**
 * Decide whether a probe Job was recycled by ttl-after-finished. TTL only starts
 * after the Job reaches Complete/Failed, so a Job that never finished cannot have
 * been recycled (W3: manual deletion is not proof either, so absence of a finished
 * Job is the observation).
 */
export function evaluateTtlRecycle(input) {
  if (!input.finished) return { recycled: false, reason: 'not-finished' }
  if (!input.exists) return { recycled: true, reason: 'recycled' }
  return { recycled: false, reason: 'still-present' }
}

/**
 * Zero-proof judgement: the batch is clean only when every resource it tracked is
 * confirmed absent BY UID (a same-name object with another UID is a replacement, not
 * our resource), and there is no unexplained leftover. Tracked-then-vanished is a
 * success for our responsibility; a replacement is recorded separately.
 */
export function evaluateZeroProof(input) {
  const presentByKey = new Map(input.present.map(entry => [`${entry.kind}:${entry.name}`, entry]))
  const remaining = []
  const replaced = []
  for (const tracked of input.tracked) {
    const found = presentByKey.get(`${tracked.kind}:${tracked.name}`)
    if (found === undefined) continue
    if (found.uid === tracked.uid) remaining.push(tracked)
    else replaced.push({ kind: found.kind, name: found.name, uid: found.uid })
  }
  const unexplained = [...input.unexplained]
  return {
    zero: remaining.length === 0 && unexplained.length === 0,
    remaining,
    replaced,
    unexplained,
  }
}
