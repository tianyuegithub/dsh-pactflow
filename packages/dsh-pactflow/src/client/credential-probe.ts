import type { PactFlowInfrastructureSettings } from '../types.ts'

export interface TemporaryCredentialReleaseResult {
  readonly released: readonly string[]
  readonly failed: readonly string[]
}

export function temporaryCredentialRef(reference: string, nonce: string): string {
  const suffix = nonce.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24)
  if (suffix.length === 0) throw new Error('temporary Credential nonce must contain letters or numbers')
  return `${reference}_PROBE_${suffix}`
}

export function replaceInfrastructureCredentialRefs(
  settings: PactFlowInfrastructureSettings,
  replacements: ReadonlyMap<string, string>,
): PactFlowInfrastructureSettings {
  const replace = (reference: string | undefined): string | undefined =>
    reference === undefined ? undefined : replacements.get(reference) ?? reference
  return {
    ...settings,
    registries: settings.registries.map(registry => ({
      ...registry,
      ...(registry.usernameCredentialRef === undefined
        ? {}
        : { usernameCredentialRef: replace(registry.usernameCredentialRef)! }),
      ...(registry.passwordCredentialRef === undefined
        ? {}
        : { passwordCredentialRef: replace(registry.passwordCredentialRef)! }),
    })),
    gitProviders: settings.gitProviders.map(provider => ({
      ...provider, tokenCredentialRef: replace(provider.tokenCredentialRef)!,
    })),
    ...(settings.modelConnections === undefined ? {} : {
      modelConnections: settings.modelConnections.map(model => ({
        ...model, apiKeyCredentialRef: replace(model.apiKeyCredentialRef)!,
      })),
    }),
    ...(settings.artifactStores === undefined ? {} : {
      artifactStores: settings.artifactStores.map(store => ({
        ...store,
        accessKeyCredentialRef: replace(store.accessKeyCredentialRef)!,
        secretKeyCredentialRef: replace(store.secretKeyCredentialRef)!,
      })),
    }),
  }
}

export async function releaseTemporaryCredentialRefs(
  references: Map<string, string>,
  unset: (temporaryReference: string) => Promise<void>,
  requestedReferences: readonly string[] = [...references.keys()],
): Promise<TemporaryCredentialReleaseResult> {
  const outcomes = await Promise.all([...new Set(requestedReferences)].map(async (reference) => {
    const temporaryReference = references.get(reference)
    if (temporaryReference === undefined) return { reference, state: 'absent' as const }
    try {
      await unset(temporaryReference)
      if (references.get(reference) !== temporaryReference) return { reference, state: 'failed' as const }
      references.delete(reference)
      return { reference, state: 'released' as const }
    } catch {
      return { reference, state: 'failed' as const }
    }
  }))
  return {
    released: outcomes.filter(outcome => outcome.state === 'released').map(outcome => outcome.reference),
    failed: outcomes.filter(outcome => outcome.state === 'failed').map(outcome => outcome.reference),
  }
}
