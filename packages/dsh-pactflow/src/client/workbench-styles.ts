/** Scoped layout only; surface, typography and controls inherit the DSH theme. */
export const WORKBENCH_CSS = `
.pf-workbench-panel[role="dialog"]{width:min(1080px,calc(100vw - 48px));height:min(860px,calc(100dvh - 48px));max-height:calc(100dvh - 48px);padding:0;gap:0;color:var(--dsw-alias-label-primary)}
.pf-workbench-panel.pf-workbench-empty{width:min(720px,calc(100vw - 48px));height:auto}
.pf-workbench-frame{display:flex;flex:1;flex-direction:column;min-height:0;max-height:inherit;width:100%;font-size:14px;line-height:1.55}
.pf-workbench-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.pf-workbench-title{margin:0;font-size:17px;font-weight:600;line-height:24px}
.pf-workbench-caption{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:8px;flex-wrap:wrap}
.pf-workbench-scope{display:flex;align-items:center;gap:14px;padding:14px 22px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l2)}
.pf-workbench-select{flex:1;min-width:min(220px,100%);display:grid;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pf-workbench-select select{width:100%;min-height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:13px}
.pf-workbench-tabs{display:flex;gap:4px;flex-wrap:wrap}
.pf-workbench-tabs [aria-selected="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}
.pf-workbench-main{min-height:0;overflow:auto;overscroll-behavior:contain;padding:20px 22px;display:grid;align-content:start;gap:18px;flex:1}
.pf-workbench-blank{padding:30px 6px;display:grid;gap:12px;max-width:540px;margin:auto;width:100%;box-sizing:border-box}
.pf-workbench-blank h3{margin:0;font-size:18px;line-height:1.5}
.pf-workbench-blank p{margin:0;color:var(--dsw-alias-label-secondary)}
.pf-workbench-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pf-workbench-footer{padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.pf-workbench-section{min-width:0;display:grid;gap:12px}
.pf-workbench-section h3{font-size:15px;margin:0}
.pf-workbench-section p{margin:0}
.pf-workbench-muted{color:var(--dsw-alias-label-secondary);font-size:13px}
.pf-workbench-status{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.pf-workbench-error{color:var(--dsw-alias-label-error);padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}
.pf-workbench-raw{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:320px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:12px;color:var(--dsw-alias-label-secondary)}
.pf-workbench-panel details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;padding:8px 0}
@media(max-width:640px){.pf-workbench-panel[role="dialog"],.pf-workbench-panel.pf-workbench-empty{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}.pf-workbench-header{padding:14px 16px}.pf-workbench-scope{padding:12px 16px}.pf-workbench-main{padding:16px}.pf-workbench-tabs{width:100%}.pf-workbench-tabs button{flex:1}.pf-workbench-blank{padding:16px 0}.pf-workbench-footer{padding:10px 12px}}
`
