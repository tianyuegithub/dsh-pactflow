import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'
import { PACTFLOW_EVENT_TYPES_V0_1 } from '../src/domain.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { executionDigest } from '../src/execution-plan.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SEED_ID = 'pactflow-overlay-e2e'

/**
 * The scaffold intentionally excludes a selected layer package from its
 * profile-local fallback. This wrapper makes PactFlow a dependency instead,
 * preserving the real bare-package identity required by Host Remote routes.
 */
async function localBundleAnchor(): Promise<{ readonly directory: string, readonly anchorPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-pactflow-overlay-patch-'))
  const modules = join(directory, 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(PACKAGE_ROOT, join(modules, 'dsh-pactflow'), 'dir')
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  const anchorPath = join(directory, 'package.json')
  await writeFile(anchorPath, JSON.stringify({
    name: 'dsh-pactflow-overlay-e2e-anchor', private: true,
    dependencies: { 'dsh-pactflow': `file:${PACKAGE_ROOT}` },
  }))
  return { directory, anchorPath }
}

function seedLog(): string {
  const createdAt = 1_788_000_000_000
  const need = { id: 'need-e2e', title: 'Need title', description: `Browser evidence\n${'完整需求原文用于验证长文本折叠，不应遮蔽执行状态。'.repeat(40)}\nLONG_DETAIL_END`,
    phase: 'backlog', revision: 1, createdAt, updatedAt: createdAt }
  const event = (seq: number, type: string, data: unknown): string => JSON.stringify({
    type, seq, time: createdAt + seq, data,
  })
  return [
    JSON.stringify({
      type: 'session', version: 0, id: '{{sessionId}}', createdAt, cwd: '{{cwd}}', agentPreset: 'pactflow',
    }),
    event(0, 'session/external-event-producer', {
      producer: 'dsh-pactflow', version: '0.1.0', eventTypes: PACTFLOW_EVENT_TYPES_V0_1,
    }),
    event(1, 'pactflow/project-initialized', {
      v: 1,
      project: { id: SEED_ID, name: 'Seeded Project', revision: 1, createdAt, updatedAt: createdAt },
    }),
    event(2, 'pactflow/need-created', {
      v: 1, need,
    }),
    event(3, 'pactflow/phase-transitioned', { v: 1, from: 'backlog', need: { ...need, phase: 'discussion', revision: 2 } }),
    event(4, 'pactflow/review-recorded', { v: 1, review: { id: 'legacy-requirement', needId: need.id,
      kind: 'requirement', decision: 'approved', note: 'Historical requirement review', recordedAt: createdAt } }),
    event(5, 'pactflow/phase-transitioned', { v: 1, from: 'discussion', need: { ...need, phase: 'confirmed', revision: 3 } }),
    event(6, 'pactflow/phase-transitioned', { v: 1, from: 'confirmed', need: { ...need, phase: 'design', revision: 4 } }),
    event(7, 'pactflow/review-recorded', { v: 1, review: { id: 'legacy-design', needId: need.id,
      kind: 'design', decision: 'approved', note: 'Historical design review', recordedAt: createdAt } }),
    event(8, 'pactflow/phase-transitioned', { v: 1, from: 'design', need: { ...need, phase: 'planning', revision: 5 } }),
    event(9, 'pactflow/node-created', {
      v: 1,
      node: {
        id: 'node-e2e', needId: 'need-e2e', title: 'Node title', state: 'ready',
        revision: 1, dependencies: [], updatedAt: createdAt,
      },
    }),
    event(10, 'turn/start', { turn: 1 }),
    event(11, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
  ].join('\n')
}

describe('PactFlow external Bundle Web UI', { timeout: 120_000 }, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const browserErrors: string[] = []
  let bundleAnchor: Awaited<ReturnType<typeof localBundleAnchor>> | undefined

  beforeAll(async () => {
    bundleAnchor = await localBundleAnchor()
    scaffold = await launchWebScaffold({
      extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`,
      extraInstallAnchors: [bundleAnchor.anchorPath],
      // The scaffold deliberately replaces agent-presets config after extra overlays.
      agentPresets: { default: 'standard', roots: [{ path: join(PACKAGE_ROOT, 'presets'), trust: 'user' }] },
    })
    await seedSession(scaffold, seedLog(), SEED_ID, 'pactflow')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('pageerror', error => browserErrors.push(error.message.replace(/https?:\/\/\S+/g, '[URL redacted]')))
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text().replace(/https?:\/\/\S+/g, '[URL redacted]'))
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    expect(new URL(page.url()).origin).toBe(new URL(scaffold.authenticatedUrl).origin)
    expect(await page.title()).not.toBe('')
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (bundleAnchor !== undefined) await rm(bundleAnchor.directory, { recursive: true, force: true })
  })

  afterEach(async () => {
    if (!page) return
    const pane = page.getByRole('dialog', { name: 'PactFlow', exact: true })
    if (await pane.count() > 0) await pane.getByRole('button', { name: 'Close', exact: true }).click()
  })

  it('shows the conditional entry and renders real Projection tables', async () => {
    await page.getByRole('treeitem', { name: /^Ungrouped/ }).click()
    await page.locator('[role="treeitem"]').last().click()
    const open = page.getByRole('button', { name: 'Open PactFlow' })
    await open.waitFor({ timeout: 15_000 })
    await open.click()

    const dialog = page.getByRole('dialog', { name: 'PactFlow' })
    await dialog.waitFor({ timeout: 15_000 })
    await expect.poll(async () => await dialog.textContent(), { timeout: 15_000 })
      .toContain('Seeded Project')
    expect(await dialog.getByLabel('选择需求', { exact: true }).inputValue()).toBe('need-e2e')
    const descriptionDetails = dialog.locator('details').filter({ hasText: '完整需求说明' })
    expect(await descriptionDetails.getAttribute('open')).toBeNull()
    expect(await dialog.getByText(/LONG_DETAIL_END/).isVisible()).toBe(false)
    await descriptionDetails.locator('summary').click()
    expect(await dialog.getByText(/LONG_DETAIL_END/).isVisible()).toBe(true)
    await descriptionDetails.locator('summary').click()
    for (const text of ['Seeded Project', 'Node title', '等待派发']) {
      await dialog.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 })
    }
    expect(await dialog.getByText('Worker Pool capacity', { exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: 'API test', exact: true }).count()).toBe(0)
    await dialog.getByRole('button', { name: '挂机设置', exact: true }).click()
    const autopilot = dialog.getByRole('region', { name: '按需求挂机控制' })
    await autopilot.getByText('调整预算', { exact: true }).click()
    expect(await autopilot.getByLabel('编排模型调用次数（1—1000）').inputValue()).toBe('60')
    expect(await autopilot.getByRole('button', { name: '准备挂机', exact: true }).isVisible()).toBe(true)
    await dialog.getByRole('tab', { name: '进展', exact: true }).click()
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'overlay.png') })
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(browserErrors).toEqual([])
  })

  it('uses native theme surfaces and traps keyboard focus without losing the composer draft', async () => {
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.fill('未发送的界面验收草稿')
    await page.emulateMedia({ colorScheme: 'dark' })
    const open = page.getByRole('button', { name: 'Open PactFlow', exact: true })
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'PactFlow', exact: true })
    await dialog.getByRole('tab', { name: '进展', exact: true }).waitFor()
    const surface = () => dialog.evaluate(element => {
      const style = getComputedStyle(element)
      const probe = document.createElement('span')
      probe.style.color = 'var(--dsw-alias-bg-layer-2)'; element.append(probe)
      const expected = getComputedStyle(probe).color; probe.remove()
      return { actual: style.backgroundColor, expected }
    })
    await expect.poll(async () => { const s = await surface(); return s.actual === s.expected }).toBe(true)
    const dark = (await surface()).actual
    for (let count = 0; count < 14; count++) {
      await page.keyboard.press(count < 7 ? 'Tab' : 'Shift+Tab')
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'workbench-progress-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(async () => (await surface()).actual).not.toBe(dark)
    const light = await surface(); expect(light.actual).toBe(light.expected)
    await dialog.getByRole('tab', { name: '验收交付', exact: true }).click()
    await dialog.getByText('评审决定', { exact: true }).waitFor()
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'workbench-delivery-light.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true)
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'workbench-mobile.png') })
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(0)
    expect(await open.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await composer.textContent()).toBe('未发送的界面验收草稿')
    await composer.fill('')
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  it('rejects an autopilot preview for another Need or revision before showing authorization', async () => {
    const previewRoute = '**/api/pactflow/autopilotPreview'
    let wrongRevision = false
    await page.route(previewRoute, async route => {
      const rpcId = route.request().postDataJSON().rpcId
      await route.fulfill({ json: { type: 'server-response', rpcId, result: { ok: true, value: {
        needId: wrongRevision ? 'need-e2e' : 'another-need', needRevision: wrongRevision ? 999 : 5,
        title: 'Wrong preview', description: '', repository: 'fixture', branch: 'main',
        scopeDigest: 'a'.repeat(64), executionOptions: [], validationProfiles: [],
      } } } })
    })
    try {
      await page.getByRole('button', { name: 'Open PactFlow' }).click()
      const pane = page.getByRole('dialog', { name: 'PactFlow', exact: true })
      await pane.getByRole('button', { name: '挂机设置', exact: true }).click()
      for (const revisionMismatch of [false, true]) {
        wrongRevision = revisionMismatch
        await pane.getByRole('button', { name: '准备挂机', exact: true }).click()
        await pane.getByText('挂机预览与当前需求不匹配，请刷新后重试', { exact: true }).waitFor()
        expect(await pane.getByRole('button', { name: '授权并开始挂机', exact: true }).count()).toBe(0)
      }
    } finally { await page.unroute(previewRoute) }
  })

  it('updates the open overlay from live Host projection changes without reopening', async () => {
    const liveId = SessionId('pactflow-live-e2e')
    await scaffold.ctx.sessionController.create({ sessionId: liveId, cwd: scaffold.workspaceCwd, agentPreset: 'pactflow' })
    // Session lists hide blank sessions; use the same closed aborted-turn fixture as the cold log.
    const liveSession = scaffold.ctx.sessions.get(liveId)!
    liveSession.append('turn/start', { turn: 1 })
    liveSession.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
    await scaffold.ctx.sessionController.rename({ sessionId: liveId, title: 'Live projection session' })
    const initialized = await scaffold.hostFetch('/api/pactflow/initialize', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'pactflow-live-init', method: 'pactflow/initialize',
        payload: { args: { sessionId: liveId, request: { name: 'Live Project' } } } }),
    })
    expect(await initialized.json()).toMatchObject({ result: { value: { name: 'Live Project' } } })
    await scaffold.ctx.sessions.flush(liveSession)
    // Refresh navigation before the measured interaction; never reload after the tested write.
    await page.reload({ waitUntil: 'load' })
    const ungrouped = page.getByRole('treeitem', { name: /^Ungrouped/ })
    await ungrouped.waitFor({ timeout: 10_000 })
    if (await ungrouped.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
    try {
      await page.getByRole('treeitem').filter({ hasText: 'Live projection session' }).last().click({ timeout: 5_000 })
    } catch {
      throw new Error(`Live fixture navigation failed; tree rows=${JSON.stringify(await page.getByRole('treeitem').allTextContents())}`)
    }
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    const dialog = page.getByRole('dialog', { name: 'PactFlow' })
    await expect.poll(() => dialog.textContent(), { timeout: 5_000 }).toContain('Live Project')
    await dialog.getByText('尚未开始执行需求', { exact: true }).waitFor()
    expect(await dialog.getByLabel('编排模型调用次数（1—1000）').count()).toBe(0)
    expect(await dialog.getByText('暂无数据', { exact: true }).count()).toBe(0)
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'workbench-empty-light.png') })

    const response = await scaffold.hostFetch('/api/pactflow/createNeed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'pactflow-live-need', method: 'pactflow/createNeed',
        payload: { args: { sessionId: liveId, request: { id: 'live-need', title: 'Live Need', description: 'Live projection update' } } } }),
    })
    expect(await response.json()).toMatchObject({ result: { value: { id: 'live-need' } } })
    await expect.poll(() => dialog.textContent(), { timeout: 5_000 }).toContain('Live Need')
    expect(browserErrors).toEqual([])
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'live-overlay.png') })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('treeitem').filter({ hasText: basename(scaffold.workspaceCwd) }).last().click()
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    await expect.poll(() => dialog.textContent(), { timeout: 5_000 }).toContain('Seeded Project')
    expect(await dialog.textContent()).not.toContain('Live Need')
  })

  it('presents retained failure scenes and exports the handover summary read-only', async () => {
    // Own live session so the test does not depend on the earlier case's state.
    const liveId = SessionId('pactflow-readonly-e2e')
    await scaffold.ctx.sessionController.create({ sessionId: liveId, cwd: scaffold.workspaceCwd, agentPreset: 'pactflow' })
    const session = scaffold.ctx.sessions.get(liveId)!
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
    await scaffold.ctx.sessionController.rename({ sessionId: liveId, title: 'Readonly entries session' })
    await scaffold.hostFetch('/api/pactflow/initialize', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'readonly-init', method: 'pactflow/initialize',
        payload: { args: { sessionId: liveId, request: { name: 'Readonly Project' } } } }) })
    // A retained failure scene: visible to a human, never auto-cleaned by this view.
    // The cleanup must reference a real Need or the delivery fold rejects it.
    session.append('pactflow/need-created', { v: 1, need: {
      id: 'readonly-need', title: 'Readonly Need', description: '', phase: 'backlog',
      revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
    } })
    session.append('pactflow/cleanup-recorded', { v: 1, record: {
      id: 'retained-scene', needId: 'readonly-need', target: 'git:pactflow/readonly/x',
      state: 'failed', attempt: 1, retain: true, sizeBytes: 2_048, retainUntil: Date.now() - 60_000,
    } })
    await scaffold.ctx.sessions.flush(session)
    await page.reload({ waitUntil: 'load' })
    const ungrouped = page.getByRole('treeitem', { name: /^Ungrouped/ })
    await ungrouped.waitFor({ timeout: 10_000 })
    if (await ungrouped.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
    await page.getByRole('treeitem').filter({ hasText: 'Readonly entries session' }).last().click({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    const dialog = page.getByRole('dialog', { name: 'PactFlow' })
    await expect.poll(() => dialog.textContent(), { timeout: 10_000 }).toContain('Readonly Project')

    // A05: the retained scene (with its overdue flag) is visible read-only.
    await dialog.getByRole('button', { name: /保留现场/ }).click()
    await expect.poll(() => dialog.textContent(), { timeout: 10_000 }).toContain('Retained scenes')
    const retentionText = await dialog.textContent()
    expect(retentionText).toContain('retained-scene')

    // A12-c: the export entry renders the read-only handover summary, including
    // the package/reader versions that make an old log traceable.
    await dialog.getByRole('button', { name: '移交摘要', exact: true }).click()
    await dialog.getByRole('button', { name: '生成移交摘要', exact: true }).click()
    await dialog.getByText('结构化数据', { exact: true }).click()
    const summary = dialog.locator('[data-handover="summary"]')
    await summary.waitFor({ timeout: 10_000 })
    const summaryText = (await summary.textContent()) ?? ''
    expect(summaryText).toContain('packageVersion')
    expect(summaryText).toContain('eventProducerVersion')
    expect(summaryText).toContain('retained-scene')
    expect(browserErrors).toEqual([])
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'readonly-entries.png') })
    await dialog.getByRole('button', { name: 'Close' }).click()
  })

  it.each(['repository', 'protection'] as const)('closing the overlay cancels the pending Gitea %s connection', async stage => {
    let received = 0
    let closed = false
    const server = createServer((request, response) => {
      received++
      if (stage === 'protection' && !request.url?.endsWith('/branch_protections/main')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ full_name: 'owner/repo', default_branch: 'main', private: true, archived: false }))
        return
      }
      response.once('close', () => { closed = true })
      // Deliberately keep the response pending so only cancellation can finish it before the Host timeout.
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const ref = `PACTFLOW_E2E_CANCEL_${randomUUID().replaceAll('-', '').toUpperCase()}`
    process.env[ref] = 'isolated-test-value'
    try {
      const session = scaffold.ctx.sessions.get(SessionId('pactflow-live-e2e'))!
      const project = scaffold.ctx.sessionProjections.stateOf(session, 'pactflowProject')!.project!
      // Bind only test metadata: this case verifies the actual Remote/HTTP cancellation chain, not Git adoption.
      session.append('pactflow/project-configured', { v: 1, project: { ...project,
        revision: project.revision + 1, updatedAt: Date.now(), git: {
          remote: 'origin', remoteUrl: 'https://git.invalid/owner/repo.git', defaultBranch: 'main',
          revision: (project.git?.revision ?? 0) + 1, boundAt: Date.now(), validationCommands: [], gitea: {
            baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            owner: 'owner', repo: 'repo', tokenCredentialRef: ref,
          },
        },
      } })
      const previous = page.getByRole('dialog', { name: 'PactFlow' })
      if (await previous.count() > 0) await previous.getByRole('button', { name: 'Close' }).click()
      await page.getByRole('treeitem').filter({ hasText: 'Live projection session' }).last().click()
      await page.getByRole('button', { name: 'Open PactFlow' }).click()
      const dialog = page.getByRole('dialog', { name: 'PactFlow' })
      await dialog.getByRole('tab', { name: '验收交付', exact: true }).click()
      await dialog.getByRole('button', { name: 'Verify Gitea' }).click()
      await expect.poll(() => received, { timeout: 5_000 }).toBe(stage === 'repository' ? 1 : 2)
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect.poll(() => closed, { timeout: 2_000 }).toBe(true)
      expect(await dialog.count()).toBe(0)
      expect(browserErrors).toEqual([])
    } finally {
      delete process.env[ref]
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('registers a restart-applied PactFlow settings card', async () => {
    const response = await scaffold.hostFetch('/api/settings/describe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'pactflow-settings-describe',
        method: 'settings/describe', payload: { args: {} },
      }),
    })
    const described = await response.json() as {
      result?: { value?: { namespaces?: { ns: string }[] } }
    }
    expect(described.result?.value?.namespaces?.map(namespace => namespace.ns)).toContain('pactflow')
    const pactflowDialog = page.getByRole('dialog', { name: 'PactFlow' })
    if (await pactflowDialog.count() > 0) await pactflowDialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: 'Plugins', exact: true }).click()
    const pluginConfiguration = settings.getByRole('tab', { name: 'Plugin configuration', exact: true })
    await pluginConfiguration.click()
    const title = settings.getByText('PactFlow infrastructure', { exact: true })
    try {
      await expect.poll(() => title.count(), { timeout: 10_000 }).toBe(1)
    } catch {
      throw new Error(`PactFlow settings card missing; dialog=${(await settings.innerText()).slice(0, 2_000)}`)
    }
    expect(await title.count()).toBe(1)
    expect(await settings.getByText('Restart the Profile after saving.', { exact: true }).count()).toBe(1)
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'settings.png') })
    expect(browserErrors).toEqual([])
    // The card is intentionally read-only until a resource is added; the
    // settings shell does not render a save action for an unchanged form.
  })

  it('lets the user register a validation profile through the project panel', async () => {
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: scaffold.workspaceCwd })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: '零脉项目', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '零脉项目', exact: true })
    const editor = dialog.getByRole('region', { name: '宿主验证配置' })
    await editor.waitFor({ timeout: 5_000 })
    await editor.getByRole('button', { name: '新增验证配置' }).click()
    await editor.getByLabel('配置编号', { exact: true }).fill('git-check')
    await editor.getByLabel('显示名称', { exact: true }).fill('检查差异')
    await editor.getByLabel('可执行命令', { exact: true }).fill('/bin/sh')
    expect(await editor.getByRole('button', { name: '保存验证配置' }).isEnabled()).toBe(false)
    await editor.getByLabel('可执行命令', { exact: true }).fill('git')
    await editor.getByLabel('参数数组', { exact: true }).fill('["diff","--check"]')
    const layout = await editor.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight,
      display: getComputedStyle(element).display, minHeight: getComputedStyle(element).minHeight,
      parentRows: getComputedStyle(element.parentElement!).gridTemplateRows,
      bottom: element.getBoundingClientRect().bottom, nextTop: element.nextElementSibling?.getBoundingClientRect().top ?? Infinity }))
    if (layout.content > layout.height) throw new Error(`Validation editor clipped: ${JSON.stringify(layout)}`)
    expect(layout.bottom).toBeLessThanOrEqual(layout.nextTop)
    await editor.getByLabel('默认收口验证', { exact: true }).check({ timeout: 5_000 })
    await editor.getByRole('button', { name: '保存验证配置' }).click()
    const readConfig = async () => {
      const response = await scaffold.hostFetch('/api/pactflow/listWorkspaceProjects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'validation-readback', method: 'pactflow/listWorkspaceProjects', payload: { args: {} } }),
      })
      const body = await response.json() as { result: { value: { workspaceId: string; config?: unknown }[] } }
      return body.result.value.find(row => row.workspaceId === workspace.workspaceId)?.config
    }
    await expect.poll(readConfig, { timeout: 5_000 }).toMatchObject({ validationProfileIds: ['git-check'], validationProfiles: [
      { id: 'git-check', displayName: '检查差异', command: 'git', args: ['diff', '--check'], revision: 1 },
    ] })
    await expect.poll(() => editor.getByLabel('配置编号', { exact: true }).isDisabled()).toBe(true)
    await editor.getByLabel('显示名称', { exact: true }).fill('未保存名称')
    await editor.getByRole('button', { name: '撤销未保存更改' }).click()
    expect(await editor.getByLabel('显示名称', { exact: true }).inputValue()).toBe('检查差异')
    await editor.getByLabel('默认收口验证', { exact: true }).uncheck()
    await editor.getByRole('button', { name: '保存验证配置' }).click()
    await expect.poll(readConfig, { timeout: 5_000 }).toMatchObject({ validationProfileIds: [], validationProfiles: [
      { id: 'git-check', displayName: '检查差异', revision: 1 },
    ] })
    expect(browserErrors).toEqual([])
    await editor.scrollIntoViewIfNeeded()
    const bounds = await editor.evaluate(element => ({ visible: element.clientHeight, content: element.scrollHeight }))
    expect(bounds.content).toBeLessThanOrEqual(bounds.visible)
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'validation-profiles.png') })
    // A8: an unsaved editor draft turns the panel close into a two-step
    // discard confirmation; confirming drops the draft, so reopening shows
    // the persisted value instead.
    await editor.getByLabel('显示名称', { exact: true }).fill('未保存草稿名')
    const panelClose = dialog.getByRole('button', { name: '关闭', exact: true })
    await panelClose.click()
    const discardConfirm = dialog.getByRole('button', { name: '未保存更改将丢失，确认关闭？' })
    await discardConfirm.waitFor({ timeout: 5_000 })
    await editor.getByLabel('显示名称', { exact: true }).fill('未保存草稿名二')
    await discardConfirm.click()
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })
    await page.getByRole('button', { name: '零脉项目', exact: true }).click()
    const reopened = page.getByRole('dialog', { name: '零脉项目' })
    await reopened.waitFor({ timeout: 10_000 })
    const reopenedEditor = reopened.getByRole('region', { name: '宿主验证配置' })
    await expect.poll(() => reopenedEditor.getByLabel('显示名称', { exact: true }).inputValue(), { timeout: 10_000 })
      .toBe('检查差异')
    await reopened.getByRole('button', { name: '关闭', exact: true }).click()
  })

  it('refreshes workspace configuration in the open overlay after projection movement', async () => {
    // The host resolves a session's workspace as the first registry entry
    // matching the session cwd; pick rows the same way here.
    const readWorkspaces = async () => {
      const response = await scaffold.hostFetch('/api/pactflow/listWorkspaceProjects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'runtime-refresh-read', method: 'pactflow/listWorkspaceProjects', payload: { args: {} } }),
      })
      const body = await response.json() as { result: { value: { workspaceId: string; path: string; config?: { revision?: number } }[] } }
      return body.result.value.filter(row => row.path === scaffold.workspaceCwd)
    }
    if ((await readWorkspaces()).length === 0) {
      await scaffold.ctx.workspaceController.create({ path: scaffold.workspaceCwd })
    }
    const before = await readWorkspaces()
    expect(before.length).toBeGreaterThan(0)
    const workspaceId = before[0]!.workspaceId
    // A freshly registered workspace has no stored config yet; revision 0 is
    // its CAS baseline for the first save.
    const saved = await scaffold.hostFetch('/api/pactflow/saveValidationProfiles', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'runtime-refresh-seed', method: 'pactflow/saveValidationProfiles',
        payload: { args: { request: { workspaceId, expectedRevision: before[0]!.config?.revision ?? 0,
          profiles: [{ id: 'runtime-check', displayName: '运行时检查', command: 'git', args: ['status'], timeoutMs: 5_000 }] } } } }),
    })
    const savedBody = await saved.json() as { result?: { value?: { revision?: number } } }
    const firstRevision = savedBody.result?.value?.revision
    expect(typeof firstRevision).toBe('number')
    const liveId = SessionId('pactflow-live-e2e')
    const leftover = page.getByRole('dialog', { name: 'PactFlow' })
    if (await leftover.count() > 0) await leftover.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('treeitem').filter({ hasText: 'Live projection session' }).last().click()
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    const dialog = page.getByRole('dialog', { name: 'PactFlow' })
    await dialog.getByRole('button', { name: '运行诊断', exact: true }).click()
    await expect.poll(() => dialog.textContent(), { timeout: 5_000 })
      .toContain(`修订 ${String(firstRevision)}`)
    // Change the workspace configuration while the overlay is open. The
    // workspace data is not a Session projection, so the overlay only notices
    // it on the next runtime refresh instead of the live projection update.
    const save = await scaffold.hostFetch('/api/pactflow/saveValidationProfiles', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'runtime-refresh-save', method: 'pactflow/saveValidationProfiles',
        payload: { args: { request: { workspaceId, expectedRevision: firstRevision,
          validationProfileIds: [] } } } }),
    })
    expect(await save.json()).toMatchObject({ result: { value: { revision: firstRevision! + 1 } } })
    expect(await dialog.textContent()).toContain(`修订 ${String(firstRevision)}`)
    // A projection movement is the refresh trigger; the refreshed runtime data
    // must show the new revision without reopening the overlay.
    const need = await scaffold.hostFetch('/api/pactflow/createNeed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'runtime-refresh-need', method: 'pactflow/createNeed',
        payload: { args: { sessionId: liveId, request: { id: 'runtime-need', title: 'Runtime Need', description: '' } } } }),
    })
    expect(await need.json()).toMatchObject({ result: { value: { id: 'runtime-need' } } })
    await expect.poll(() => dialog.textContent(), { timeout: 5_000 })
      .toContain(`修订 ${String(firstRevision! + 1)}`)
    expect(await dialog.textContent()).toContain('Runtime Need')
    expect(browserErrors).toEqual([])
    await dialog.getByRole('button', { name: 'Close' }).click()
  })

  it('keeps the overlay and project panel usable inside a mobile viewport', async () => {
    // Reuse the desktop page with its selected session; the DSH shell changes
    // its own navigation chrome at narrow widths, which is outside plugin scope.
    await page.setViewportSize({ width: 390, height: 844 })
    try {
      await page.getByRole('button', { name: 'Open PactFlow' }).click()
      const dialog = page.getByRole('dialog', { name: 'PactFlow' })
      await dialog.waitFor({ timeout: 15_000 })
      await expect.poll(() => dialog.textContent(), { timeout: 10_000 }).toContain('Live Project')
      const panel = dialog.locator('section').first()
      const box = await panel.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
      expect(await page.locator('vite-error-overlay').count()).toBe(0)
      await dialog.getByRole('button', { name: 'Close' }).click()
      expect(await dialog.count()).toBe(0)
      // The project panel's validation editor must not scroll horizontally.
      await page.getByRole('button', { name: '零脉项目', exact: true }).click()
      const projectPanel = page.getByRole('dialog', { name: '零脉项目', exact: true })
      await projectPanel.waitFor({ timeout: 10_000 })
      const editor = projectPanel.getByRole('region', { name: '宿主验证配置' })
      await editor.waitFor({ timeout: 10_000 })
      const bounds = await editor.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }))
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
      expect(await page.locator('vite-error-overlay').count()).toBe(0)
      expect(browserErrors).toEqual([])
      await projectPanel.getByRole('button', { name: '关闭', exact: true }).click()
    } finally { await page.setViewportSize({ width: 1680, height: 1000 }) }
  })

  it('distinguishes list and catalog failures from empty results and ignores a previous opening response', async () => {
    const loadingPage = await newEnglishPage(browser)
    const directory = join(scaffold.workspaceCwd, 'panel-reopen')
    await mkdir(directory, { recursive: true })
    const workspace = (await scaffold.ctx.workspaceController.create({ path: directory })).workspace
    let failList = true
    let failCatalog = true
    let releaseOld!: () => void
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve })
    let oldStarted = false
    let oldCaptured = false
    let oldFinished = false
    await loadingPage.route('**/api/pactflow/listWorkspaceProjectSummaries', async route => {
      if (failList) await route.abort()
      else await route.continue()
    })
    await loadingPage.route('**/api/pactflow/listModelConnections', async route => {
      if (failCatalog) await route.abort()
      else await route.continue()
    })
    await loadingPage.route('**/api/pactflow/workspaceProjectDetails', async route => {
      const id = route.request().postDataJSON().payload.args.workspaceId
      const hold = id === workspace.workspaceId && !oldStarted
      if (hold) oldStarted = true
      const response = await route.fetch()
      if (hold) { oldCaptured = true; await oldGate }
      await route.fulfill({ response })
      if (hold) oldFinished = true
    })
    try {
      await loadingPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const open = loadingPage.getByRole('button', { name: '零脉项目', exact: true })
      await open.click()
      const panel = loadingPage.getByRole('dialog', { name: '零脉项目', exact: true })
      await panel.getByRole('button', { name: '重试工作区列表' }).waitFor()
      await panel.getByRole('button', { name: '重试资源目录' }).waitFor()
      expect(await panel.getByText('尚无工作区。', { exact: true }).count()).toBe(0)
      failList = false
      await panel.getByRole('button', { name: '重试工作区列表' }).click()
      const row = panel.getByRole('navigation', { name: '工作区项目' }).getByRole('button', { name: /panel-reopen/ })
      await row.click()
      await expect.poll(() => oldCaptured).toBe(true)
      await panel.getByRole('button', { name: '关闭', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
      execFileSync('git', ['init', '-b', 'main', directory], { stdio: 'ignore' })
      await open.click()
      await panel.getByText('已初始化', { exact: true }).waitFor()
      failCatalog = false
      const catalogResponse = loadingPage.waitForResponse(response => response.url().endsWith('/api/pactflow/listModelConnections') && response.status() === 200)
      await panel.getByRole('button', { name: '重试资源目录' }).click()
      await catalogResponse
      await panel.getByRole('button', { name: '重试资源目录' }).waitFor({ state: 'hidden' })
      await panel.getByText('正在加载资源目录…', { exact: true }).waitFor({ state: 'hidden' })
      expect(await panel.getByRole('button', { name: '重试资源目录' }).count()).toBe(0)
      releaseOld()
      await expect.poll(() => oldFinished).toBe(true)
      expect(await panel.getByText('已初始化', { exact: true }).isVisible()).toBe(true)
      expect(await panel.getByText('未初始化', { exact: true }).count()).toBe(0)
    } finally { releaseOld(); await loadingPage.close() }
  })

  it('renders navigation before slow details and catalogs, isolates late selection responses, and retries failures', async () => {
    // Isolated browser transport gates delay real Host results; no fabricated
    // successful payloads, session replay, or Git facts replace the real path.
    const loadingPage = await newEnglishPage(browser)
    const a = join(scaffold.workspaceCwd, 'panel-loading-a')
    const b = join(scaffold.workspaceCwd, 'panel-loading-b')
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true })
    execFileSync('git', ['init', '-b', 'main', a], { stdio: 'ignore' })
    const wa = (await scaffold.ctx.workspaceController.create({ path: a })).workspace
    const wb = (await scaffold.ctx.workspaceController.create({ path: b })).workspace
    let releaseDetails!: () => void
    let releaseCatalog!: () => void
    const detailGate = new Promise<void>(resolve => { releaseDetails = resolve })
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve })
    let catalogReleased = false
    let failDetails = false
    let migrationCalls = 0
    let failMigration = true
    const detailRequests: string[] = []
    let lateResponses = 0
    await loadingPage.route('**/api/pactflow/workspaceProjectDetails', async route => {
      const id = route.request().postDataJSON().payload.args.workspaceId as string
      detailRequests.push(id)
      if (failDetails) { await route.abort(); return }
      const response = await route.fetch()
      if (id !== wb.workspaceId) await detailGate
      await route.fulfill({ response })
      if (id !== wb.workspaceId) lateResponses += 1
    })
    await loadingPage.route('**/api/pactflow/listModelConnections', async route => {
      const response = await route.fetch()
      await catalogGate
      await route.fulfill({ response })
      catalogReleased = true
    })
    await loadingPage.route('**/api/pactflow/workspaceMigrationCandidates', async route => {
      migrationCalls += 1
      if (failMigration) await route.abort()
      else await route.continue()
    })
    try {
      await loadingPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await loadingPage.getByRole('button', { name: '零脉项目', exact: true }).click()
      const panel = loadingPage.getByRole('dialog', { name: '零脉项目', exact: true })
      const nav = panel.getByRole('navigation', { name: '工作区项目' })
      await nav.getByRole('button', { name: /panel-loading-a/ }).waitFor({ timeout: 5_000 })
      expect(await panel.getByText('尚无工作区。', { exact: true }).count()).toBe(0)
      expect(await panel.getByText('正在加载项目详情…', { exact: true }).isVisible()).toBe(true)
      expect(catalogReleased).toBe(false)
      expect(migrationCalls).toBe(0)
      await nav.getByRole('button', { name: /panel-loading-a/ }).click()
      await expect.poll(() => detailRequests).toContain(wa.workspaceId)
      await nav.getByRole('button', { name: /panel-loading-b/ }).click()
      await panel.getByRole('heading', { name: 'Git 仓库', exact: true }).waitFor({ timeout: 5_000 })
      expect(await panel.getByRole('button', { name: '保存 Agent 策略', exact: true }).isEnabled()).toBe(false)
      releaseDetails(); releaseCatalog()
      await expect.poll(() => lateResponses).toBeGreaterThan(0)
      // A is initialized, B is not: both the selected row AND its real Git
      // facts must survive the delayed A response.
      expect(await panel.getByText('未初始化', { exact: true }).isVisible()).toBe(true)
      const selectedStyle = await nav.getByRole('button', { name: /panel-loading-b/ }).getAttribute('style')
      expect(selectedStyle).not.toBe(await nav.getByRole('button', { name: /panel-loading-a/ }).getAttribute('style'))
      await panel.getByRole('button', { name: '查询迁移候选', exact: true }).click()
      await panel.getByRole('button', { name: '重试迁移候选', exact: true }).waitFor()
      expect(await panel.getByText('当前工作区没有可迁移的会话配置。').count()).toBe(0)
      failMigration = false
      await panel.getByRole('button', { name: '重试迁移候选', exact: true }).click()
      await panel.getByText('当前工作区没有可迁移的会话配置。').waitFor()
      expect(migrationCalls).toBe(2)
      failDetails = true
      await nav.getByRole('button', { name: /panel-loading-a/ }).click()
      await panel.getByRole('button', { name: '重试项目详情', exact: true }).waitFor()
      expect(await panel.getByRole('heading', { name: 'Git 仓库', exact: true }).count()).toBe(0)
      failDetails = false
      await panel.getByRole('button', { name: '重试项目详情', exact: true }).click()
      await panel.getByRole('heading', { name: 'Git 仓库', exact: true }).waitFor()
      expect(await panel.getByText('已初始化', { exact: true }).isVisible()).toBe(true)
    } finally {
      releaseDetails(); releaseCatalog()
      await loadingPage.close()
    }
  })
  it('opens the current unconfigured workspace and never falls back to a different project', async () => {
    const directory = join(scaffold.workspaceCwd, 'navigation-current')
    await mkdir(directory, { recursive: true })
    const workspace = (await scaffold.ctx.workspaceController.create({ path: directory })).workspace
    const sessionId = SessionId('navigation-current-session')
    await scaffold.ctx.sessionController.create({ sessionId, cwd: directory, agentPreset: 'pactflow' })
    const session = scaffold.ctx.sessions.get(sessionId)!
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Navigation session' })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('treeitem', { name: /^navigation-current/ }).click()
    await page.getByRole('treeitem').filter({ hasText: 'Navigation session' }).last().click()
    // Remember another project first; the workbench navigation must override it.
    await page.getByRole('button', { name: '零脉项目', exact: true }).click()
    const projectPanel = page.getByRole('dialog', { name: '零脉项目', exact: true })
    await projectPanel.getByRole('navigation').getByRole('button', { name: /panel-loading-a/ }).click()
    await projectPanel.getByRole('button', { name: '关闭', exact: true }).click()
    const detailIds: string[] = []
    const detailRoute = '**/api/pactflow/workspaceProjectDetails'
    const listRoute = '**/api/pactflow/listWorkspaceProjectSummaries'
    await page.route(detailRoute, async route => {
      detailIds.push(route.request().postDataJSON().payload.args.workspaceId)
      await route.continue()
    })
    try {
      await page.getByRole('button', { name: 'Open PactFlow' }).click()
      await page.getByRole('dialog', { name: 'PactFlow', exact: true }).getByRole('button', { name: '项目配置', exact: true }).click()
      await projectPanel.getByRole('heading', { name: 'Git 仓库', exact: true }).waitFor()
      expect(detailIds).toEqual([workspace.workspaceId])
      expect(await projectPanel.getByText('未初始化', { exact: true }).isVisible()).toBe(true)
      await projectPanel.getByRole('button', { name: '关闭', exact: true }).click()
      // Isolate a stale/missing registry entry at the read boundary.
      await page.route(listRoute, async route => {
        const response = await route.fetch()
        const body = await response.json()
        body.result.value = body.result.value.filter((row: { workspaceId: string }) => row.workspaceId !== workspace.workspaceId)
        await route.fulfill({ response, json: body })
      })
      detailIds.length = 0
      await page.getByRole('button', { name: 'Open PactFlow' }).click()
      await page.getByRole('dialog', { name: 'PactFlow', exact: true }).getByRole('button', { name: '项目配置', exact: true }).click()
      await projectPanel.getByText('当前会话未匹配到已登记工作区，请从左侧明确选择要配置的工作区。').waitFor()
      expect(detailIds).toEqual([])
      expect(await projectPanel.getByRole('heading', { name: 'Git 仓库', exact: true }).count()).toBe(0)
    } finally {
      await page.unroute(detailRoute); await page.unroute(listRoute)
      if (await projectPanel.count()) await projectPanel.getByRole('button', { name: '关闭', exact: true }).click()
    }
  })

  it('disables pending interaction controls when their deadline passes without a host event', async () => {
    // Boundary fixture: real Session projections and controls, no worker is dispatched.
    const session = scaffold.ctx.sessions.get(SessionId('navigation-current-session'))!
    const now = Date.now()
    session.append('pactflow/need-created', { v: 1, need: { id: 'expiry-need', title: 'Expiry Need', description: '', phase: 'backlog', revision: 1, createdAt: now, updatedAt: now } })
    const node = { id: 'expiry-node', needId: 'expiry-need', title: 'Expiry node', state: 'ready', revision: 1, dependencies: [], updatedAt: now }
    session.append('pactflow/node-created', { v: 1, node })
    const runId = `run-${randomUUID()}`
    session.append('pactflow/run-claimed', { v: 1, node: { ...node, state: 'claimed', revision: 2 }, run: {
      id: runId, nodeId: node.id, nodeRevision: 2, attempt: 1, provider: 'isolated-ui-fixture', claimId: 'expiry-claim', state: 'claimed', leaseDeadline: now + 60000, updatedAt: now,
    } })
    const request = { protocol: 'dsh-worker-interactions/v1' as const, bootId: 'expiry-boot', requestId: 'expiry-request', kind: 'approval' as const,
      createdAt: now, expiresAt: now + 5000, title: 'Expiry approval fixture', detail: 'Do not execute' }
    session.append('pactflow/worker-interaction', { v: 1, record: {
      id: 'expiry-record', sessionId: session.id, needId: node.needId, runId, podUid: 'fixture-pod', revision: 1,
      expiresAt: request.expiresAt, request, digest: executionDigest(request), state: 'pending', updatedAt: now, reason: '',
    } })
    await page.getByRole('button', { name: 'Open PactFlow' }).click()
    const pane = page.getByRole('dialog', { name: 'PactFlow', exact: true })
    const approve = pane.getByRole('button', { name: '批准', exact: true })
    await approve.waitFor()
    expect(await approve.isEnabled()).toBe(true)
    await expect.poll(() => approve.isDisabled(), { timeout: 8000 }).toBe(true)
    expect(await pane.getByRole('button', { name: '拒绝', exact: true }).isDisabled()).toBe(true)
    expect(await pane.getByText('已过期：等待人工处理已达到期限', { exact: true }).isVisible()).toBe(true)
    expect(scaffold.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.workerInteractions!['expiry-record']!.state).toBe('pending')
  })
})
