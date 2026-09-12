import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import pactflowRemote from 'dsh-pactflow/remote'
import { NS, zh, en } from './locale.ts'
import { PactFlowHeaderAction, PactFlowOverlay, type OverlayInjected } from './overlay.tsx'
import { PactFlowProjectPanel, type PactFlowProjectPanelFace } from './project-panel.tsx'
import { PactFlowSettingsCard } from './settings.tsx'
import { isHarnessProfile } from './resource-model.ts'
import type { PactFlowSettingsView, PactFlowInfrastructureSettings, PactFlowInfrastructureResourceKind, PactFlowModelConnectionSettings } from '../types.ts'

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

export const inject = [
  'remote', 'remote.credentials', 'remote.directoryPicker', 'sessions', 'slots', 'locale', 'settingsScope',
]

/** Mount the generated PactFlow Remote contribution and native DSH UI surfaces. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(pactflowRemote)
  const pactflow = ctx.get('remote.pactflow')
  if (pactflow === undefined) {
    await disposeRemote()
    throw new Error('PactFlow Remote contribution mounted without its namespace service')
  }
  const directoryPicker = ctx.remote.directoryPicker as typeof ctx.remote.directoryPicker & {
    pickFile(signal?: AbortSignal): Promise<RemoteResult<string | null>>
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pactflow: locale dictionaries')
  const settings = ctx.settingsScope.bind<PactFlowSettingsView>({
    namespace: NS,
    decode: (section) => {
      if (typeof section !== 'object' || section === null) return undefined
      const value = section as Partial<PactFlowSettingsView>
      return { k3s: value.k3s ?? false, infrastructure: value.infrastructure ?? false }
    },
  })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => ({
      settings,
      t: ctx.locale.bind(NS),
      probeInfrastructure: async (
        kind: PactFlowInfrastructureResourceKind,
        id: string,
        draft?: PactFlowInfrastructureSettings,
      ) => {
        const result = await pactflow.probeInfrastructure({ kind, id, ...(draft === undefined ? {} : { draft }) })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listInfrastructureHealth: async () => {
        const result = await pactflow.listInfrastructureHealth()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      pickHostFile: async () => {
        const result = await directoryPicker.pickFile()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      inspectKubeconfig: async (path: string) => {
        const result = await pactflow.inspectKubeconfig(path)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listImagePullSecrets: async (clusterId: string, draft: PactFlowInfrastructureSettings) => {
        const result = await pactflow.listImagePullSecrets(clusterId, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listHarborArtifacts: async (registryId: string, draft: PactFlowInfrastructureSettings) => {
        const result = await pactflow.listHarborArtifacts(registryId, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      discoverModels: async (model: PactFlowModelConnectionSettings, apiKey: string) => {
        if (apiKey.trim() !== '') {
          const stored = await ctx.remote.credentials.set(model.apiKeyCredentialRef, apiKey)
          if (!stored.ok) throw new Error(stored.error.message)
        }
        const result = await pactflow.discoverModels(model)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      setCredential: async (ref: string, value: string) => {
        const result = await ctx.remote.credentials.set(ref, value)
        if (!result.ok) throw new Error(result.error.message)
      },
      unsetCredential: async (ref: string) => {
        const result = await ctx.remote.credentials.unset(ref)
        if (!result.ok) throw new Error(result.error.message)
      },
      deletionImpact: async (
        kind: PactFlowInfrastructureResourceKind, id: string, draft: PactFlowInfrastructureSettings,
      ) => {
        const result = await pactflow.infrastructureDeletionImpact(kind, id, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowSettingsCard))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'pactflow',
    order: 30,
    locale: NS,
  }, PactFlowHeaderAction))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'pactflow-projects',
    inject: (): PactFlowProjectPanelFace => ({
      list: async () => {
        const result = await pactflow.listWorkspaceProjects()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      catalogs: async () => {
        const [clusters, pools, templates, models, providers] = await Promise.all([
          pactflow.listK3sClusters(),
          pactflow.listWorkerPools(), pactflow.listK3sTemplates(),
          pactflow.listModelConnections(), pactflow.listGiteaProviders(),
        ])
        for (const result of [clusters, pools, templates, models, providers]) {
          if (!result.ok) throw new Error(result.error.message)
        }
        return {
          clusters: clusters.value,
          pools: pools.value,
          templates: templates.value.filter(isHarnessProfile),
          models: models.value,
          giteaProviders: providers.value.map((provider: { readonly id: string; readonly displayName: string; readonly username?: string }) => ({
            id: provider.id, name: provider.displayName,
            ...(provider.username === undefined ? {} : { username: provider.username }),
          })),
        }
      },
      initializeGit: async (workspaceId, expectedPath) => {
        const result = await pactflow.initializeWorkspaceGit({
          workspaceId, expectedPath, confirm: 'initialize-local-git',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      adoptGit: async (workspaceId, expectedRevision) => {
        const result = await pactflow.adoptWorkspaceGit({ workspaceId, expectedRevision })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      gitSecrets: async clusterId => {
        const result = await pactflow.listK3sGitSecrets(clusterId)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      saveWorker: async (workspaceId, expectedRevision, k3sGitSecretName, worker) => {
        const result = await pactflow.saveWorkspaceWorkerPolicy({
          workspaceId, expectedRevision, k3sGitSecretName, worker,
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      saveValidation: async (workspaceId, expectedRevision, profiles, selectedIds) => {
        const result = await pactflow.saveValidationProfiles({ workspaceId, expectedRevision,
          ...(profiles === undefined ? {} : { profiles }), selectedProfileIds: selectedIds })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      savePolicy: async (workspaceId, expectedRevision, groups) => {
        const result = await pactflow.saveValidationPolicy({ workspaceId, expectedRevision, groups })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      saveHostBaseline: async (workspaceId, expectedRevision, commands) => {
        const result = await pactflow.saveHostBaseline({ workspaceId, expectedRevision, commands })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      createRemote: async request => {
        const result = await pactflow.createWorkspaceRemote({
          ...request, confirm: 'create-gitea-repository',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      remoteCandidates: async workspaceId => {
        const result = await pactflow.listWorkspaceRemoteCandidates(workspaceId)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      confirmRemote: async request => {
        const result = await pactflow.confirmWorkspaceRemoteCandidate(request)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      migrate: async (workspaceId, sessionId, expectedRevision) => {
        const result = await pactflow.migrateWorkspaceProject({
          workspaceId, sessionId, expectedRevision, confirm: 'migrate-session-project',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowProjectPanel))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pactflow',
    order: 30,
    locale: NS,
    inject: (): OverlayInjected => ({
      load: async (sessionId, signal) => {
        const [health, snapshot, templates, modelConnections, workerPools, workspaceProject, retention] = await Promise.all([
          pactflow.health(signal),
          pactflow.snapshot(sessionId, signal),
          pactflow.listK3sTemplates(signal),
          pactflow.listModelConnections(signal),
          pactflow.listWorkerPools(signal),
          pactflow.workspaceProjectForSession(sessionId, signal),
          pactflow.retentionStatus(sessionId),
        ])
        if (!health.ok) throw new Error(health.error.message)
        if (!snapshot.ok) throw new Error(snapshot.error.message)
        if (!templates.ok) throw new Error(templates.error.message)
        if (!modelConnections.ok) throw new Error(modelConnections.error.message)
        if (!workerPools.ok) throw new Error(workerPools.error.message)
        // A persisted session remains inspectable after cold restore. The
        // project mapping is live-session-only, so absence is distinct from a
        // failed snapshot and is rendered as the existing empty state.
        if (!workspaceProject.ok && !workspaceProject.error.message.includes('is not live')) {
          throw new Error(workspaceProject.error.message)
        }
        return {
          health: health.value, snapshot: snapshot.value,
          templates: templates.value, modelConnections: modelConnections.value, workerPools: workerPools.value,
          workspaceProject: workspaceProject.ok ? workspaceProject.value : null,
          retention: retention.ok ? retention.value : null,
        }
      },
      loadRuntime: async (sessionId, signal) => {
        const [workerPools, workspaceProject, retention] = await Promise.all([
          pactflow.listWorkerPools(signal),
          pactflow.workspaceProjectForSession(sessionId, signal),
          pactflow.retentionStatus(sessionId),
        ])
        if (!workerPools.ok) throw new Error(workerPools.error.message)
        if (!workspaceProject.ok && !workspaceProject.error.message.includes('is not live')) {
          throw new Error(workspaceProject.error.message)
        }
        return {
          workerPools: workerPools.value,
          workspaceProject: workspaceProject.ok ? workspaceProject.value : null,
          retention: retention.ok ? retention.value : null,
        }
      },
      probeHarnessImage: async (templateId, signal) => {
        const result = await pactflow.probeInfrastructure({ kind: 'harness', id: templateId }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      probeApi: async (templateId, modelConnectionId, prompt, timeoutMs, signal) => {
        const result = await pactflow.probeApi({ templateId, modelConnectionId, prompt, timeoutMs }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      verifyGitea: async (sessionId, signal) => {
        const result = await pactflow.verifyGitea(sessionId, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      exportHandover: async (sessionId, signal) => {
        const result = await pactflow.projectHandover(sessionId, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowOverlay))
  return disposeRemote
}
