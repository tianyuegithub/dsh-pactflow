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
import type { PactFlowAutopilotRecord, PactFlowSnapshot } from '../src/types.ts'

const enabled = process.env.DSH_AUTOPILOT_E2E === '1' && process.env.DSH_SNAPSHOT === 'record'
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const remote = 'ssh://git@192.168.31.7:30022/tianyue/pactflow-acceptance.git'
const apiBase = 'http://192.168.31.7:30000'
const suffix = randomUUID().slice(0, 8)
const needId = `autopilot-${suffix}`
const proof = `autopilot-proof-${suffix}.txt`

describe.skipIf(!enabled)('PactFlow real scoped autopilot', { timeout: 600_000 }, () => {
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
    const protection = await fetch(`${apiBase}/api/v1/repos/tianyue/pactflow-acceptance/branch_protections/main`, {
      headers: { authorization: `token ${credential}` }, signal: AbortSignal.timeout(10_000),
    })
    await protection.body?.cancel()
    if (!protection.ok) throw new Error(`Acceptance repository must already have branch protection: ${protection.status}`)
    anchor = await mkdtemp(join(tmpdir(), 'pactflow-autopilot-anchor-'))
    await mkdir(join(anchor, 'node_modules'))
    await symlink(PACKAGE_ROOT, join(anchor, 'node_modules/dsh-pactflow'), 'dir')
    await writeFile(join(anchor, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(anchor, 'package.json'), JSON.stringify({ name: 'pactflow-autopilot-anchor', private: true,
      dependencies: { 'dsh-pactflow': `file:${PACKAGE_ROOT}` } }))
    scaffold = await launchWebScaffold({ extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`, extraInstallAnchors: [join(anchor, 'package.json')],
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
      validationProfileIds: ['proof'], giteaBaseUrl: apiBase, giteaOwner: 'tianyue', giteaRepo: 'pactflow-acceptance',
      giteaTokenCredentialRef: 'PACTFLOW_GITEA_API_TOKEN' } })
    await rpc('pactflow/createNeed', { sessionId, request: { id: needId, title: `交付挂机验收文件 ${suffix}`,
      description: `只新增文件 ${proof}，内容精确为 AUTOPILOT ${suffix} 加换行。不要改其它文件。由执行代理在任务分支验证并提交，完成十阶段评审与验收，最终由宿主合并到已绑定验收仓库 main。不部署、不修改权限。` } })
  }, 120_000)

  afterAll(async () => {
    if (scaffold && sessionId) {
      const current = await snapshot().catch(() => undefined)
      const record = current?.delivery.autopilots?.[needId]
      if (record && !['stopped', 'completed'].includes(record.state)) {
        await rpc('pactflow/controlAutopilot', { sessionId, needId, expectedRevision: record.revision, action: 'stop' }).catch(() => {})
      }
    }
    await browser?.close(); await scaffold?.close()
    if (anchor) await rm(anchor, { recursive: true, force: true })
  })

  it('starts only after UI authorization and delivers through real Worker/Git/Gitea after the browser closes', async () => {
    expect((await snapshot()).delivery.autopilots?.[needId]).toBeUndefined()
    // A blank conversation has no session-header action slot. Establish the
    // normal user conversation without starting any development work.
    const settled = scaffold.whenTurnSettled(120_000)
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, '请只回复 READY，暂不修改任何内容，也不要开始执行。')
    await composer.press('Enter'); await settled
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    await page.getByRole('button', { name: '挂机设置', exact: true }).click()
    const controls = page.getByRole('region', { name: '按需求挂机控制' })
    await controls.waitFor({ timeout: 15000 })
    expect(await controls.getByLabel('编排模型调用次数（1—1000）').inputValue()).toBe('60')
    await controls.getByRole('button', { name: '准备挂机', exact: true }).click()
    await controls.getByRole('button', { name: '授权并开始挂机', exact: true }).waitFor()
    expect((await snapshot()).delivery.autopilots?.[needId]).toBeUndefined()
    await controls.getByRole('button', { name: '授权并开始挂机', exact: true }).click()
    await expect.poll(async () => (await snapshot()).delivery.autopilots?.[needId]?.state).toBe('running')
    await controls.getByRole('button', { name: '暂停后续推进', exact: true }).click()
    await expect.poll(async () => (await snapshot()).delivery.autopilots?.[needId]?.state).toBe('paused')
    await controls.getByRole('button', { name: '恢复挂机', exact: true }).click()
    await expect.poll(async () => (await snapshot()).delivery.autopilots?.[needId]?.state).toBe('running')
    await page.close()
    let record: PactFlowAutopilotRecord | undefined
    await expect.poll(async () => {
      const current = await snapshot()
      record = current.delivery.autopilots?.[needId]
      return record?.state
    }, { timeout: 480_000, interval: 1000 }).toMatch(/^(completed|blocked|paused|stopped)$/)
    expect(record?.state, record?.reason).toBe('completed')
    const result = await snapshot()
    expect(result.needs.byId[needId]?.phase).toBe('deployed')
    const release = result.delivery.releases[needId]!
    expect(release.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.values(result.dag.byId).filter(node => node.needId === needId)).toHaveLength(1)
    const reviews = Object.values(result.delivery.reviews).filter(review => review.needId === needId)
    expect(reviews.every(review => review.source === 'autopilot-policy' && review.approvalRequestId === undefined)).toBe(true)
    execFileSync('git', ['-C', workspace, 'fetch', 'origin'], { stdio: 'pipe' })
    const content = execFileSync('git', ['-C', workspace, 'show', `${release.commit}:${proof}`], { encoding: 'utf8' })
    expect(content).toBe(`AUTOPILOT ${suffix}\n`)
    process.stdout.write(`Autopilot acceptance: ${release.commit}; proof ${proof}; model steps ${record!.modelSteps}; wakes ${record!.wakeCount}\n`)
  })
})
