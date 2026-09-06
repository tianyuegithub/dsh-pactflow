import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

const enabled = process.env.DSH_K3S_E2E === '1'
const repository = 'ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git'
const registry = '192.168.31.200:8080/datavdl/pactflow-worker'
const openAi = {
  model: 'deepseek-v4-flash-vision-exp', baseUrl: 'https://api.deepseek.com',
  modelSecretName: 'pactflow-legacy-codex-deepseek-v4flash',
}
const resources = {
  cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '2', memoryLimit: '2Gi',
}
const cases = [
  {
    id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
    image: `${registry}@sha256:e7569c3ccdc78fed9fab25e4c9f9ee708bee5114f62bf856e0010f474e5cf87a`,
    model: 'glm-5-2-260617', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    modelSecretName: 'pactflow-legacy-data-gov-claudecode-glm52', ...resources,
  },
  {
    id: 'codex', harness: 'codex' as const, apiMode: 'openai-responses' as const,
    image: `${registry}@sha256:a7d75d0191e82c243f77429cdd652a61636dd185058f1f8c7babc72bf80288c4`,
    ...openAi, ...resources,
  },
  {
    id: 'opencode', harness: 'opencode' as const, apiMode: 'openai-chat-completions' as const,
    image: `${registry}@sha256:6ac439dc3f8c29165572f4f99da0ecffdfd35b14c46ff51594cfffafeae63707`,
    ...openAi, ...resources,
  },
] as const

describe.skipIf(!enabled)('PactFlow K3s full Harness task matrix', { timeout: 900_000 }, () => {
  let root: string
  let ctx: Context
  let priorDshHome: string | undefined

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-k3s-matrix-'))
    priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      k3s: {
        namespace: 'pactflow', imagePullSecret: 'pactflow-registry-home-harbor', pollIntervalMs: 1_000,
        templates: cases,
      },
    })
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    if (priorDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorDshHome
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it.each(cases)('$id edits, commits, pushes, and passes Host validation', async (template) => {
    const workspace = join(root, `workspace-${template.id}`)
    execFileSync('git', ['clone', '--branch', 'main', repository, workspace], {
      stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    execFileSync('git', ['-C', workspace, 'config', 'user.name', 'PactFlow Host'])
    execFileSync('git', ['-C', workspace, 'config', 'user.email', 'pactflow-host@example.invalid'])
    const session = ctx.sessions.create(SessionId(`matrix-${template.id}`), {
      meta: { agentPreset: 'pactflow', cwd: workspace },
    })
    try {
      const initialized = ctx.pactflow.initialize(session.id, { name: `Matrix ${template.id}` })
      // Validation now runs only through user-registered profiles; raw commands are refused at bind time.
      const registeredWorkspace = { id: `k3s-matrix-${template.id}`, path: workspace, title: `K3s matrix ${template.id}`, sessionIds: [session.id] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
      await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 0,
        profiles: [{ id: 'diff-check', displayName: 'Diff check', command: 'git',
          args: ['diff', '--check', 'HEAD~1..HEAD'], timeoutMs: 10_000 }] })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
        k3sGitSecretName: 'pactflow-git-zeromai-demo-v2',
        validationProfileIds: ['diff-check'],
      })
      ctx.pactflow.createNeed(session.id, { id: 'matrix', title: 'Matrix', description: template.id })
      const node = ctx.pactflow.createNode(session.id, {
        id: template.id, needId: 'matrix', title: template.id, dependencies: [],
      })
      const file = `${template.id}-k3s-e2e-proof.txt`
      const content = `${template.id.toUpperCase()} K3S OK\n`
      const settled = await ctx.pactflow.dispatchK3sNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, templateId: template.id,
        leaseDurationMs: 600_000,
        prompt: [
          `Create ${file} containing exactly ${content.trim()} followed by a newline.`,
          `Run test -f ${file}, git add ${file}, and commit with message ${template.id} k3s e2e.`,
          'Do not modify another file, switch branches, merge, or deploy.',
        ].join(' '),
      })
      expect(settled.run.state, settled.run.outcome).toBe('succeeded')
      expect(readFileSync(join(settled.run.git!.worktreePath, file), 'utf8')).toBe(content)
      expect(settled.run.k3sResult).toMatchObject({ exitCode: 0, branch: settled.run.git?.branch })
    } finally {
      cleanupRun(session, workspace)
    }
  })

  function cleanupRun(session: Session, workspace: string): void {
    const run = Object.values(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId ?? {}).at(-1)
    const jobName = run?.k3s?.jobName
    const configMapName = run?.k3s?.configMapName
    const branch = run?.git?.branch
    if (jobName !== undefined) {
      execFileSync('kubectl', [
        '-n', 'pactflow', 'delete', 'job', jobName, '--ignore-not-found=true', '--wait=true',
      ], { stdio: 'ignore' })
    }
    if (configMapName !== undefined) {
      execFileSync('kubectl', [
        '-n', 'pactflow', 'delete', 'configmap', configMapName, '--ignore-not-found=true', '--wait=true',
      ], { stdio: 'ignore' })
    }
    if (branch !== undefined) {
      const exists = execFileSync('git', ['-C', workspace, 'ls-remote', '--heads', 'origin', branch], {
        encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).trim()
      if (exists.length > 0) {
        execFileSync('git', ['-C', workspace, 'push', 'origin', '--delete', branch], {
          stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        })
      }
    }
  }
})
