import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../k3s-worker.ts'
import { PactFlowInfrastructure } from '../infrastructure.ts'
import type { PactFlowInfrastructureSettings } from '../types.ts'

/** Build the restart-applied legacy K3s provider from validated non-secret settings. */
export function k3sFromImpl(config: false | PactFlowK3sConfig | undefined): PactFlowK3sWorker | undefined {
  return config === undefined || config === false ? undefined : new PactFlowK3sWorker(config)
}

/** Build the resource-based infrastructure view from validated non-secret settings. */
export function infrastructureFromImpl(
  config: false | PactFlowInfrastructureSettings | undefined,
): PactFlowInfrastructure | undefined {
  return config === undefined || config === false ? undefined : new PactFlowInfrastructure(config)
}

/** Rebuild one Worker per configured execution pool; legacy settings own no pools. */
export function rebuildPoolWorkersImpl(
  infrastructure: PactFlowInfrastructure | undefined,
  k3sByPool: Map<string, PactFlowK3sWorker>,
): void {
  k3sByPool.clear()
  if (infrastructure === undefined) return
  for (const pool of infrastructure.settings.workerPools) {
    const resolved = infrastructure.resolve(pool.id, pool.templateIds[0]!)
    k3sByPool.set(pool.id, new PactFlowK3sWorker(resolved.k3s))
  }
}
