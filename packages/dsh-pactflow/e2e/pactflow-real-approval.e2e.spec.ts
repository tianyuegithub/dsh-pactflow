import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold,
  type WebScaffold,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/scaffold.ts'
import {
  connectFreshWorkspace,
  newEnglishPage,
  saveFailureShot,
  writeComposerDraft,
} from '../../../../deepseek-harness-pactflow-p0/apps/web/tests/support.ts'

// Real human approval in the native DSH UI (B-class acceptance, runbook §9.1).
//
// The product contract this proves is that NO automatic approval path exists:
// `pactflow_record_review` performs no write until the official DSH Approval
// waterfall returns `allowed-once`, and that outcome only ever comes from a
// person answering the real composer takeover. The test therefore drives the
// real Web composition to the real panel and answers it there; it never calls
// `recordReview` directly, and the mid-flight assertion pins that the durable
// review record does not exist while the panel is still waiting.
//
// The model is real (record mode, the same credential lane as the real Worker
// suite): a fixture would pin what the model *said*, but this acceptance exists
// to watch a live turn block on a live human gate. The negative authorization
// paths (rejected/cancelled/unavailable, missing service, credential-like note,
// stale revision while pending) are deterministic unit contracts in
// `tests/review-authorization.spec.ts` and are not duplicated here.

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const enabled = process.env.DSH_REAL_APPROVAL === '1' && process.env.DSH_SNAPSHOT === 'record'

const NEED_ID = 'approval-gate'

/** A minimal reader for the durable log; the approval events carry no local type augmentation. */
interface LooseEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

function eventsOf(session: { readonly events: readonly unknown[] }): readonly LooseEvent[] {
  return session.events as unknown as readonly LooseEvent[]
}

/** Publish a resolvable `dsh-pactflow` install anchor; the scaffold profile imports the package by name. */
async function localBundleAnchor(): Promise<{ readonly directory: string; readonly anchorPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-pactflow-approval-patch-'))
  const modules = join(directory, 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(PACKAGE_ROOT, join(modules, 'dsh-pactflow'), 'dir')
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  const anchorPath = join(directory, 'package.json')
  await writeFile(anchorPath, JSON.stringify({
    name: 'dsh-pactflow-approval-e2e-anchor', private: true,
    dependencies: { 'dsh-pactflow': `file:${PACKAGE_ROOT}` },
  }))
  return { directory, anchorPath }
}

/** The session the composer bound to the PactFlow preset. */
async function livePactFlowSession(scaffold: WebScaffold): Promise<string | undefined> {
  const response = await scaffold.hostFetch('/api/session/list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'pactflow-real-approval-preset', method: 'session/list',
      payload: { args: { _request: {} } },
    }),
  })
  const body = await response.json() as {
    result?: { value?: { items?: { sessionId: string; projections?: { values?: { agentPreset?: string } } }[] } }
  }
  return body.result?.value?.items?.find(item =>
    item.projections?.values?.agentPreset === 'pactflow')?.sessionId
}

