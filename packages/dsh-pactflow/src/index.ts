import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ExternalSessionEventProducerHandle } from '@deepseek-ai/dsh-session'
import type { PactFlowHealth } from './types.ts'

export type { PactFlowHealth } from './types.ts'

const VERSION = '0.1.0'
const EXTERNAL_EVENT_TYPES = ['pactflow/project-initialized'] as const
const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url))

declare module '@deepseek-ai/cordis' {
  interface Context {
    pactflow: PactFlowService
    pactflowPresetRoot: string
  }
}

/** Process-global Host service for the PactFlow product domain. */
export class PactFlowService extends TypertRemoteService {
  static inject = ['sessions']

  private readonly events: ExternalSessionEventProducerHandle<typeof EXTERNAL_EVENT_TYPES>

  constructor(ctx: Context) {
    super(ctx, 'pactflow')
    this.events = ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: VERSION,
      eventTypes: EXTERNAL_EVENT_TYPES,
    })
    ctx.provide('pactflowPresetRoot', PRESET_ROOT)
  }

  /**
   * Prove Host activation, package-root resolution, Typert transport, and P0 registration.
   * @returns non-secret installation health.
   */
  @Remote('health')
  health(): PactFlowHealth {
    return {
      plugin: 'dsh-pactflow',
      version: VERSION,
      mode: 'pactflow',
      presetRoot: PRESET_ROOT,
      externalEventTypes: this.events.declaration.eventTypes,
    }
  }
}

export default PactFlowService
