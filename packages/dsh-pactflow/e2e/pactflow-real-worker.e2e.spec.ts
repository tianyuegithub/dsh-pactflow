import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  type WebScaffold,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import {
  connectFreshWorkspace,
  newEnglishPage,
  writeComposerDraft,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const record = process.env.DSH_SNAPSHOT === 'record'

async function livePactFlowSession(scaffold: WebScaffold): Promise<string | undefined> {
  const response = await scaffold.hostFetch('/api/session/list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'pactflow-real-worker-preset', method: 'session/list',
      payload: { args: { _request: {} } },
    }),
  })
  const body = await response.json() as {
    result?: { value?: { items?: { sessionId: string; projections?: { values?: { agentPreset?: string } } }[] } }
  }
  return body.result?.value?.items?.find(item =>
    item.projections?.values?.agentPreset === 'pactflow')?.sessionId
}

describe.skipIf(!record)('PactFlow real local Worker', { timeout: 300_000 }, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`,
      extraInstallAnchors: [`${PACKAGE_ROOT}/package.json`],
      agentPresets: {
        default: 'standard',
        roots: [{ path: `${PACKAGE_ROOT}/presets`, trust: 'user' }],
      },
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 15_000 })
    const labels = await menu.getByRole('menuitem').allTextContents()
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/PactFlow|零脉/)]))
    await menu.getByRole('menuitem', { name: /PactFlow|零脉/ }).click()
    await page.getByRole('button', { name: /PactFlow|零脉/ }).waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('uses PactFlow tools and settles a real spawn Worker Run', async () => {
    await expect.poll(() => livePactFlowSession(scaffold), { timeout: 15_000 }).not.toBeUndefined()
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, [
      'Use only PactFlow tools and perform these steps in order:',
      '1. initialize project named Real Worker E2E;',
      '2. create need id real-worker, title Real Worker, description real model acceptance;',
      '3. create root node id worker-node under need real-worker with no dependencies;',
      '4. dispatch that node with provider spawn, lease 60000ms, prompt: Reply exactly worker done and use no tools.',
      'Wait for the Worker result, then reply with a brief completion statement.',
    ].join(' '))
    const expectedSessionId = await livePactFlowSession(scaffold)
    expect(expectedSessionId).toBeDefined()
    await composer.press('Enter')
    const sessionId = expectedSessionId as string
    await expect.poll(() => scaffold.ctx.sessions.get(sessionId)?.events
      .findLast(event => event.type === 'pactflow/run-settled'), {
      timeout: 240_000,
      intervals: [250, 500, 1_000],
    }).toBeDefined()
    const session = scaffold.ctx.sessions.get(sessionId)
    expect(session?.events.findLast(event => event.type === 'agent-preset/selected'))
      .toMatchObject({ data: { agentPreset: 'pactflow' } })
    const settled = session?.events.findLast(event => event.type === 'pactflow/run-settled')
    if (settled === undefined) {
      const turnEnd = session?.events.findLast(event => event.type === 'turn/end')
      const eventCounts = Object.fromEntries(Object.entries(Object.groupBy(
        session?.events ?? [], event => event.type,
      )).map(([type, events]) => [type, events?.length ?? 0]))
      const toolTrace = session?.events
        .filter(event => event.type === 'tool/call' || event.type === 'tool/result')
        .map(event => ({ type: event.type, data: event.data }))
      const assistant = session?.events.findLast(event => event.type === 'assistant/message')
      throw new Error(`real Worker emitted no run-settled; eventCounts=${JSON.stringify(eventCounts)}; toolTrace=${JSON.stringify(toolTrace)}; assistant=${JSON.stringify(assistant?.data).slice(0, 1_000)}; turnEnd=${JSON.stringify(turnEnd?.data)}`)
    }
    if (settled?.type === 'pactflow/run-settled') {
      expect(settled.data.run.state).toBe('succeeded')
      expect(settled.data.node.state).toBe('succeeded')
    }
  })
})
