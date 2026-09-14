import type { CSSProperties } from 'react'
import type { PactFlowCapabilityLevelName, PactFlowHarnessCapabilityView } from '../types.ts'

/**
 * Per-Harness capability levels, with the unattestable ones named rather than
 * left out.
 *
 * Leaving a level out reads as a judgement about the Harness — "it cannot do
 * this" — when what the Host actually knows is narrower: our probes have no
 * evidence for it. For third-party runners, which this repository does not write,
 * those are very different statements, and only one of them is ours to make.
 *
 * So both lists are shown, and the unattestable ones say why they are absent.
 */

/**
 * The ladder and the per-Harness attestable set, restated for the client face.
 *
 * Deliberately NOT imported from `harness-capabilities.ts`: that module sits in
 * the host project, and pulling it in drags the whole host surface into the
 * client bundle. The values are pinned to the host's by a guard test rather than
 * by an import, so a divergence fails the suite instead of shipping quietly.
 */
const LEVELS: readonly PactFlowCapabilityLevelName[] = [
  'connection', 'protocol', 'tool-invocation', 'artifact', 'verification', 'cancellation',
]
const ATTESTABLE: readonly PactFlowCapabilityLevelName[] = [
  'connection', 'protocol', 'artifact', 'cancellation',
]

/** Build one view row from a registered template, without a second round trip. */
export function harnessCapabilityViewOf(
  templateId: string, harness: PactFlowHarnessCapabilityView['harness'],
): PactFlowHarnessCapabilityView {
  return {
    templateId, harness,
    apiMode: harness === 'claude' ? 'anthropic-messages' : harness === 'codex' ? 'openai-responses' : 'openai-chat-completions',
    structuredOutput: harness === 'claude' ? 'native' : 'text',
    maxLevel: ATTESTABLE[ATTESTABLE.length - 1]!,
    attestable: ATTESTABLE,
    unattestable: LEVELS.filter(level => !ATTESTABLE.includes(level)),
  }
}

const LEVEL_LABEL: Readonly<Record<PactFlowCapabilityLevelName, string>> = {
  connection: '连接',
  protocol: '协议',
  'tool-invocation': '工具调用',
  artifact: '产物',
  verification: '验证',
  cancellation: '取消与清理',
}

const rowStyle: CSSProperties = { display: 'grid', gap: 6, padding: '10px 0' }
const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }
const chipStyle: CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12,
  border: '1px solid var(--dsw-alias-border-l2)', marginRight: 6,
}
const attestedChipStyle: CSSProperties = { ...chipStyle, background: 'var(--dsw-alias-bg-layer-2)' }
const unattestedChipStyle: CSSProperties = { ...chipStyle, opacity: 0.7, borderStyle: 'dashed' }

export function PactFlowHarnessCapabilities({ views }: {
  readonly views: readonly PactFlowHarnessCapabilityView[]
}) {
  if (views.length === 0) {
    return <p style={mutedStyle}>尚未登记任何 Harness 模板，因此没有可呈现的能力级别。</p>
  }
  return <div>
    <p style={mutedStyle}>
      能力级别按 Harness 分别判定。「不可证」指本仓探针没有证据可以证明该级别，
      <strong>不等于该 Harness 做不到</strong>——对本仓不编写其 runner 的第三方执行器，这是两回事。
    </p>
    {views.map(view => <div key={view.templateId} style={rowStyle}>
      <div>
        <strong>{view.templateId}</strong>
        <span style={mutedStyle}>　{view.harness}　{view.apiMode}　结构化输出：{view.structuredOutput === 'native' ? '原生' : '文本'}</span>
      </div>
      <div>
        <span style={mutedStyle}>可证：</span>
        {view.attestable.map(level =>
          <span key={level} style={attestedChipStyle}>{LEVEL_LABEL[level]}</span>)}
      </div>
      <div>
        <span style={mutedStyle}>不可证：</span>
        {view.unattestable.length === 0
          ? <span style={mutedStyle}>无</span>
          : view.unattestable.map(level =>
            <span key={level} style={unattestedChipStyle} title="本仓探针没有可以证明该级别的观测证据">
              {LEVEL_LABEL[level]}
            </span>)}
      </div>
      <div style={mutedStyle}>探针可报告的上限：{LEVEL_LABEL[view.maxLevel]}</div>
    </div>)}
  </div>
}
