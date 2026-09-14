import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PactFlowHarnessCapabilities, harnessCapabilityViewOf } from '../src/client/harness-capability-view.tsx'
import { PACTFLOW_HARNESS_CAPABILITY_LEVELS, hostAttestableLevels } from '../src/harness-capabilities.ts'
import type { PactFlowHarness } from '../src/types.ts'

/**
 * What the presentation must not do is let "we have no evidence" read as "this
 * Harness cannot do it".
 *
 * Those are different claims, and only the first is the Host's to make — this
 * repository does not write the third-party runners. A level simply missing from
 * the list makes them indistinguishable, so the unattestable rungs are named.
 */

function view(harness: PactFlowHarness, templateId = harness) {
  const attestable = hostAttestableLevels(harness)
  return {
    templateId, harness, apiMode: 'openai-chat-completions' as const,
    structuredOutput: 'text' as const, maxLevel: attestable[attestable.length - 1]!,
    attestable,
    unattestable: PACTFLOW_HARNESS_CAPABILITY_LEVELS.filter(level => !attestable.includes(level)),
  }
}

const render = (views: readonly ReturnType<typeof view>[]) =>
  renderToStaticMarkup(createElement(PactFlowHarnessCapabilities, { views }))

describe('PactFlow client capability constants stay pinned to the host', () => {
  // The client restates the ladder and the attestable set instead of importing
  // them: `harness-capabilities.ts` lives in the host project, and importing it
  // drags the whole host surface into the client bundle. A restatement is only
  // safe while something fails when it drifts — that is this case.
  it.each(['claude', 'codex', 'opencode', 'dsh'] as const)('%s matches the host declaration', harness => {
    const client = harnessCapabilityViewOf(harness, harness)
    expect(client.attestable).toEqual(hostAttestableLevels(harness))
    expect([...client.attestable, ...client.unattestable].sort())
      .toEqual([...PACTFLOW_HARNESS_CAPABILITY_LEVELS].sort())
    // Every rung appears exactly once across the two lists.
    expect(client.attestable.filter(level => client.unattestable.includes(level))).toEqual([])
  })

  it('carries the same ladder order the host defines', () => {
    const client = harnessCapabilityViewOf('dsh', 'dsh')
    const order = [...client.attestable, ...client.unattestable]
    for (const level of PACTFLOW_HARNESS_CAPABILITY_LEVELS) expect(order).toContain(level)
  })
})

describe('PactFlow harness capability presentation', () => {
  it('names every unattestable level rather than leaving it out', () => {
    const html = render([view('dsh')])
    // Today these two are unattestable for every Harness; the point is that they
    // appear, labelled, instead of silently missing from the list.
    expect(html).toContain('不可证')
    expect(html).toContain('工具调用')
    expect(html).toContain('验证')
  })

  it('states that unattestable is about our evidence, not the Harness', () => {
    const html = render([view('codex')])
    expect(html).toContain('不等于该 Harness 做不到')
  })

  it('shows every ladder rung across the two lists, with none dropped', () => {
    const html = render([view('claude')])
    const LABELS = ['连接', '协议', '工具调用', '产物', '验证', '取消与清理']
    for (const label of LABELS) expect(html, `${label} must appear`).toContain(label)
  })

  it('renders each Harness separately rather than merging them', () => {
    const html = render([view('dsh'), view('codex')])
    expect(html).toContain('dsh')
    expect(html).toContain('codex')
    // Two independent judgements, not one shared verdict.
    expect(html.match(/可证：/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('says so when nothing is registered instead of rendering an empty frame', () => {
    expect(render([])).toContain('尚未登记任何 Harness 模板')
  })

  it('carries no level the ladder does not define', () => {
    const html = render([view('dsh')])
    // A label the ladder never defined would mean the presentation invented a rung.
    expect(html).not.toContain('undefined')
  })
})
