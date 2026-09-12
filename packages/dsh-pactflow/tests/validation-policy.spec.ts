import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import * as PactFlowAgentTools from '../presets/pactflow/plugin/index.js'
import type { PactFlowRun, PactFlowValidationPolicyGroup, PactFlowWorkspaceProjectConfig } from '../src/types.ts'

// A03-b: the owner-written minimum validation policy is enforced by the Host at
// closing (every delivered artifact must carry successful evidence for each
// required profile) and is unreachable from the model's tool surface.
const WORKSPACE_ID = 'policy-workspace'

function runWithEvidence(command: string, args: readonly string[], exitCode = 0): PactFlowRun {
  return {
    id: 'run-1', nodeId: 'node-1', nodeRevision: 2, attempt: 1, provider: 'git', claimId: 'c1',
    state: 'succeeded', leaseDeadline: Date.now() + 60_000, leaseDurationMs: 60_000, updatedAt: Date.now(),
    git: { remote: 'origin', remoteUrl: 'https://git.example/o/r.git', defaultBranch: 'main',
      baseCommit: 'a'.repeat(40), branch: 'pactflow/need/node/x', worktreePath: '/tmp/wt', validationCommands: [] },
    gitResult: { branch: 'pactflow/need/node/x', commit: 'b'.repeat(40),
      remoteRef: 'refs/remotes/origin/pactflow/need/node/x', syncedAt: Date.now(),
      validations: [{ command, args: [...args], timeoutMs: 5_000, exitCode, durationMs: 5 }] },
  }
}

const BINDING = {
  remote: 'origin', remoteUrl: 'https://git.example/o/r.git', defaultBranch: 'main',
  revision: 1, boundAt: Date.now(), validationCommands: [],
  validationProfileIds: ['first'],
}

const CONFIG: PactFlowWorkspaceProjectConfig = {
  schema: 'dsh_pactflow_workspace_project/v1', workspaceId: WORKSPACE_ID,
  workspacePath: '/tmp/repo', workspaceTitle: 'Policy', revision: 1, createdAt: 1, updatedAt: 1,
  validationProfiles: [
    { id: 'first', displayName: '状态检查', revision: 1, command: 'git', args: ['status'], timeoutMs: 5_000 },
    { id: 'second', displayName: '差异检查', revision: 1, command: 'git', args: ['diff', '--check'], timeoutMs: 5_000 },
  ],
  validationProfileIds: ['first'],
}

async function enforce(policy: readonly PactFlowValidationPolicyGroup[] | undefined, runs: readonly PactFlowRun[]): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  try {
    const method = Reflect.get(ctx.pactflow, 'enforceValidationPolicy') as (
      binding: unknown, taskRuns: readonly PactFlowRun[], config: PactFlowWorkspaceProjectConfig | undefined,
    ) => void
    method.call(ctx.pactflow, BINDING, runs, policy === undefined ? CONFIG : { ...CONFIG, validationPolicy: policy })
  } finally { await ctx.fiber.dispose() }
}

describe('PactFlow minimum validation policy', () => {
  it('passes when every required profile has successful evidence on each artifact', async () => {
    await expect(enforce(
      [{ id: 'closing', profileIds: ['first'] }],
      [runWithEvidence('git', ['status'])],
    )).resolves.toBeUndefined()
  })

  it('fails closed naming the missing profile when evidence is absent or failing', async () => {
    await expect(enforce([{ id: 'closing', profileIds: ['second'] }], [runWithEvidence('git', ['status'])]))
      .rejects.toThrow(/missing: 差异检查/)
    await expect(enforce([{ id: 'closing', profileIds: ['first'] }], [runWithEvidence('git', ['status'], 1)]))
      .rejects.toThrow(/missing: 状态检查/)
  })

  it('fails closed naming a profile that is not selected in the binding or no longer exists', async () => {
    await expect(enforce([{ id: 'closing', profileIds: ['second'] }], [
      runWithEvidence('git', ['diff', '--check']),
      runWithEvidence('git', ['diff', '--check']),
    ])).rejects.toThrow(/not selected in the bound validation set/)
    await expect(enforce([{ id: 'closing', profileIds: ['ghost'] }], [runWithEvidence('git', ['status'])]))
      .rejects.toThrow(/registered profile no longer exists/)
  })

  it('leaves closing behavior unchanged when no policy is configured', async () => {
    await expect(enforce(undefined, [runWithEvidence('git', ['nothing'])])).resolves.toBeUndefined()
    await expect(enforce([], [runWithEvidence('git', ['nothing'])])).resolves.toBeUndefined()
  })

  it('is unreachable from the agent tool surface (owner-only configuration)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-policy-plane-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const session = ctx.sessions.create(SessionId('policy-plane'), { meta: { agentPreset: 'pactflow' } })
    const agent = { id: session.id, session } as Agent
    const scope = createScope(ctx, agent)
    await scope.ctx.plugin(PactFlowAgentTools)
    try {
      const tools = ctx.tools.schemas(agent).filter(schema => schema.name.startsWith('pactflow_'))
      const offenders = tools.map(tool => tool.name).filter(name => /policy/i.test(name))
      expect(offenders, offenders.join(', ')).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('saves the policy through the owner path, validates references, and refuses deleting referenced profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-policy-store-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    try {
      const workspacePath = join(root, 'repo')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(workspacePath, { recursive: true })
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const registeredWorkspace = { id: WORKSPACE_ID, path: workspacePath, title: 'Policy', sessionIds: [] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
      const firstSave = await ctx.pactflow.saveValidationProfiles({ workspaceId: WORKSPACE_ID, expectedRevision: 0,
        profiles: [
          { id: 'first', displayName: '状态检查', command: 'git', args: ['status'], timeoutMs: 5000 },
          { id: 'second', displayName: '差异检查', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
        ] })
      // Unknown profile references are rejected at save time.
      await expect(ctx.pactflow.saveValidationPolicy({ workspaceId: WORKSPACE_ID,
        expectedRevision: firstSave.revision, groups: [{ id: 'closing', profileIds: ['ghost'] }] }))
        .rejects.toThrow(/unknown profile "ghost"/)
      // A valid save round-trips and is readable from the workspace config.
      const saved = await ctx.pactflow.saveValidationPolicy({ workspaceId: WORKSPACE_ID,
        expectedRevision: firstSave.revision, groups: [{ id: 'closing', profileIds: ['first'] }] })
      expect(saved.validationPolicy).toEqual([{ id: 'closing', profileIds: ['first'] }])
      const readBack = (await ctx.pactflow.listWorkspaceProjects())
        .find(row => row.workspaceId === WORKSPACE_ID)?.config
      expect(readBack?.validationPolicy).toEqual([{ id: 'closing', profileIds: ['first'] }])
      // Deleting a policy-referenced profile is refused (the policy would dangle).
      await expect(ctx.pactflow.saveValidationProfiles({ workspaceId: WORKSPACE_ID,
        expectedRevision: saved.revision, profiles: [
          { id: 'second', displayName: '差异检查', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
        ] })).rejects.toThrow(/referenced by the closing validation policy/)
      // An empty submission clears the policy, after which deletion is fine.
      const cleared = await ctx.pactflow.saveValidationPolicy({ workspaceId: WORKSPACE_ID,
        expectedRevision: saved.revision, groups: [] })
      expect(cleared.validationPolicy).toBeUndefined()
    } finally {
      process.env.DSH_HOME = priorHome
      await ctx.fiber.dispose()
    }
  })
})
