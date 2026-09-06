import { healthStatusButtonStyle, healthDotStyle, healthDotColors, testLogStyle, testLogHeaderStyle, testLogBodyStyle, testLogLineStyle, testLogFailedStyle, testLogStateStyle, testLogDetailStyle } from './styles.ts'
import type { InfrastructureTestLog } from './settings-contract.ts'

export function HealthStatus({ log, onClick }: { readonly log: InfrastructureTestLog | undefined; readonly onClick: () => void }) {
  const stale = log?.testedAt !== undefined && Date.now() - Date.parse(log.testedAt) > 300_000
  const state = log === undefined ? 'untested' : log.running ? 'running' : log.success === true ? 'succeeded' : 'failed'
  const label = state === 'untested' ? '未测试'
    : state === 'running' ? '测试中'
      : `${state === 'succeeded' ? '联通' : '失败'}${stale ? ' · 已过期' : ''}`
  return <button type="button" onClick={onClick} style={healthStatusButtonStyle} aria-label={`可用性状态：${label}`}>
    <span style={{ ...healthDotStyle, ...healthDotColors[state] }} />
    <span>{label}</span>
  </button>
}

export function InfrastructureTestLogView({ log }: { readonly log: InfrastructureTestLog }) {
  return <section aria-label="测试日志" style={testLogStyle}>
    <div style={testLogHeaderStyle}>
      <strong>测试日志</strong>
      <span>{log.running ? '进行中' : log.success === true ? '成功' : '失败'}
        {log.durationMs === undefined ? '' : ` · ${(log.durationMs / 1_000).toFixed(1)}s`}</span>
    </div>
    <div style={testLogBodyStyle}>{log.entries.map((entry, index) => <div
      key={`${entry.name}-${String(index)}`}
      style={entry.state === 'failed' ? testLogFailedStyle : testLogLineStyle}
    >
      <span style={testLogStateStyle}>[{entry.state === 'running' ? '进行中' : entry.state === 'succeeded' ? '成功' : '失败'}]</span>
      <span>{entry.name}</span>
      <span style={testLogDetailStyle}>{entry.detail}</span>
    </div>)}</div>
  </section>
}
