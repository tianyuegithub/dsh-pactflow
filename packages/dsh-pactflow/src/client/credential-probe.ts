import type { PactFlowInfrastructureSettings } from '../types.ts'

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
  }
}
