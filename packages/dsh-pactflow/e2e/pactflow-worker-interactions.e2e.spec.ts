import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { launchWebScaffold, type WebScaffold } from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'
import type { PactFlowSnapshot } from '../src/types.ts'

const enabled = process.env.DSH_WORKER_INTERACTIONS_E2E === '1' && process.env.DSH_SNAPSHOT === 'record'
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const remote = 'ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git'
const apiBase = 'http://192.168.31.7:30000'
const suffix = randomUUID().slice(0, 8)
const needId = `autopilot-${suffix}`
const proof = 'relay-proof.json'
const relayImage = process.env.PACTFLOW_RELAY_IMAGE
if (enabled && !relayImage?.includes('@sha256:')) throw new Error('An immutable relay acceptance image is required')

describe.skipIf(!enabled)('PactFlow real DSH worker interactions', { timeout: 600_000 }, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let anchor: string
  let sessionId: string
  let workspace: string

  async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const response = await scaffold.hostFetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) })
    const body = await response.json() as { result: { ok: boolean; value: T; error?: { message: string } } }
    if (!response.ok || !body.result.ok) throw new Error(`Autopilot fixture ${method} failed: ${body.result.error?.message ?? response.status}`)
    return body.result.value
  }
  const snapshot = () => rpc<PactFlowSnapshot>('pactflow/snapshot', { sessionId })

  beforeAll(async () => {
    const credential = process.env.PACTFLOW_GITEA_API_TOKEN
    if (!credential) throw new Error('Autopilot acceptance requires the Gitea credential reference')
    anchor = await mkdtemp(join(tmpdir(), 'pactflow-autopilot-anchor-'))
    await mkdir(join(anchor, 'node_modules'))
    await symlink(PACKAGE_ROOT, join(anchor, 'node_modules/dsh-pactflow'), 'dir')
    await writeFile(join(anchor, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(anchor, 'package.json'), JSON.stringify({ name: 'pactflow-autopilot-anchor', private: true,
      dependencies: { 'dsh-pactflow': `file:${PACKAGE_ROOT}` } }))
    const overlayPath = join(anchor, 'relay-overlay.yml')
    await writeFile(overlayPath, `- insert:
    - id: pactflow
      name: dsh-pactflow
      config:
        k3s:
          namespace: pactflow
          imagePullSecret: pactflow-registry-home-harbor
          pollIntervalMs: 1000
          templates:
            - id: dsh-relay
              harness: dsh
              interactionProtocol: dsh-worker-interactions/v1
              apiMode: openai-chat-completions
              image: ${relayImage}
              model: deepseek-v4-flash-vision-exp
              baseUrl: https://api.deepseek.com
              modelSecretName: pactflow-legacy-codex-deepseek-v4flash
              cpuRequest: 250m
              memoryRequest: 512Mi
              cpuLimit: '2'
              memoryLimit: 2Gi
- id: agent-presets
  inject: [pactflowPresetRoot]
  config:
    default: standard
    includeShippedRoot: true
    includeUserRoot: true
    roots: !!js |-
      [{path: ctx.pactflowPresetRoot, trust: 'user'}]
`)
    scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath, extraInstallAnchors: [join(anchor, 'package.json')],
      agentPresets: { default: 'standard', roots: [{ path: `${PACKAGE_ROOT}/presets`, trust: 'user' }] } })
    workspace = join(scaffold.workspaceCwd, 'workspace')
    execFileSync('git', ['clone', remote, workspace], { stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    execFileSync('git', ['-C', workspace, 'config', 'user.name', 'PactFlow Autopilot E2E'])
    execFileSync('git', ['-C', workspace, 'config', 'user.email', 'pactflow-test@example.invalid'])
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /PactFlow|零脉/ }).click()
    await vi.waitFor(async () => {
      const list = await rpc<{ items: { sessionId: string; projections?: { values?: { agentPreset?: string } } }[] }>('session/list', { _request: {} })
      sessionId = list.items.find(item => item.projections?.values?.agentPreset === 'pactflow')?.sessionId ?? ''
      expect(sessionId).not.toBe('')
    }, { timeout: 15000 })
    const project = await rpc<{ revision: number }>('pactflow/initialize', { sessionId, request: { name: `Autopilot acceptance ${suffix}` } })
    const summaries = await rpc<{ workspaceId: string; path: string }[]>('pactflow/listWorkspaceProjectSummaries', {})
    const workspaceId = summaries.find(row => row.path === workspace)!.workspaceId
    await rpc('pactflow/saveValidationProfiles', { request: { workspaceId, expectedRevision: 0,
      profiles: [{ id: 'proof', displayName: '验证交付文件', command: '/usr/bin/git', args: ['show', `HEAD:${proof}`], timeoutMs: 30000 }] } })
    await rpc('pactflow/bindGit', { sessionId, request: { expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
      validationProfileIds: ['proof'], giteaBaseUrl: apiBase, giteaOwner: 'tianyue', giteaRepo: 'zeromai-demo', k3sGitSecretName: 'pactflow-git-zeromai-demo-v2',
      giteaTokenCredentialRef: 'PACTFLOW_GITEA_API_TOKEN' } })
    await rpc('pactflow/createNeed', { sessionId, request: { id: needId, title: `交付挂机验收文件 ${suffix}`,
      description: `必须只派发一个 dsh-relay K3s 节点。在容器启动时，测试扩展会向用户请求两次审批和一个选择题，并生成 ${proof}。执行代理必须核实文件中 approved=true、colour=blue、rejected=true、runId非空；只提交这个文件到任务分支。不要自行调用额外的提问工具、不要改其它文件、不部署。宿主等待实际远程执行结果。` } })
  }, 120_000)

  afterAll(async () => {
    if (scaffold && sessionId) {
      const current = await snapshot().catch(() => undefined)
      for (const record of Object.values(current?.delivery.autopilots ?? {})) {
        if (!['stopped', 'completed'].includes(record.state)) await rpc('pactflow/controlAutopilot', { sessionId, needId: record.needId, expectedRevision: record.revision, action: 'stop' }).catch(() => {})
      }
    }
    await browser?.close(); await scaffold?.close()
    if (anchor) await rm(anchor, { recursive: true, force: true })
  })

  it('relays approval and choice to the actual Host UI and resumes the real DSH container', async () => {
    const settled = scaffold.whenTurnSettled(120_000)
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, '请只回复 READY，暂不修改任何内容，也不要开始执行。')
    await composer.press('Enter'); await settled
    await page.getByRole('button', { name: /Open PactFlow/ }).click()
    await page.getByRole('button', { name: '挂机设置', exact: true }).click()
    const controls = page.getByRole('region', { name: '按需求挂机控制' })
    await controls.getByRole('button', { name: '准备挂机', exact: true }).click()
    await controls.getByRole('button', { name: '授权并开始挂机', exact: true }).click()
    await vi.waitFor(async () => {
      const mode = (await snapshot()).delivery.autopilots?.[needId]
      if (!mode) { const alerts = await controls.getByRole('alert').allTextContents(); if (alerts.length) throw new Error(alerts.join('；')) }
      expect(mode?.state).toBe('running')
    }, { timeout: 10000 })
    const interactions = page.getByRole('region', { name: '执行代理待确认' })
    let lastProgress = ''
    const pending = async () => {
      const value = await snapshot()
      const current = Object.values(value.delivery.workerInteractions ?? {}).find(record => record.state === 'pending')
      const mode = value.delivery.autopilots?.[needId]
      const progress = JSON.stringify({ phase: value.needs.byId[needId]?.phase, mode: mode?.state, runs: Object.values(value.runs.byId).map(run => run.state), requests: Object.values(value.delivery.workerInteractions ?? {}).map(record => record.state) })
      if (progress !== lastProgress) { process.stdout.write(progress + '\n'); lastProgress = progress }
      if (mode && ['blocked', 'stopped'].includes(mode.state)) throw new Error(`Host blocked: ${mode.reason}`)
      return current
    }
    await expect.poll(async () => (await pending())?.request.toolName, { timeout: 240_000, interval: 1000 }).toBe('relay_acceptance_write')
    await interactions.getByRole('button', { name: '批准', exact: true }).click()
    await expect.poll(async () => (await pending())?.request.kind, { timeout: 30000 }).toBe('question')
    // A browser reload must preserve the exact pending request in Host events.
    const questionRecord = (await pending())!
    const before = questionRecord.id
    const activeRun = (await snapshot()).runs.byId[questionRecord.runId]!
    const podList = JSON.parse(execFileSync('kubectl', ['-n', activeRun.k3s!.namespace, 'get', 'pods', '-l', `job-name=${activeRun.k3s!.jobName}`, '-o', 'json'], { encoding: 'utf8' }))
    const pod = podList.items.find((item: { metadata: { uid: string } }) => item.metadata.uid === questionRecord.podUid)
    expect(pod).toBeDefined()
    const pidScript = `const fs=require('node:fs'); for(const id of fs.readdirSync('/proc')) { if(!/^\\d+$/.test(id)||Number(id)===process.pid)continue; try { if(fs.readFileSync('/proc/'+id+'/cmdline','utf8').split('\\0').includes('/opt/pactflow-worker/connect.mjs')) process.stdout.write(id+'\\n') } catch {} }`
    const connectorPids = () => execFileSync('kubectl', ['-n', activeRun.k3s!.namespace, 'exec', pod.metadata.name, '--', 'node', '-e', pidScript], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
    const previousPids = connectorPids()
    expect(previousPids.length).toBeGreaterThan(0)
    for (const pid of previousPids) execFileSync('kubectl', ['-n', activeRun.k3s!.namespace, 'exec', pod.metadata.name, '--', 'node', '-e', "process.kill(Number(process.argv[1]), 'SIGTERM')", pid], { stdio: 'pipe' })
    await expect.poll(() => connectorPids().some(pid => !previousPids.includes(pid)), { timeout: 20000, interval: 1000 }).toBe(true)
    await page.reload(); await page.getByRole('button', { name: /Open PactFlow/ }).click()
    expect((await pending())!.id).toBe(before)
    await interactions.getByRole('radio', { name: /蓝色/ }).check()
    await interactions.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect.poll(async () => (await pending())?.request.toolName, { timeout: 30000 }).toBe('relay_acceptance_forbidden')
    await interactions.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect.poll(async () => Object.values((await snapshot()).runs.byId).find(run => run.state === 'succeeded')?.id,
      { timeout: 240_000, interval: 1000 }).toBeTruthy()
    const result = await snapshot()
    const run = Object.values(result.runs.byId).find(run => run.state === 'succeeded')!
    const records = Object.values(result.delivery.workerInteractions ?? {})
    expect(records).toHaveLength(3)
    expect(records.every(record => record.state === 'delivered')).toBe(true)
    expect(run.k3s?.interactionProtocol).toBe('dsh-worker-interactions/v1')
    const mode = result.delivery.autopilots?.[needId]
    if (mode && mode.state === 'running') await rpc('pactflow/controlAutopilot', { sessionId, needId, expectedRevision: mode.revision, action: 'stop' })
    execFileSync('git', ['-C', workspace, 'fetch', 'origin'], { stdio: 'pipe' })
    const content = JSON.parse(execFileSync('git', ['-C', workspace, 'show', `${run.gitResult!.commit}:${proof}`], { encoding: 'utf8' }))
    expect(content).toEqual({ approved: true, colour: 'blue', rejected: true, runId: run.id })
    process.stdout.write(`Worker interaction acceptance: ${run.id}; commit ${run.gitResult!.commit}; requests ${records.length}\n`)
    const cancelNeed = `${needId}-cancel`
    await rpc('pactflow/createNeed', { sessionId, request: { id: cancelNeed, title: '远程取消与迟到答复验收',
      description: '只派发一个 dsh-relay K3s 节点。容器原生审批等待用户处理；此场景由测试操作员停止，执行代理不得绕过审批，也不修改其它文件。' } })
    await page.getByLabel('选择需求', { exact: true }).selectOption(cancelNeed)
    await page.getByRole('button', { name: '挂机设置', exact: true }).click()
    await controls.getByRole('button', { name: '准备挂机', exact: true }).click()
    await controls.getByRole('button', { name: '授权并开始挂机', exact: true }).click()
    await expect.poll(async () => Object.values((await snapshot()).delivery.workerInteractions ?? {})
      .find(record => record.needId === cancelNeed && record.state === 'pending')?.id, { timeout: 180000, interval: 1000 }).toBeTruthy()
    const cancelSnapshot = await snapshot()
    const waiting = Object.values(cancelSnapshot.delivery.workerInteractions!).find(record => record.needId === cancelNeed && record.state === 'pending')!
    const cancelMode = cancelSnapshot.delivery.autopilots![cancelNeed]!
    await rpc('pactflow/controlAutopilot', { sessionId, needId: cancelNeed, expectedRevision: cancelMode.revision, action: 'stop' })
    await expect(rpc('pactflow/answerWorkerInteraction', { sessionId, request: { id: waiting.id, expectedRevision: waiting.revision,
      expectedDigest: waiting.digest, answer: { decision: 'approve' } } })).rejects.toThrow(/过期|结束|变化/)
    await expect.poll(async () => (await snapshot()).runs.byId[waiting.runId]?.state, { timeout: 30000 }).toMatch(/cancelled|failed/)
    process.stdout.write('Verified real connector reconnect and late-answer rejection after cancellation\n')

  })
})
