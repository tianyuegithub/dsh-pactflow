import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { createGitFixture } from '../tests/git-fixture.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const record = process.env.DSH_SNAPSHOT === 'record'

/** Publish a resolvable `dsh-pactflow` install anchor; the scaffold profile imports the package by name. */
async function localBundleAnchor(): Promise<{ readonly directory: string; readonly anchorPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-pactflow-worker-patch-'))
  const modules = join(directory, 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(PACKAGE_ROOT, join(modules, 'dsh-pactflow'), 'dir')
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  const anchorPath = join(directory, 'package.json')
  await writeFile(anchorPath, JSON.stringify({
    name: 'dsh-pactflow-worker-e2e-anchor', private: true,
    dependencies: { 'dsh-pactflow': `file:${PACKAGE_ROOT}` },
  }))
  return { directory, anchorPath }
}

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
  let sourceRoot: string
  let bundleAnchor: Awaited<ReturnType<typeof localBundleAnchor>> | undefined

  beforeAll(async () => {
    bundleAnchor = await localBundleAnchor()
    scaffold = await launchWebScaffold({
      extraOverlayPath: `${PACKAGE_ROOT}/cordis.patch.yml`,
      extraInstallAnchors: [bundleAnchor.anchorPath],
      agentPresets: {
        default: 'standard',
        roots: [{ path: `${PACKAGE_ROOT}/presets`, trust: 'user' }],
      },
    })
    // The original fixture was entirely under tmpdir(), which is independently
    // writable under workspace-write and masked the external Git metadata denial.
    // connectFreshWorkspace stages and connects `<root>/workspace`, i.e. exactly
    // the fixture clone root; passing the clone itself would nest an empty
    // non-checkout directory and break Git binding.
    sourceRoot = await mkdtemp(join(homedir(), '.pactflow-real-local-'))
    createGitFixture(sourceRoot)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, sourceRoot)
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 15_000 })
    const labels = await menu.getByRole('menuitem').allTextContents()
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/PactFlow|零脉/)]))
    await menu.getByRole('menuitem', { name: /PactFlow|零脉/ }).click()
    // The sidebar footer also matches the loose pattern since the project
    // panel entry exists; target the composer preset seat precisely.
    await page.getByRole('button', { name: '零脉模式' }).waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    await browser?.close()
    if (process.env.PACTFLOW_KEEP_ROOT === '1') {
      // Preserve the scene for diagnosis: skipping close() keeps the scaffold
      // workspace (scaffold.close() removes it).
      console.log(`[keep-root] ${scaffold?.workspaceCwd ?? '(none)'}`)
      return
    }
    await scaffold?.close()
    if (sourceRoot) await rm(sourceRoot, { recursive: true, force: true })
    if (bundleAnchor !== undefined) await rm(bundleAnchor.directory, { recursive: true, force: true })
  })

  it('uses PactFlow tools and accepts a real spawn Worker commit in its task worktree', async () => {
    await expect.poll(() => livePactFlowSession(scaffold), { timeout: 15_000 }).not.toBeUndefined()
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, [
      'Use only PactFlow tools and perform these steps in order:',
      '1. initialize project named Real Worker E2E;',
      '2. bind Git remote origin and default branch main using the current project revision;',
      '3. create need id real-worker, title Real Worker, description real model Git acceptance;',
      '4. call pactflow_confirm_execution_plan with ONE single-node plan (node id worker-node, title Real Worker, no dependencies, provider spawn) and wait for the native choice; the Host will create the selected node;',
      '5. after approval dispatch that exact node/prompt/route through pactflow_dispatch_git with DSH provider spawn and lease 60000ms. The Worker prompt must be: In the current task repository, create worker.txt containing exactly worker done followed by a newline, verify the file, git add it, and commit it with message worker done. Do not switch branches or modify any other file.',
      'Wait for the Worker result, then reply with a brief completion statement.',
    ].join(' '))
    const expectedSessionId = await livePactFlowSession(scaffold)
    expect(expectedSessionId).toBeDefined()
    await composer.press('Enter')
    const sessionId = expectedSessionId as string
    const question = page.locator('[data-question-key]')
    await question.waitFor({ timeout: 120000 })
    expect(await question.innerText()).toContain('worker.txt')
    await question.getByRole('radio', { name: /^批准单节点方案/ }).click()
    await question.getByRole('button', { name: 'Submit', exact: true }).click()
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
      if (settled.data.run.state !== 'succeeded') {
        // Surface the spawn Worker's own transcript so a failing acceptance
        // shows whether the model skipped, mis-scope, or errored the commit.
        const spawnTrace = session?.events
          .filter(event => event.type === 'tool/call' || event.type === 'tool/result')
          .map(event => ({ type: event.type, data: event.data }))
        console.log(`spawnTrace=${JSON.stringify(spawnTrace)?.slice(0, 6_000)}`)
        console.log(`assistant=${JSON.stringify(session?.events.findLast(event => event.type === 'assistant/message')?.data)?.slice(0, 2_000)}`)
        try {
          // The Worker runs as its own child Session. Dump every non-root session
          // (cwd, origin, tool calls/results, assistant text) so a silent Worker is
          // visible: did it attempt a write and get denied, or never attempt one?
          for (const other of scaffold.ctx.sessions.list()) {
            if (other.id === session?.id) continue
            const trace = other.events
              .filter(event => event.type === 'tool/call' || event.type === 'tool/result'
                || event.type === 'assistant/message' || event.type === 'turn/end')
              .map(event => ({ type: event.type, data: event.data }))
            console.log(`child=${String(other.id)} cwd=${String(other.header.cwd)} origin=${String(other.header.origin)} trace=${JSON.stringify(trace).slice(0, 8_000)}`)
          }
        } catch { /* diagnostics only */ }
      }
      expect(settled.data.run.state, settled.data.run.outcome).toBe('succeeded')
      expect(settled.data.node.state).toBe('succeeded')
      expect(settled.data.run.gitResult?.commit).toMatch(/^[0-9a-f]{40,64}$/)
      expect(settled.data.run.gitResult?.branch).toBe(settled.data.run.git?.branch)
      expect(settled.data.run.git?.checkoutKind).toBe('isolated-clone')
      expect(readFileSync(join(settled.data.run.git!.worktreePath, 'worker.txt'), 'utf8')).toBe('worker done\n')
    }
  })
})
