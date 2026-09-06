import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'
import { PACTFLOW_EVENT_TYPES_V0_1 } from '../src/domain.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

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
  const need = { id: 'need-e2e', title: 'Need title', description: 'Browser evidence',
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
    for (const text of ['Seeded Project', 'Need title', 'Node title', '等待派发']) {
      const content = dialog.getByText(text, { exact: true }).first()
      await content.waitFor({ timeout: 15_000 })
      expect(await content.count()).toBeGreaterThan(0)
    }
    if (process.env.PACTFLOW_WEB_EVIDENCE_DIR !== undefined) await page.screenshot({ path: join(process.env.PACTFLOW_WEB_EVIDENCE_DIR, 'overlay.png') })
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(browserErrors).toEqual([])
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
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
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
})
