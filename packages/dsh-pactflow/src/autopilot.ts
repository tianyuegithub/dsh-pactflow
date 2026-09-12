import { z } from 'zod'
import { executionDigest } from './execution-plan.ts'
import type { PactFlowAutopilotRecord, PactFlowSnapshot } from './types.ts'

export const autopilotLimitsSchema = z.object({
  maxDurationMs: z.number().int().min(60_000).max(86_400_000),
  maxModelSteps: z.number().int().min(1).max(1000),
  maxWorkerStarts: z.number().int().min(1).max(100),
  maxConcurrency: z.number().int().min(1).max(12),
  maxStalledTurns: z.number().int().min(1).max(10),
}).strict()

export const autopilotRecordSchema = z.object({
  id: z.string().min(1), needId: z.string().min(1), revision: z.number().int().positive(),
  state: z.enum(['running', 'paused', 'blocked', 'stopped', 'completed']), scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  repository: z.string(), branch: z.string(), limits: autopilotLimitsSchema,
  startedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(), startSequence: z.number().int().nonnegative(),
  initialRunIds: z.array(z.string()),
  modelSteps: z.number().int().nonnegative(), wakeCount: z.number().int().nonnegative(), stalledTurns: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(), reason: z.string().max(4096),
  lastProgressDigest: z.string().optional(), lastWakeId: z.string().optional(),
})

export function autopilotProgress(snapshot: PactFlowSnapshot, needId: string): string {
  const nodes = Object.values(snapshot.dag.byId).filter(node => node.needId === needId)
  const nodeIds = new Set(nodes.map(node => node.id))
  return executionDigest({ phase: snapshot.needs.byId[needId]?.phase,
    nodes: nodes.map(node => ({ id: node.id, state: node.state })).sort((a, b) => a.id.localeCompare(b.id)),
    commits: Object.values(snapshot.runs.byId).filter(run => nodeIds.has(run.nodeId) && run.state === 'succeeded')
      .map(run => run.gitResult?.commit).filter(Boolean).sort(),
    release: snapshot.delivery.releases[needId]?.commit,
  })
}

export function autopilotWorkerCounts(snapshot: PactFlowSnapshot, record: PactFlowAutopilotRecord): { active: number; starts: number } {
  const nodes = new Set(Object.values(snapshot.dag.byId).filter(node => node.needId === record.needId).map(node => node.id))
  const runs = Object.values(snapshot.runs.byId).filter(run => nodes.has(run.nodeId))
  return { active: runs.filter(run => !['succeeded', 'failed', 'cancelled', 'expired'].includes(run.state)).length,
    starts: runs.filter(run => !record.initialRunIds.includes(run.id)).length }
}
