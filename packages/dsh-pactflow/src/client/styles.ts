import type { CSSProperties } from 'react'

export const buttonStyle: CSSProperties = {
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
  cursor: 'pointer',
  padding: '6px 10px',
}

export const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--dsw-alias-bg-mask-1)',
  pointerEvents: 'auto',
}

export const panelStyle: CSSProperties = {
  width: 'min(920px, calc(100vw - 48px))',
  minHeight: 420,
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.45)',
}

export const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '24px 28px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  flex: '0 0 auto',
}

export const titleStyle: CSSProperties = { margin: 0, fontSize: 28 }
export const subtitleStyle: CSSProperties = { margin: '6px 0 0', opacity: 0.72 }
export const bodyStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: 28, overflowY: 'auto', overflowX: 'hidden',
}
export const preStyle: CSSProperties = { padding: 16, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1)' }
export const diagnosticStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 12, marginBottom: 16,
}
export const errorStyle: CSSProperties = { ...preStyle, color: 'var(--dsw-alias-label-error)' }
export const probeStyle: CSSProperties = { ...preStyle, maxHeight: 320, whiteSpace: 'pre-wrap' }
export const settingsCardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 20,
  display: 'grid', gap: 12, minWidth: 0, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box',
}
export const hintStyle: CSSProperties = { opacity: 0.72, margin: 0 }
export const settingsEditorStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 280,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: 12,
}
export const resourceSectionStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden',
}
export const resourceHeaderStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16,
}
export const resourceHeadingCopyStyle: CSSProperties = { display: 'grid', gap: 4, minWidth: 0 }
export const resourceTitleStyle: CSSProperties = { margin: 0, fontSize: 16 }
export const resourceDescriptionStyle: CSSProperties = {
  margin: 0, fontSize: 13, opacity: 0.62, lineHeight: 1.55, overflowWrap: 'anywhere',
}
export const resourceListStyle: CSSProperties = { display: 'grid', gap: 12, minWidth: 0 }
export const resourceCardStyle: CSSProperties = {
  display: 'grid', gap: 16, padding: 16, minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}
export const resourceCardHeadingStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  minWidth: 0, overflowWrap: 'anywhere',
}
export const resourceIndexStyle: CSSProperties = { opacity: 0.55, fontSize: 12, flex: '0 0 auto' }
export const healthStatusButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'none',
  color: 'var(--dsw-alias-label-secondary)', padding: 0, cursor: 'pointer', fontSize: 12,
}
export const healthDotStyle: CSSProperties = { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' }
export const healthDotColors: Record<'untested' | 'running' | 'succeeded' | 'failed', CSSProperties> = {
  untested: { background: '#8a8f98', boxShadow: '0 0 0 3px rgba(138,143,152,.14)' },
  running: { background: '#e9b949', boxShadow: '0 0 10px rgba(233,185,73,.9)' },
  succeeded: { background: '#35c878', boxShadow: '0 0 10px rgba(53,200,120,.9)' },
  failed: { background: '#ef5f67', boxShadow: '0 0 10px rgba(239,95,103,.9)' },
}
export const resourceFieldsStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
  gap: '16px 18px', minWidth: 0,
}
export const resourceFieldStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0 }
export const resourceFieldLabelStyle: CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
}
export const fieldHintStyle: CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)',
}
export const resourceCardActionsStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8,
}
export const resourceSummaryStyle: CSSProperties = { minWidth: 0 }
export const summaryGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12, margin: 0,
}
export const summaryItemStyle: CSSProperties = { display: 'grid', gap: 3, minWidth: 0 }
export const summaryLabelStyle: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
export const summaryValueStyle: CSSProperties = {
  margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
}
export const testLogStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12, display: 'grid', gap: 8,
}
export const testLogHeaderStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
}
export const testLogBodyStyle: CSSProperties = {
  maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6, padding: 10,
  borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
}
export const testLogLineStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '64px minmax(90px, auto) 1fr', gap: 8,
  color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere',
}
export const testLogFailedStyle: CSSProperties = { ...testLogLineStyle, color: 'var(--dsw-alias-label-error)' }
export const testLogStateStyle: CSSProperties = { whiteSpace: 'nowrap', fontWeight: 600 }
export const testLogDetailStyle: CSSProperties = { color: 'inherit', opacity: 0.82 }
export const inputStyle: CSSProperties = {
  minWidth: 0, width: '100%', minHeight: 34, boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 13, padding: '6px 12px',
}
export const readOnlyInputStyle: CSSProperties = {
  ...inputStyle, color: 'var(--dsw-alias-label-secondary)', flex: '1 1 260px',
}
export const secondaryButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'none',
  color: 'var(--dsw-alias-label-secondary)', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
}
export const filePickerStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
export const choiceGridStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
export const choiceStyle: CSSProperties = {
  ...secondaryButtonStyle, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-3)',
}
export const selectedChoiceStyle: CSSProperties = {
  ...choiceStyle, color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-label-primary)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-label-primary)',
}
export const disabledChoiceStyle: CSSProperties = {
  ...choiceStyle, opacity: 0.48, cursor: 'not-allowed', textDecoration: 'none',
}
export const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle, color: 'var(--dsw-alias-label-error)', whiteSpace: 'nowrap',
}
export const dangerPrimaryButtonStyle: CSSProperties = {
  ...buttonStyle, background: 'var(--dsw-alias-label-error)', color: 'var(--dsw-alias-bg-layer-3)',
}
export const noticeStyle: CSSProperties = {
  margin: 0, padding: 10, borderRadius: 8, background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)', fontSize: 13,
}
export const confirmBackdropStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 500, display: 'grid', placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.38)', padding: 24,
}
export const confirmDialogStyle: CSSProperties = {
  width: 'min(460px, 100%)', display: 'grid', gap: 14, padding: 20,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
}
export const confirmTitleStyle: CSSProperties = { margin: 0, fontSize: 17 }
export const confirmActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
export const errorTextStyle: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-error)' }
export const probeActionsStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0,
}
export const disabledProbeButtonStyle: CSSProperties = { ...buttonStyle, cursor: 'not-allowed', opacity: 0.45 }
export const probeReasonStyle: CSSProperties = {
  flex: '1 0 100%', fontSize: 12, lineHeight: 1.45, color: '#e9b949', overflowWrap: 'anywhere',
}
export const gridStyle: CSSProperties = {
  width: '100%', minWidth: 0, display: 'grid', gap: 16, marginTop: 20, overflow: 'hidden',
}
export const cardStyle: CSSProperties = {
  minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', overflowWrap: 'anywhere',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 16,
}
export const sectionTitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 16 }
export const tableStyle: CSSProperties = { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }
export const cellStyle: CSSProperties = {
  padding: '8px 10px', borderTop: '1px solid #263d39', textAlign: 'left', verticalAlign: 'top',
  whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word',
}
