/** Client-visible proof that the PactFlow Host and external event vocabulary are active. */
export interface PactFlowHealth {
  readonly plugin: 'dsh-pactflow'
  readonly version: string
  readonly mode: 'pactflow'
  readonly presetRoot: string
  readonly externalEventTypes: readonly string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** First durable PactFlow project identity; the complete product adds the remaining families. */
    'pactflow/project-initialized': {
      readonly v: 1
      readonly name: string
    }
  }
}
