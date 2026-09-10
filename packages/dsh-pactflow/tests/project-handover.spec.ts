import { describe, expect, it } from 'vitest'
import { projectHandoverSummary } from '../src/project-handover.ts'

const snapshot = {
  project: { project: { id: 'session-1', name: 'Demo', revision: 3, createdAt: 1, updatedAt: 2,
    git: { remote: 'origin', remoteUrl: 'https://git.example/owner/repo.git', defaultBranch: 'main', revision: 1, boundAt: 2 } } },
  needs: { byId: { need: { id: 'need', title: 'N', description: '', phase: 'closing', revision: 8, createdAt: 1, updatedAt: 2 } } },
  dag: { byId: { node: { id: 'node', needId: 'need', title: 'Node', state: 'succeeded', revision: 2, dependencies: [], updatedAt: 3 } } },
  runs: { byId: { run: { id: 'run', nodeId: 'node', nodeRevision: 2, attempt: 1, provider: 'k3s',
    state: 'succeeded', claimId: 'c1', leaseExpiresAt: 9, startedAt: 4, git: { remote: 'origin', remoteUrl: 'https://git.example/owner/repo.git',
      defaultBranch: 'main', baseCommit: 'a'.repeat(40), branch: 'pactflow/need/node/x', worktreePath: '/tmp/wt', validationCommands: [] },
    gitResult: { branch: 'pactflow/need/node/x', commit: 'b'.repeat(40), remoteRef: 'refs/remotes/origin/pactflow/need/node/x', syncedAt: 5, validations: [] } } } },
  delivery: { reviews: {}, documents: {}, releases: {}, cleanups: {
    'cleanup-run-git': { id: 'cleanup-run-git', runId: 'run', target: 'git:pactflow/need/node/x', state: 'pending', attempt: 1, retain: true } } },
}

describe('PactFlow project handover summary', () => {
  it('summarises project, stage and unresolved responsibilities read-only', () => {
    const summary = projectHandoverSummary(snapshot as never)
    expect(summary.project.name).toBe('Demo')
    expect(summary.gitRemote).toBe('https://git.example/owner/repo.git')
    expect(summary.needs).toEqual([{ id: 'need', title: 'N', phase: 'closing', revision: 8 }])
    expect(summary.nodes).toEqual([{ id: 'node', needId: 'need', state: 'succeeded' }])
    // A retained/pending cleanup is an unresolved responsibility and must be surfaced.
    expect(summary.pendingCleanups).toHaveLength(1)
    expect(summary.pendingCleanups[0]).toMatchObject({ target: 'git:pactflow/need/node/x', retain: true })
    // Exact Git artifacts are referenced so the work is recoverable elsewhere.
    expect(summary.artifacts).toEqual([
      { runId: 'run', branch: 'pactflow/need/node/x', commit: 'b'.repeat(40) },
    ])
  })

  it('reports no project cleanly when none is bound', () => {
    const summary = projectHandoverSummary({ project: { project: null }, needs: { byId: {} }, dag: { byId: {} },
      runs: { byId: {} }, delivery: { reviews: {}, documents: {}, releases: {}, cleanups: {} } } as never)
    expect(summary.project).toBeNull()
    expect(summary.pendingCleanups).toEqual([])
    expect(summary.artifacts).toEqual([])
  })

  it('excludes succeeded cleanups from unresolved responsibilities', () => {
    const done = { ...snapshot, delivery: { ...snapshot.delivery,
      cleanups: { ...snapshot.delivery.cleanups, 'cleanup-done': { id: 'cleanup-done', target: 'git:other', state: 'succeeded', attempt: 1 } } } }
    const summary = projectHandoverSummary(done as never)
    expect(summary.pendingCleanups.map(record => record.id)).toEqual(['cleanup-run-git'])
  })
})
