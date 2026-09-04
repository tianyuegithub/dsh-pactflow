import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'
import { PACTFLOW_EVENT_TYPES_V0_1 } from '../src/domain.ts'

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
      v: 1,
      need: {
        id: 'need-e2e', title: 'Need title', description: 'Browser evidence', phase: 'planning',
        revision: 5, createdAt, updatedAt: createdAt,
      },
    }),
    event(3, 'pactflow/node-created', {
      v: 1,
      node: {
        id: 'node-e2e', needId: 'need-e2e', title: 'Node title', state: 'ready',
        revision: 1, dependencies: [], updatedAt: createdAt,
      },
    }),
    event(4, 'turn/start', { turn: 1 }),
    event(5, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
  ].join('\n')
}

describe('PactFlow external Bundle Web UI', { timeout: 120_000 }, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let bundleAnchor: Awaited<ReturnType<typeof localBundleAnchor>> | undefined

  beforeAll(async () => {
    bundleAnchor = await localBundleAnchor()
    scaffold = await launchWebScaffold({
      extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`,
      extraInstallAnchors: [bundleAnchor.anchorPath],
    })
    await seedSession(scaffold, seedLog(), SEED_ID, 'pactflow')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
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
    for (const text of ['Seeded Project', 'Need title', '任务节点', '等待派发']) {
      const content = dialog.getByText(text, { exact: true }).first()
      await content.waitFor({ timeout: 15_000 })
      expect(await content.count()).toBeGreaterThan(0)
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
    // The card is intentionally read-only until a resource is added; the
    // settings shell does not render a save action for an unchanged form.
  })
})
