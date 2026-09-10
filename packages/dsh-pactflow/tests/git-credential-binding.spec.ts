import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowInfrastructure } from '../src/infrastructure.ts'
import { createGitFixture } from './git-fixture.ts'

// F01 / spec git-credential-binding: a registered credential ref must never be
// combinable with an unregistered endpoint chosen by the caller.
describe('PactFlow Git credential binding', () => {
  const servers: ReturnType<typeof createServer>[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server =>
      new Promise<void>(resolve => { server.close(() => { resolve() }) })))
  })

  it('refuses to send a registered credential to an unregistered endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-cred-binding-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    // Count only requests that actually carried an Authorization header.
    let authorizedHits = 0
    const attack = createServer((request, response) => {
      if (request.headers.authorization !== undefined) authorizedHits += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        full_name: 'owner/repo', default_branch: 'main', private: true, archived: false,
        default_merge_style: 'merge',
      }))
    })
    servers.push(attack)
    await new Promise<void>((resolveListen, reject) => {
      attack.once('error', reject)
      attack.listen(0, '127.0.0.1', resolveListen)
    })
    const attackUrl = `http://127.0.0.1:${String((attack.address() as AddressInfo).port)}`
    try {
      const { workspace } = createGitFixture(root)
      // The real origin points at the registered Provider host, not at the attack server.
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])

      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: () => Promise.resolve({ value: 'synthetic-token-value', source: 'memory' }),
      } as never)
      const session = ctx.sessions.create(SessionId('cred-binding'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const project = ctx.pactflow.initialize(session.id, { name: 'Credential binding' })

      // Attack: keep the trusted origin, but ask the Host to authorize a *different*
      // API origin with the already-registered credential ref.
      const bound = await ctx.pactflow
        .bindGit(session.id, {
          expectedRevision: project.revision,
          remote: 'origin',
          defaultBranch: 'main',
          giteaBaseUrl: attackUrl,
          giteaOwner: 'owner',
          giteaRepo: 'repo',
          giteaTokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
        })
        .then(() => true)
        .catch(() => false)

      // Even if a binding were accepted, exercising it must not reach the unregistered origin.
      if (bound) await ctx.pactflow.verifyGitea(session.id).catch(() => undefined)

      expect(bound).toBe(false)
      expect(authorizedHits).toBe(0)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves endpoint, credential ref and repository identity from a registered Provider id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-provider-id-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      // The remote matches the registered Provider host, so providerId can resolve.
      const { workspace } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN', username: 'alice',
          }],
        },
      })
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
      } as never)
      const session = ctx.sessions.create(SessionId('provider-id'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const project = ctx.pactflow.initialize(session.id, { name: 'Provider id' })
      const bound = await ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main', giteaProviderId: 'gitea',
      })
      // Endpoint and credential ref come from the registry, not from the caller.
      expect(bound.git?.gitea).toMatchObject({
        baseUrl: 'https://git.example', owner: 'owner', repo: 'repo',
        tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN', username: 'alice',
      })
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a binding whose declared repository differs from the remote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-wrong-repo-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      // The real remote points at owner/repo.
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      ctx.provide('credentials', { describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }) } as never)
      const session = ctx.sessions.create(SessionId('wrong-repo'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Wrong repo' })
      // Explicit fields (legacy path) declare a different repository than the remote.
      await expect(ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
        giteaBaseUrl: 'https://git.example', giteaOwner: 'owner', giteaRepo: 'other',
        giteaTokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
      })).rejects.toThrow(/does not match the bound remote/)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an explicit credential ref that does not belong to the registered Provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-wrong-cred-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      ctx.provide('credentials', { describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }) } as never)
      const session = ctx.sessions.create(SessionId('wrong-cred'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Wrong cred' })
      await expect(ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
        giteaBaseUrl: 'https://git.example', giteaOwner: 'owner', giteaRepo: 'repo',
        giteaTokenCredentialRef: 'SOME_OTHER_TOKEN',
      })).rejects.toThrow(/credential reference does not belong/)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not leak a credential value into a binding error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-cred-error-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    // A distinctive synthetic value; we assert it never surfaces in an error message.
    const secret = 'synthetic-secret-value-9c1f'
    try {
      const { workspace } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      // The credential resolves to the synthetic value, but the resolver must not be read on a rejected binding.
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: () => Promise.resolve({ value: secret, source: 'memory' }),
      } as never)
      const session = ctx.sessions.create(SessionId('cred-error'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Credential error' })
      const failure = await ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
        giteaBaseUrl: 'https://git.example', giteaOwner: 'owner', giteaRepo: 'repo',
        giteaTokenCredentialRef: 'SOME_OTHER_TOKEN',
      }).then(() => undefined, (error: unknown) => error)
      expect(failure).toBeDefined()
      expect(String((failure as Error).message)).not.toContain(secret)
      expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure as object))).not.toContain(secret)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an unregistered Provider id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-provider-unknown-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      ctx.provide('credentials', { describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }) } as never)
      const session = ctx.sessions.create(SessionId('provider-unknown'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Unknown provider' })
      await expect(ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main', giteaProviderId: 'other',
      })).rejects.toThrow(/not registered/)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('blocks a historical binding whose endpoint no longer corresponds to a registered Provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-legacy-binding-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://git.example/owner/repo.git'])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
        },
      })
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: () => Promise.resolve({ value: 'isolated-test-token', source: 'memory' }),
      } as never)
      const session = ctx.sessions.create(SessionId('legacy-binding'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Legacy binding' })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main', giteaProviderId: 'gitea',
      })
      // The registry no longer contains the provider the binding points at (removed/renamed).
      Reflect.set(ctx.pactflow, 'infrastructure', new PactFlowInfrastructure({
        clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
        gitProviders: [{
          id: 'other', displayName: 'Other', kind: 'gitea', baseUrl: 'https://other.example',
          tokenCredentialRef: 'OTHER_TOKEN',
        }],
      }))
      await expect(ctx.pactflow.verifyGitea(session.id))
        .rejects.toThrow(/does not correspond to a registered Git Provider/)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
