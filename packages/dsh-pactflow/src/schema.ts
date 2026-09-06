import { z } from 'zod'
import type { ZodType } from 'zod'
import type { PactFlowId, PactFlowWorkspaceGitBinding, PactFlowProjectWorkerPolicy, PactFlowValidationProfile,
  PactFlowRemoteCreation, PactFlowWorkspaceProjectConfig } from './types.ts'

const nonEmpty = z.string().min(1)
const shellWrappers = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh'])

export const pactFlowValidationProfileSchema = pactFlowSchema<PactFlowValidationProfile>(z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  displayName: z.string().max(256).refine(value => value.trim() !== ''),
  command: z.string().regex(/^[^\s\0\r\n;&|<>$()`]{1,256}$/).refine(
    value => !shellWrappers.has(value.split('/').pop()?.toLowerCase() ?? ''), 'cannot invoke a shell wrapper'),
  args: z.array(z.string().max(4096).regex(/^[^\0\r\n]*$/)).max(64),
  timeoutMs: z.number().int().min(1000).max(3_600_000), revision: z.number().int().positive(),
}))

export const pactFlowValidationProfilesSchema = z.array(pactFlowValidationProfileSchema).max(32)
  .refine(profiles => new Set(profiles.map(profile => profile.id)).size === profiles.length, 'duplicate PactFlow validation profile')

export const pactFlowWorkspaceGitSchema = pactFlowSchema<PactFlowWorkspaceGitBinding>(z.object({
  remote: nonEmpty, remoteUrl: nonEmpty, defaultBranch: nonEmpty,
  boundAt: z.number().int().nonnegative(), k3sGitSecretName: nonEmpty.optional(),
  giteaProviderId: nonEmpty.optional(), owner: nonEmpty.optional(), repo: nonEmpty.optional(),
}))

export const pactFlowProjectWorkerPolicySchema = pactFlowSchema<PactFlowProjectWorkerPolicy>(z.object({
  clusterId: nonEmpty, workerPoolId: nonEmpty, maxConcurrency: z.number().int().positive(),
  agentProfiles: z.array(z.object({
    id: nonEmpty, displayName: z.string().refine(value => value.trim() !== ''),
    templateId: nonEmpty, modelConnectionId: nonEmpty, maxConcurrency: z.number().int().positive(),
  })).min(1),
}).refine(policy => new Set(policy.agentProfiles.map(profile => profile.id)).size === policy.agentProfiles.length
  && policy.maxConcurrency === policy.agentProfiles.reduce((sum, profile) => sum + profile.maxConcurrency, 0)))

/** Durable identity of one user-requested remote creation operation. */
export const pactFlowRemoteCreationSchema = pactFlowSchema<PactFlowRemoteCreation>(z.object({
  id: z.string().uuid(), state: z.enum(['creating', 'created', 'completed']),
  providerId: nonEmpty, providerSnapshot: nonEmpty,
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  defaultBranch: nonEmpty, private: z.boolean(), expectedCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
  cloneUrl: nonEmpty.optional(),
}).refine(value => value.state === 'creating' ? value.cloneUrl === undefined : value.cloneUrl !== undefined))

export const pactFlowWorkspaceProjectSchema = pactFlowSchema<PactFlowWorkspaceProjectConfig>(z.object({
  schema: z.literal('dsh_pactflow_workspace_project/v1'),
  workspaceId: z.string(), workspacePath: z.string(), workspaceTitle: z.string(),
  revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  git: pactFlowWorkspaceGitSchema.optional(), worker: pactFlowProjectWorkerPolicySchema.optional(),
  remoteCreation: pactFlowRemoteCreationSchema.optional(), validationProfiles: pactFlowValidationProfilesSchema.optional(),
  validationProfileIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).optional(),
  // Legacy command data remains readable; this schema never grants execution authority.
  validationCommands: z.array(z.object({ command: z.string(), args: z.array(z.string()), timeoutMs: z.number() })).optional(),
}).refine(config => config.validationProfileIds?.every(id => config.validationProfiles?.some(profile => profile.id === id) === true) ?? true))

/** Shared wire envelope used by every PactFlow Session Event. */
export const pactFlowVersionedPayloadSchema = z.object({ v: z.literal(1) })

type ParsedOptionalProperties<T> = {
  [Key in keyof T]: T[Key] | ({} extends Pick<T, Key> ? undefined : never)
}

/** Check the entire shape, then omit Zod's explicit undefined optional properties. */
export function pactFlowSchema<T extends object>(schema: ZodType<ParsedOptionalProperties<T>>): ZodType<T> {
  return schema.transform(value => {
    // The input shape is checked above. Removing undefined optional properties
    // satisfies exactOptionalPropertyTypes without asserting an arbitrary schema.
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
  })
}

/** Historical ids remain readable; new-id restrictions are enforced at creation. */
export function pactFlowIdSchema<Kind extends string>(): ZodType<PactFlowId<Kind>> {
  return z.custom<PactFlowId<Kind>>(value => typeof value === 'string' && value.length > 0)
}

export function parsePactFlowVersionedPayload(value: unknown, eventType: string): void {
  const parsed = pactFlowVersionedPayloadSchema.safeParse(value)
  if (!parsed.success) throw new Error(`invalid ${eventType} payload version: ${parsed.error.message}`)
}
