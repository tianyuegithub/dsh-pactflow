import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  PactFlowWorkspaceProjectStore,
  initializeWorkspaceGit,
  inspectWorkspaceGit,
} from '../src/workspace-project.ts'
import { PactFlowProjectCapacity } from '../src/project-capacity.ts'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'

const exec = promisify(execFile)

describe('PactFlow Workspace projects', () => {
  it('initializes Git without staging or committing existing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-workspace-'))
    try {
      await writeFile(join(root, 'secret-looking.txt'), 'must stay untracked')
      const status = await initializeWorkspaceGit(root)
      expect(status).toMatchObject({ initialized: true, hasCommit: false, untrackedFiles: 1 })
      await expect(exec('git', ['-C', root, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }))
        .resolves.toMatchObject({ stdout: '' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists project configuration independently from DSH settings and session logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-project-store-'))
    try {
      const path = join(root, 'projects.json')
      const store = new PactFlowWorkspaceProjectStore(path)
      await store.put({
        schema: 'dsh_pactflow_workspace_project/v1', workspaceId: 'workspace-1',
        workspacePath: '/workspace/project', workspaceTitle: 'Project', revision: 1,
        createdAt: 1, updatedAt: 1, validationCommands: [],
      })
      await expect(new PactFlowWorkspaceProjectStore(path).get('workspace-1')).resolves.toMatchObject({ revision: 1 })
      expect(await readFile(path, 'utf8')).not.toMatch(/token|password|apiKey/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('atomically accepts one concurrent revision compare-and-swap write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-project-cas-'))
    try {
      const path = join(root, 'projects.json')
      const initial = {
        schema: 'dsh_pactflow_workspace_project/v1' as const, workspaceId: 'workspace-1',
        workspacePath: '/workspace/project', workspaceTitle: 'Project', revision: 1,
        createdAt: 1, updatedAt: 1, validationCommands: [],
      }
      await new PactFlowWorkspaceProjectStore(path).put(initial)
      const first = new PactFlowWorkspaceProjectStore(path)
      const second = new PactFlowWorkspaceProjectStore(path)
      const results = await Promise.all([
        first.putIfRevision(1, { ...initial, workspaceTitle: 'First', revision: 2, updatedAt: 2 }),
        second.putIfRevision(1, { ...initial, workspaceTitle: 'Second', revision: 2, updatedAt: 3 }),
      ])
      expect(results.filter(Boolean)).toHaveLength(1)
      await expect(new PactFlowWorkspaceProjectStore(path).get('workspace-1'))
        .resolves.toMatchObject({ revision: 2 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports existing repository facts without returning file contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-git-status-'))
    try {
      await exec('git', ['-C', root, 'init', '-b', 'main'])
      await writeFile(join(root, '.gitignore'), 'node_modules/\n')
      const status = await inspectWorkspaceGit(root)
      expect(status).toMatchObject({ initialized: true, branch: 'main', hasCommit: false, hasGitignore: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('derives project capacity from per-Agent quantities and enforces each quota', async () => {
    const capacity = new PactFlowProjectCapacity()
    const policy = {
      clusterId: 'cluster', workerPoolId: 'default', maxConcurrency: 1,
      agentProfiles: [
        { id: 'codex-responses', displayName: 'Codex · Responses', templateId: 'codex', maxConcurrency: 1, modelConnectionId: 'responses' },
        { id: 'dsh-chat', displayName: 'DSH · Chat', templateId: 'dsh', maxConcurrency: 2, modelConnectionId: 'chat' },
      ],
    }
    const releaseCodex = await capacity.acquire('workspace', policy, 'codex-responses')
    const releaseDsh = await capacity.acquire('workspace', policy, 'dsh-chat')
    const order: string[] = []
    const secondCodex = capacity.acquire('workspace', policy, 'codex-responses').then(release => { order.push('codex'); return release })
    await Promise.resolve()
    expect(order).toEqual([])
    releaseCodex()
    const releaseSecond = await secondCodex
    expect(order).toEqual(['codex'])
    releaseSecond()
    releaseDsh()
  })

  it('cancels queued capacity, releases idempotently, and restores persisted occupancy', async () => {
    const capacity = new PactFlowProjectCapacity()
    const policy = {
      clusterId: 'cluster', workerPoolId: 'default', maxConcurrency: 1,
      agentProfiles: [{ id: 'codex', displayName: 'Codex', templateId: 'codex', maxConcurrency: 1, modelConnectionId: 'responses' }],
    }
    const restored = capacity.reserveExisting('workspace', policy, 'codex')
    const abort = new AbortController()
    const queued = capacity.acquire('workspace', policy, 'codex', abort.signal)
    abort.abort()
    await expect(queued).rejects.toThrow('wait was cancelled')
    restored()
    restored()
    const release = await capacity.acquire('workspace', policy, 'codex')
    release()
  })

  it('does not expose ambient credential-like environment variables to validation', async () => {
    const workspace = new PactFlowGitWorkspace()
    const prior = process.env.PACTFLOW_TEST_SECRET
    process.env.PACTFLOW_TEST_SECRET = 'must-not-cross-boundary'
    try {
      const runValidation = Reflect.get(workspace, 'runValidation') as (
        cwd: string, validation: { command: string; args: readonly string[]; timeoutMs: number },
      ) => Promise<unknown>
      await expect(runValidation('/tmp', {
        command: process.execPath,
        args: ['-e', "if (process.env.PACTFLOW_TEST_SECRET) process.exit(1)"],
        timeoutMs: 5_000,
      })).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      if (prior === undefined) delete process.env.PACTFLOW_TEST_SECRET
      else process.env.PACTFLOW_TEST_SECRET = prior
    }
  })
})
