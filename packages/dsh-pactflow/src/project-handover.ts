/**
 * Read-only project handover summary.
 *
 * Even if the plugin never starts again, a project must remain explainable: what
 * it was, where it got to, which exact Git artifacts exist, and which
 * responsibilities are still open. This module only *reads* a snapshot; it never
 * mutates state and never writes anything.
 */
import type { PactFlowHandoverSummary } from './types.ts'
import { validationExecutedCount } from './validation-integrity.ts'

export type { PactFlowHandoverSummary }

type AnyRecord = Record<string, any>

/**
 * Versions that make an old log's reader traceable. Supplied by the caller
 * (the Host owns the build/registration facts) so this derivation stays pure and
 * testable; they are never caller-supplied by accident because the only caller
 * passes its own build constants.
 */
export interface PactFlowHandoverVersions {
  readonly packageVersion: string
  readonly eventProducerVersion: string
}

/** Derive a read-only handover summary from a project snapshot. */
export function projectHandoverSummary(snapshot: AnyRecord, versions: PactFlowHandoverVersions): PactFlowHandoverSummary {
  const project = snapshot?.project?.project ?? null
  const needs = Object.values(snapshot?.needs?.byId ?? {}) as AnyRecord[]
  const nodes = Object.values(snapshot?.dag?.byId ?? {}) as AnyRecord[]
  const runs = Object.values(snapshot?.runs?.byId ?? {}) as AnyRecord[]
  const cleanups = Object.values(snapshot?.delivery?.cleanups ?? {}) as AnyRecord[]

  const artifacts = runs
    .filter(run => run?.gitResult?.branch !== undefined && run?.gitResult?.commit !== undefined)
    .map(run => ({
      runId: String(run.id), branch: String(run.gitResult.branch), commit: String(run.gitResult.commit),
      // Zero is a first-class signal here: "delivered but nothing was verified" must be
      // readable from the handover, not inferred from an empty array elsewhere.
      validationsExecuted: validationExecutedCount({ validations: run.gitResult.validations ?? [] }),
    }))
    .sort((left, right) => left.runId.localeCompare(right.runId))

  const pendingCleanups = cleanups
    .filter(record => record?.state !== 'succeeded')
    .map(record => ({
      id: String(record.id), target: String(record.target), state: String(record.state),
      ...record.retain === true ? { retain: true } : {},
      // A03-c: report how many host-baseline assertions ran for a pending closing.
      ...Array.isArray(record?.closing?.baselineValidations)
        ? { baselineValidationsExecuted: record.closing.baselineValidations.length }
        : {},
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    project: project === null
      ? null
      : { id: String(project.id), name: String(project.name), revision: Number(project.revision) },
    ...project?.git?.remoteUrl === undefined ? {} : { gitRemote: String(project.git.remoteUrl) },
    ...project?.git?.defaultBranch === undefined ? {} : { defaultBranch: String(project.git.defaultBranch) },
    needs: needs.map(need => ({
      id: String(need.id), title: String(need.title), phase: String(need.phase), revision: Number(need.revision),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    nodes: nodes.map(node => ({
      id: String(node.id), needId: String(node.needId), state: String(node.state),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    artifacts,
    pendingCleanups,
    packageVersion: versions.packageVersion,
    eventProducerVersion: versions.eventProducerVersion,
  }
}
