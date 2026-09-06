import { execFile, fork, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  PactFlowWorkspaceProjectStore,
  initializeWorkspaceGit,
  inspectWorkspaceGit,
} from '../src/workspace-project.ts'
import { PactFlowProjectCapacity } from '../src/project-capacity.ts'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'

// Real-Git fixtures are slow under load; relax timeouts without touching assertions.
vi.setConfig({ testTimeout: 20_000 })

const exec = promisify(execFile)

describe('PactFlow Workspace projects', () => {
  it.each([
    { git: { remote: 'origin' } },
    { worker: { clusterId: 'cluster' } },
    { validationProfileIds: ['missing'] },
    { validationCommands: [{}] },
    { validationProfiles: [{ id: 'check', displayName: 'x'.repeat(257), command: 'git', args: [], timeoutMs: 1000, revision: 1 }] },
    { worker: { clusterId: 'cluster', workerPoolId: 'pool', maxConcurrency: 2,
      agentProfiles: [{ id: 'agent', displayName: 'Agent', templateId: 'dsh', modelConnectionId: 'model', maxConcurrency: 1 }] } },
  ])('rejects corrupt nested configuration without modifying its file: %j', async invalid => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-nested-config-'))
    try {
      const path = join(root, 'projects.json')
      const content = JSON.stringify([{ schema: 'dsh_pactflow_workspace_project/v1', workspaceId: 'workspace',
        workspacePath: root, workspaceTitle: 'Workspace', revision: 1, createdAt: 1, updatedAt: 1, ...invalid }])
      await writeFile(path, content)
      await expect(new PactFlowWorkspaceProjectStore(path).list()).rejects.toThrow(/invalid record/)
      expect(await readFile(path, 'utf8')).toBe(content)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('removes only empty detached artifacts and preserves unknown, staging, and symlink targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-artifact-boundary-'))
    try {
      const path = join(root, 'projects.json')
      const emptyDetached = `${path}.lock.released-11111111-2222-4333-8444-555555555555`
      const unknownDetached = `${path}.lock.released-22222222-2222-4333-8444-555555555555`
      const emptyStaging = `${path}.lock.pending-ABC123`
      const external = join(root, 'unrelated')
      for (const directory of [emptyDetached, unknownDetached, emptyStaging, external]) await mkdir(directory)
      await writeFile(join(unknownDetached, 'user-data'), 'preserve')
      await writeFile(join(external, 'user-data'), 'preserve')
      const link = `${path}.lock.pending-DEF456`
      await symlink(external, link, 'dir')
      await new PactFlowWorkspaceProjectStore(path).list()
      expect(await readdir(root)).not.toContain(emptyDetached.split('/').pop())
      expect(await readdir(emptyStaging)).toEqual([])
      expect(await readFile(join(unknownDetached, 'user-data'), 'utf8')).toBe('preserve')
      expect(await readFile(join(link, 'user-data'), 'utf8')).toBe('preserve')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it.each(['published', 'pending', 'released', 'live-pending'] as const)('recovers only dead-owner lock artifacts: %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-dead-lock-'))
    const path = join(root, 'projects.json')
    const child = fork(new URL('./fixtures/project-store-lock-holder.mjs', import.meta.url), [], {
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('message', () => resolve())
      })
      await new Promise<void>((resolve, reject) => {
        child.once('message', message => (message as { locked?: boolean }).locked ? resolve() : reject(new Error('lock failed')))
        child.send({ path })
      })
      if (mode !== 'live-pending') await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL') })
      const artifact = mode === 'released' ? 'projects.json.lock.released-11111111-2222-4333-8444-555555555555'
        : 'projects.json.lock.pending-ABC123'
      if (mode !== 'published') await rename(`${path}.lock`, join(root, artifact))
      await expect(new PactFlowWorkspaceProjectStore(path).list()).resolves.toEqual([])
      expect((await readdir(root)).includes(artifact)).toBe(mode === 'live-pending')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill() })
      }
      await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  it.each(['legacy-owner', 'empty-unknown'] as const)('times out without stealing or deleting another writer lock: %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-lock-owner-'))
    try {
      const path = join(root, 'projects.json')
      await writeFile(path, '[]')
      await mkdir(`${path}.lock`)
      const owner = JSON.stringify({ pid: process.pid, acquiredAt: 1 })
      if (mode === 'legacy-owner') await writeFile(join(`${path}.lock`, 'owner.json'), owner)
      await expect(new PactFlowWorkspaceProjectStore(path).list()).rejects.toThrow(/lock timed out/)
      if (mode === 'legacy-owner') expect(await readFile(join(`${path}.lock`, 'owner.json'), 'utf8')).toBe(owner)
      expect(await readFile(path, 'utf8')).toBe('[]')
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 10_000)

  it.each(['dead-releaser', 'live-releaser'] as const)('resumes a release interrupted after detaching: %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-release-crash-'))
    const path = join(root, 'projects.json')
    // Recreate the exact state a crashed releaser leaves: the lock directory
    // was atomically detached to a released- name, but its owner file and
    // final removal never completed.
    const detached = `${path}.lock.released-33333333-2222-4333-8444-555555555555`
    await mkdir(detached)
    let ownerPid = process.pid
    if (mode === 'dead-releaser') {
      const child = fork(new URL('./fixtures/project-store-lock-holder.mjs', import.meta.url), [], {
        execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('message', () => resolve()) })
      ownerPid = child.pid!
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL') })
    }
    await writeFile(join(detached, `owner-${ownerPid}-44444444-2222-4333-8444-555555555555.json`),
      JSON.stringify({ host: hostname() }), { mode: 0o600 })
    try {
      await expect(new PactFlowWorkspaceProjectStore(path).list()).resolves.toEqual([])
      expect((await readdir(root)).includes(basename(detached))).toBe(mode === 'live-releaser')
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 10_000)

  it.each(['same-workspace', 'different-workspaces', 'dead-owner-recovery'] as const)('serializes real independent processes: %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-multiprocess-cas-'))
    const children: ChildProcess[] = []
    let holder: ChildProcess | undefined
    try {
      const path = join(root, 'projects.json')
      const initial = { schema: 'dsh_pactflow_workspace_project/v1' as const, workspaceId: 'workspace-1',
        workspacePath: root, workspaceTitle: 'Initial', revision: 1, createdAt: 1, updatedAt: 1 }
      if (mode === 'same-workspace') expect(await new PactFlowWorkspaceProjectStore(path).putIfRevision(0, initial)).toBe(true)
      if (mode === 'dead-owner-recovery') {
        holder = fork(new URL('./fixtures/project-store-lock-holder.mjs', import.meta.url), [], {
          execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
        await new Promise<void>((resolve, reject) => { holder!.once('error', reject); holder!.once('message', () => resolve()) })
        await new Promise<void>((resolve, reject) => {
          holder!.once('message', message => (message as { locked?: boolean }).locked ? resolve() : reject(new Error('lock failed')))
          holder!.send({ path })
        })
        await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill('SIGKILL') })
      }
      await Promise.all(Array.from({ length: 12 }, async () => {
        const child = fork(new URL('./fixtures/project-store-contender.mjs', import.meta.url), [], {
          execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
        children.push(child)
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', code => { if (code !== 0) reject(new Error(`contender exited ${String(code)}`)) })
          child.once('message', message => {
            if ((message as { ready?: boolean }).ready) resolve()
            else reject(new Error('contender did not become ready'))
          })
        })
      }))
      const results = await Promise.all(children.map((child, index) => new Promise<boolean>((resolve, reject) => {
        child.once('message', message => {
          const result = message as { error?: string; accepted?: boolean }
          if (result.error !== undefined) reject(new Error(result.error))
          else resolve(result.accepted === true)
        })
        child.send({ path, expectedRevision: mode === 'same-workspace' ? 1 : 0,
          config: { ...initial, workspaceId: mode === 'same-workspace' ? initial.workspaceId : `workspace-${index}`,
            workspaceTitle: `Writer ${index}`, revision: mode === 'same-workspace' ? 2 : 1 } })
      })))
      expect(results.filter(Boolean)).toHaveLength(mode === 'same-workspace' ? 1 : children.length)
      const rows = await new PactFlowWorkspaceProjectStore(path).list()
      expect(rows).toHaveLength(mode === 'same-workspace' ? 1 : children.length)
    } finally {
      if (holder !== undefined && holder.exitCode === null && holder.signalCode === null) {
        await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill() })
      }
      await Promise.all(children.map(child => new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
        child.once('exit', () => resolve())
        child.kill()
      })))
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('refreshes a long-lived reader after another store writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-store-refresh-'))
    try {
      const path = join(root, 'projects.json')
      const reader = new PactFlowWorkspaceProjectStore(path)
      expect(await reader.list()).toEqual([])
      await new PactFlowWorkspaceProjectStore(path).putIfRevision(0, {
        schema: 'dsh_pactflow_workspace_project/v1', workspaceId: 'workspace-1', workspacePath: root,
        workspaceTitle: 'Updated', revision: 1, createdAt: 1, updatedAt: 1,
      })
      expect(await reader.get('workspace-1')).toMatchObject({ revision: 1, workspaceTitle: 'Updated' })
      expect(await reader.list()).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it.each(['{}', '[{}]', '[{"workspaceId":"broken"}]', '['])('refuses corrupt persisted configuration without overwriting it (%s)', async content => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-store-corrupt-'))
    try {
      const path = join(root, 'projects.json')
      await writeFile(path, content)
      const store = new PactFlowWorkspaceProjectStore(path)
      await expect(store.list()).rejects.toThrow()
      await expect(store.putIfRevision(0, {
        schema: 'dsh_pactflow_workspace_project/v1', workspaceId: 'workspace-1', workspacePath: root,
        workspaceTitle: 'New', revision: 1, createdAt: 1, updatedAt: 1,
      })).rejects.toThrow()
      expect(await readFile(path, 'utf8')).toBe(content)
      await writeFile(path, '[]')
      expect(await store.list()).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

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
      await store.putIfRevision(0, {
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
      expect(await new PactFlowWorkspaceProjectStore(path).putIfRevision(0, initial)).toBe(true)
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
