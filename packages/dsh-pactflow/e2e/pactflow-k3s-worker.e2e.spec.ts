import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

const enabled = process.env.DSH_K3S_E2E === '1'
const repository = 'ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git'
const image = '192.168.31.200:8080/datavdl/pactflow-worker@sha256:3342bb490d91ff8e39255e4b0e477967f4ccd9c7fb4380a1ec13cc654debdcea'

describe.skipIf(!enabled)('PactFlow real K3s Worker', { timeout: 900_000 }, () => {
  let root: string
  let workspace: string
  let ctx: Context
  let priorDshHome: string | undefined
  let jobName: string | undefined
  let configMapName: string | undefined
  let branch: string | undefined

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-k3s-'))
    workspace = join(root, 'workspace')
    execFileSync('git', ['clone', '--branch', 'main', repository, workspace], {
      stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    execFileSync('git', ['-C', workspace, 'config', 'user.name', 'PactFlow Host'])
    execFileSync('git', ['-C', workspace, 'config', 'user.email', 'pactflow-host@example.invalid'])
    priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      k3s: {
        namespace: 'pactflow',
        imagePullSecret: 'pactflow-registry-home-harbor',
        pollIntervalMs: 1_000,
        templates: [{
          id: 'dsh-deepseek-v4flash',
          harness: 'dsh',
          apiMode: 'openai-chat-completions',
          image,
          model: 'deepseek-v4-flash-vision-exp',
          baseUrl: 'https://api.deepseek.com',
          modelSecretName: 'pactflow-legacy-codex-deepseek-v4flash',
          cpuRequest: '250m',
          memoryRequest: '512Mi',
          cpuLimit: '2',
          memoryLimit: '2Gi',
        }],
      },
    })
  })

  afterAll(async () => {
    const session = ctx?.sessions.get(SessionId('real-k3s-worker'))
    const latestRun = Object.values(
      session === undefined ? {} : ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId ?? {},
    ).at(-1)
    jobName ??= latestRun?.k3s?.jobName
    configMapName ??= latestRun?.k3s?.configMapName
    branch ??= latestRun?.git?.branch
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
    await ctx?.fiber.dispose()
    if (priorDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorDshHome
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('commits in a Pod, pushes, fetches locally, validates, and settles', async () => {
    const session = ctx.sessions.create(SessionId('real-k3s-worker'), {
      meta: { agentPreset: 'pactflow', cwd: workspace },
    })
    const initialized = ctx.pactflow.initialize(session.id, { name: 'Real K3s Worker' })
    await ctx.pactflow.bindGit(session.id, {
      expectedRevision: initialized.revision,
      remote: 'origin',
      defaultBranch: 'main',
      k3sGitSecretName: 'pactflow-git-zeromai-demo-v2',
      validationCommands: [{
        command: '/bin/test', args: ['-f', 'dsh-k3s-e2e-proof.txt'], timeoutMs: 10_000,
      }],
    })
    ctx.pactflow.createNeed(session.id, {
      id: 'real-k3s', title: 'Real K3s', description: 'Real DSH remote Worker acceptance',
    })
    const node = ctx.pactflow.createNode(session.id, {
      id: 'worker', needId: 'real-k3s', title: 'Worker', dependencies: [],
    })
    const settled = await ctx.pactflow.dispatchK3sNode(session.id, {
      nodeId: node.id,
      expectedRevision: node.revision,
      templateId: 'dsh-deepseek-v4flash',
      leaseDurationMs: 600_000,
      prompt: [
        'In the current repository create dsh-k3s-e2e-proof.txt containing exactly DSH K3S OK followed by a newline.',
        'Run test -f dsh-k3s-e2e-proof.txt, then git add the file and commit with message dsh k3s e2e.',
        'Do not modify any other file, switch branches, merge, or deploy.',
      ].join(' '),
    })
    jobName = settled.run.k3s?.jobName
    configMapName = settled.run.k3s?.configMapName
    branch = settled.run.git?.branch
    if (settled.run.state !== 'succeeded') {
      throw new Error(`K3s Run failed: outcome=${settled.run.outcome ?? 'missing'} job=${jobName ?? 'missing'}`)
    }
    expect(settled).toMatchObject({
      node: { state: 'succeeded' },
      run: {
        state: 'succeeded',
        gitResult: { commit: settled.run.k3sResult?.commit, branch },
        k3sResult: { exitCode: 0, branch },
      },
    })
    expect(readFileSync(join(settled.run.git!.worktreePath, 'dsh-k3s-e2e-proof.txt'), 'utf8'))
      .toBe('DSH K3S OK\n')
  })
})