describe.skipIf(!enabled)('PactFlow real human approval in the native DSH UI', { timeout: 300_000 }, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
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
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 15_000 })
    await menu.getByRole('menuitem', { name: /PactFlow|零脉/ }).click()
    await page.getByRole('button', { name: '零脉模式' }).waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    await browser?.close()
    if (process.env.PACTFLOW_KEEP_ROOT === '1') {
      console.log(`[keep-root] ${scaffold?.workspaceCwd ?? '(none)'}`)
      return
    }
    await scaffold?.close()
    if (bundleAnchor !== undefined) await rm(bundleAnchor.directory, { recursive: true, force: true })
  })

  it('blocks the review on the real panel, records the approved decision, and advances the gate', async () => {
    onTestFailed(() => saveFailureShot(page, 'real-approval'))
    await expect.poll(() => livePactFlowSession(scaffold), { timeout: 15_000 }).not.toBeUndefined()
    const sessionId = await livePactFlowSession(scaffold) as string
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, [
      'Use only PactFlow tools. Do not use bash, write, or edit. Perform these steps strictly in order, then stop.',
      '1. Call pactflow_view. If no project exists, call pactflow_initialize with name Approval Gate E2E.',
      `2. Call pactflow_create_need with id ${NEED_ID}, title Approval Gate, description real human approval acceptance.`,
      `3. Call pactflow_transition_need moving need ${NEED_ID} to discussion using its exact current revision.`,
      `4. Call pactflow_record_review for need ${NEED_ID} with kind requirement, decision approved, and note requirement review of the approval gate end to end evidence.`,
      'The review must carry the exact current revision from the previous tool result.',
      'This call is gated by a human approval dialog: wait for the human decision and never retry it on your own.',
      `5. After the review succeeds, call pactflow_transition_need moving need ${NEED_ID} to confirmed with the new current revision.`,
      '6. Reply with one short line stating the final phase, then stop.',
    ].join(' '))

    const settled = scaffold.whenTurnSettled(240_000)
    await composer.press('Enter')

    const panel = page.locator('[data-approval-key]')
    await panel.waitFor({ timeout: 240_000 })

    // The gate is real: the panel is on screen and the decision is still open.
    // Until a person answers, the durable log holds the question but neither the
    // answer nor any review record — there is no automatic approval path.
    const pendingSession = scaffold.ctx.sessions.get(sessionId)
    expect(pendingSession).toBeDefined()
    const pending = eventsOf(pendingSession!)
    const asked = pending.filter(event => event.type === 'approval/asked'
      && event.data.toolName === 'pactflow_record_review')
    expect(asked).toHaveLength(1)
    expect(pending.filter(event => event.type === 'approval/decided')).toHaveLength(0)
    expect(pending.filter(event => event.type === 'pactflow/review-recorded')).toHaveLength(0)

    // The panel mirrors the exact request: the need id and the evidence digest
    // the tool computed must both be visible before the human decides, so
    // "approve A, record B" is impossible.
    const askedReason = String(asked[0]!.data.reason ?? '')
    const askedDigest = /([0-9a-f]{64})/.exec(askedReason)?.[1]
    expect(askedDigest).toBeDefined()
    expect(askedReason).toContain(NEED_ID)
    const panelText = (await panel.textContent()) ?? ''
    expect(panelText).toContain(NEED_ID)
    expect(panelText).toContain(askedDigest!)

    // The human decision. This click is the only grant in the system; the test
    // stands in for the approver here and nowhere else.
    await panel.getByRole('button', { name: 'Allow once' }).click()
    await settled

    const resolved = eventsOf(scaffold.ctx.sessions.get(sessionId)!)
    const askedFinal = resolved.filter(event => event.type === 'approval/asked'
      && event.data.toolName === 'pactflow_record_review')
    const decided = resolved.filter(event => event.type === 'approval/decided')
    const recorded = resolved.filter(event => event.type === 'pactflow/review-recorded')
    expect(askedFinal).toHaveLength(1)
    expect(decided).toHaveLength(1)
    expect(recorded).toHaveLength(1)

    const approvalRequestId = String(askedFinal[0]!.data.id)
    expect(String(decided[0]!.data.id)).toBe(approvalRequestId)
    expect(decided[0]!.data.outcome).toBe('allowed-once')

    const review = recorded[0]!.data.review as Record<string, unknown>
    expect(review.source).toBe('dsh-approval')
    expect(review.approvalRequestId).toBe(approvalRequestId)
    expect(review.evidenceDigest).toBe(askedDigest)
    expect(review.needId).toBe(NEED_ID)
    expect(review.needRevision).toBe(2)
    expect(review.kind).toBe('requirement')
    expect(review.decision).toBe('approved')

    // The gate actually advanced on the recorded approval, in order.
    const transitions = resolved.filter(event => event.type === 'pactflow/phase-transitioned'
      && (event.data.need as { phase?: string } | undefined)?.phase === 'confirmed')
    expect(transitions).toHaveLength(1)
    expect(resolved.indexOf(recorded[0]!)).toBeLessThan(resolved.indexOf(transitions[0]!))
    expect(transitions[0]!.data.from).toBe('discussion')

    expect(await page.locator('[data-approval-key]').count()).toBe(0)
  })

  it('answers a progress-only question without creating work or asking execution approval', async () => {
    const sessionId = await livePactFlowSession(scaffold) as string
    const before = scaffold.ctx.sessions.get(sessionId)!.events.length
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, '看一下当前需求的完成进度如何？请依据已有记录简短回答。')
    const settled = scaffold.whenTurnSettled(120_000)
    await composer.press('Enter'); await settled
    const fresh = eventsOf(scaffold.ctx.sessions.get(sessionId)!).slice(before)
    expect(fresh.some(event => ['pactflow/project-initialized', 'pactflow/need-created', 'pactflow/node-created', 'pactflow/run-queued', 'pactflow/run-claimed', 'approval/asked'].includes(event.type))).toBe(false)
    expect(await page.locator('[data-question-key]').count()).toBe(0)
  })

  it('recommends a complete delivery node and waits for native choice before recording the plan', async () => {
    const sessionId = await livePactFlowSession(scaffold) as string
    await writeFile(join(scaffold.workspaceCwd, 'demo-button.ts'), "export const label = '保寸'\n")
    const before = scaffold.ctx.sessions.get(sessionId)!.events.length
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await writeComposerDraft(page, composer, [
      '新需求：把 demo-button.ts 的按钮文案错字“保寸”修正为“保存”，补相应测试，并更新简短说明。',
      '这次范围已明确，请提供可供我选择确认的具体执行方案；执行规格使用 pactflow_view 返回的可用项。',
      '本轮只做到我提交方案选择后就停止，不实际派发，也不要触发其它需求/设计审批。',
    ].join(' '))
    const settled = scaffold.whenTurnSettled(180_000)
    await composer.press('Enter')
    const question = page.locator('[data-question-key]')
    await question.waitFor({ timeout: 120_000 })
    const pending = eventsOf(scaffold.ctx.sessions.get(sessionId)!).slice(before)
    expect(pending.some(event => event.type === 'pactflow/node-created')).toBe(false)
    expect(pending.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(pending.filter(event => event.type === 'approval/decided')).toHaveLength(0)
    expect(await page.locator('[data-approval-key]').count()).toBe(0)
    await question.getByRole('radio', { name: /^批准单节点方案/ }).click()
    await question.getByRole('button', { name: 'Submit', exact: true }).click()
    await settled
    const fresh = eventsOf(scaffold.ctx.sessions.get(sessionId)!).slice(before)
    const reviews = fresh.filter(event => event.type === 'pactflow/review-recorded')
    expect(reviews).toHaveLength(1)
    const review = reviews[0]!.data.review as { executionPlan?: { plan: { mode: string; nodes: unknown[] } } }
    expect(review.executionPlan?.plan.mode).toBe('single')
    expect(review.executionPlan?.plan.nodes).toHaveLength(1)
    expect(fresh.filter(event => event.type === 'pactflow/node-created')).toHaveLength(1)
    expect(fresh.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(fresh.some(event => event.type === 'pactflow/run-claimed')).toBe(false)
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    expect(await page.locator('[data-approval-key]').count()).toBe(0)
  })
})
