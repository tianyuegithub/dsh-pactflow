import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
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

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`,
      extraInstallAnchors: [`${PACKAGE_ROOT}/package.json`],
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
    for (const text of ['Seeded Project', 'Need title', 'Node title', 'ready']) {
      const content = dialog.getByText(text, { exact: true })
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
    const title = settings.getByText('PactFlow K3s templates', { exact: true })
    try {
      await expect.poll(() => title.count(), { timeout: 10_000 }).toBe(1)
    } catch {
      throw new Error(`PactFlow settings card missing; dialog=${(await settings.innerText()).slice(0, 2_000)}`)
    }
    expect(await settings.getByLabel('PactFlow K3s templates').count()).toBe(1)
    expect(await settings.getByText('Restart the Profile after saving.', { exact: true }).count()).toBe(1)
    await settings.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect.poll(async () => {
      const document = await readFile(`${scaffold.harnessHome}/settings.yaml`, 'utf8').catch(() => '')
      return document.includes('pactflow:') && document.includes('k3s: false')
    }, { timeout: 10_000 }).toBe(true)
  })
})
