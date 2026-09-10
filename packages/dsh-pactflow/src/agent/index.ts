import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type {} from '../index.ts'
import { pactFlowReviewEvidenceDigest, pactFlowReviewNote } from '../review-authorization.ts'

export const name = 'pactflow-agent-tools'
export const inject = ['tools', 'pactflow']

const OPEN_OBJECT = { type: 'object', additionalProperties: true } as const
const OUTPUT = {
  schema: OPEN_OBJECT,
  render: (_args: unknown, value: Readonly<Record<string, JsonValue>>) => [{
    type: 'text' as const,
    text: JSON.stringify(value),
  }],
}
const PHASES = [
  'backlog', 'discussion', 'confirmed', 'design', 'planning',
  'executing', 'code_review', 'verification', 'closing', 'deployed',
] as const
const REVIEW_KINDS = ['requirement', 'design', 'plan', 'verification', 'code'] as const
const REVIEW_DECISIONS = ['approved', 'rejected', 'changes-requested'] as const
const ORCHESTRATOR_DIRECT_TOOLS = ['bash', 'pwsh', 'write', 'edit'] as const
const ORCHESTRATOR_FORBIDDEN_CALLS = new Set<string>([
  ...ORCHESTRATOR_DIRECT_TOOLS,
  'pactflow_dispatch_local',
])

/** Register PactFlow-only tools into the preset's standing Agent scope. */
export function apply(ctx: Context): void {
  const policies = new Map<string, () => void>()
  ctx.on('agent/session-start', ({ agent }) => {
    if (policies.has(agent.id)) return
    const visible = new Set(agent.ctx.tools.schemas(agent).map(tool => tool.name))
    const deny = ORCHESTRATOR_DIRECT_TOOLS.filter(tool => visible.has(tool))
    const disposeRestriction = deny.length === 0
      ? () => {}
      : agent.ctx.tools.restrict({ deny })
    const disposeGate = agent.ctx.on('tools/pre-execute', (exec, next) => {
      if (exec.agent !== agent || !ORCHESTRATOR_FORBIDDEN_CALLS.has(exec.name)) return next()
      return Promise.resolve({
        kind: 'deny',
        reason: `零脉编排器禁止直接调用 ${exec.name}；请通过 pactflow_dispatch_git 或 pactflow_dispatch_k3s 在隔离任务分支执行。`,
      })
    })
    policies.set(agent.id, () => {
      disposeGate()
      disposeRestriction()
    })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    policies.get(agent.id)?.()
    policies.delete(agent.id)
  })
  ctx.effect(() => () => {
    for (const dispose of policies.values()) dispose()
    policies.clear()
  })

  ctx.tools.register(defineTool({
    name: 'pactflow_bind_git',
    description: 'Bind the current Session workspace to an existing credential-free Git remote and remote-tracking default branch.',
    parameters: {
      expected_revision: { type: 'integer', required: true, description: 'Current project revision from pactflow_view.' },
      remote: { type: 'string', required: true, description: 'Existing Git remote name, usually origin.' },
      default_branch: { type: 'string', required: true, description: 'Protected baseline branch, usually main.' },
      username: { type: 'string', description: 'HTTPS Git username; configure together with credential_ref.' },
      credential_ref: { type: 'string', description: 'DSH Credentials reference containing the HTTPS token; never the token value.' },
      k3s_git_secret_name: { type: 'string', description: 'Existing K3s Secret containing id_ed25519 and known_hosts for remote Workers.' },
      gitea_provider_id: { type: 'string', description: 'Registered Git Provider id; the Host resolves endpoint, credential ref and repository identity from it. Never pass a raw endpoint.' },
      validation_profile_ids: {
        type: 'array',
        description: 'User-owned validation profile IDs; the Host resolves commands and never accepts command text from the model.',
        items: { type: 'string' },
      },
    },
    output: OUTPUT,
    execute(args, exec) {
      return ctx.pactflow.bindGit(requireSessionId(exec.agent?.session.id), {
        expectedRevision: args.expected_revision,
        remote: args.remote,
        defaultBranch: args.default_branch,
        ...args.username === undefined ? {} : { username: args.username },
        ...args.credential_ref === undefined ? {} : { credentialRef: args.credential_ref },
        ...args.k3s_git_secret_name === undefined ? {} : { k3sGitSecretName: args.k3s_git_secret_name },
        ...args.gitea_provider_id === undefined ? {} : { giteaProviderId: args.gitea_provider_id },
        ...args.validation_profile_ids === undefined ? {} : { validationProfileIds: args.validation_profile_ids },
      }).then(jsonObject)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_initialize',
    description: 'Initialize the one PactFlow project owned by the current PactFlow Session. Call once before other PactFlow mutations.',
    parameters: {
      name: { type: 'string', required: true, description: 'Human-readable project name.' },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(jsonObject(ctx.pactflow.initialize(
        requireSessionId(exec.agent?.session.id),
        { name: args.name },
      )))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_view',
    description: 'Read the current PactFlow project and DAG projections. Use before any mutation.',
    parameters: {},
    output: OUTPUT,
    async execute(_args, exec) {
      const sessionId = requireSessionId(exec.agent?.session.id)
      return jsonObject(await ctx.pactflow.snapshot(sessionId))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_close_git_need',
    description: 'Merge all verified task branches through a protected Gitea PR. Requires closing phase, latest verification approval, and no unmet Gitea approvals or status checks.',
    parameters: {
      need_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
    },
    output: OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      return jsonObject(await ctx.pactflow.closeGitNeed(requireSessionId(exec.agent?.session.id), {
        needId: args.need_id,
        expectedRevision: args.expected_revision,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_create_need',
    description: 'Create one backlog Need in the current initialized PactFlow project.',
    parameters: {
      id: { type: 'string', required: true, description: 'Unique lower-kebab-case need id.' },
      title: { type: 'string', required: true, description: 'Human-readable need title.' },
      description: { type: 'string', required: true, description: 'Complete need description.' },
    },
    output: OUTPUT,
    execute(args, exec) {
      const value = ctx.pactflow.createNeed(requireSessionId(exec.agent?.session.id), args)
      return Promise.resolve(jsonObject(value))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_transition_need',
    description: 'Move one Need by exactly one legal phase using its exact current revision. Review-gated transitions fail until approved.',
    parameters: {
      need_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
      to: { type: 'string', required: true, enum: PHASES },
    },
    output: OUTPUT,
    execute(args, exec) {
      const value = ctx.pactflow.transitionNeed(requireSessionId(exec.agent?.session.id), {
        needId: args.need_id,
        expectedRevision: args.expected_revision,
        to: args.to,
      })
      return Promise.resolve(jsonObject(value))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_record_review',
    description: 'Record one explicit human review decision for a Need. Use the current Need id and a truthful evidence note before a review-gated phase transition.',
    parameters: {
      need_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true, description: 'Current Need revision from pactflow_view.' },
      kind: { type: 'string', required: true, enum: REVIEW_KINDS },
      decision: { type: 'string', required: true, enum: REVIEW_DECISIONS },
      note: { type: 'string', required: true, description: 'Evidence-backed review note; never a credential or raw secret.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('PactFlow review approval requires a calling Agent')
      const sessionId = requireSessionId(agent.session.id)
      const note = pactFlowReviewNote(args.note)
      const evidenceDigest = pactFlowReviewEvidenceDigest(
        sessionId, args.need_id, args.expected_revision, args.kind, args.decision, note,
      )
      const approval = ctx.get('approval') as ApprovalService | undefined
      if (approval === undefined) throw new Error('PactFlow review approval requires the DSH Approval service')
      const outcome = await approval.request({
        agent,
        toolName: 'pactflow_record_review',
        callId: exec.callId,
        reason: `授权记录 PactFlow 评审\n需求：${args.need_id}\n修订：${String(args.expected_revision)}\n评审类型：${args.kind}\n决定：${args.decision}（${{ approved: '批准', rejected: '拒绝', 'changes-requested': '要求修改' }[args.decision]}）\n证据说明：\n${note}\n证据摘要：${evidenceDigest}`,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') throw new Error(`PactFlow review approval was ${outcome}`)
      const asked = agent.session.events.findLast(event => event.type === 'approval/asked'
        && event.data.callId === exec.callId && event.data.reason?.includes(evidenceDigest))
      if (asked === undefined || asked.type !== 'approval/asked') {
        throw new Error('PactFlow review approval audit record is missing')
      }
      return jsonObject(ctx.pactflow.recordReview(sessionId, {
        needId: args.need_id, needRevision: args.expected_revision,
        kind: args.kind, decision: args.decision, note,
        approvalRequestId: String(asked.data.id), evidenceDigest, source: 'dsh-approval',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_retry_cleanup',
    description: 'Retry one persisted K3s, Git, or closing cleanup responsibility and return its durable status.',
    parameters: {
      cleanup_id: { type: 'string', required: true },
    },
    output: OUTPUT,
    async execute(args, exec) {
      return jsonObject(await ctx.pactflow.retryCleanup(requireSessionId(exec.agent?.session.id), {
        cleanupId: args.cleanup_id,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_create_node',
    description: 'Create one DAG node under an existing Need. Dependencies must name existing nodes in the same Need.',
    parameters: {
      id: { type: 'string', required: true, description: 'Unique lower-kebab-case node id.' },
      need_id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      dependencies: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Existing same-Need node ids; use [] for a root node.',
      },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(jsonObject(ctx.pactflow.createNode(
        requireSessionId(exec.agent?.session.id),
        {
          id: args.id,
          needId: args.need_id,
          title: args.title,
          dependencies: args.dependencies,
        },
      )))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_retry_node',
    description: 'Restore one failed or cancelled DAG node to ready after verifying that no nonterminal Run still owns it. Prior Run history remains immutable and the next dispatch creates a new attempt.',
    parameters: {
      node_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(jsonObject(ctx.pactflow.retryNode(
        requireSessionId(exec.agent?.session.id),
        { nodeId: args.node_id, expectedRevision: args.expected_revision },
      )))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_dispatch_git',
    description: 'Create a Host-owned task branch/worktree, execute one DSH Subagent there, and succeed only when it leaves a clean descendant commit.',
    parameters: {
      node_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
      provider: { type: 'string', required: true, description: 'Installed Provider that advertises per-run cwd support.' },
      prompt: { type: 'string', required: true, description: 'Complete Worker instruction that explicitly requires editing, testing, and committing in the supplied worktree.' },
      lease_duration_ms: { type: 'integer', required: true, description: 'Lease duration from 1000 through 86400000.' },
    },
    output: OUTPUT,
    timeoutMs: 86_400_000,
    async execute(args, exec) {
      return jsonObject(await ctx.pactflow.dispatchGitNodeWithSignal(requireSessionId(exec.agent?.session.id), {
        nodeId: args.node_id,
        expectedRevision: args.expected_revision,
        provider: args.provider,
        prompt: args.prompt,
        leaseDurationMs: args.lease_duration_ms,
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_dispatch_k3s',
    description: 'Execute one Git-backed node through a Workspace Agent Profile (Harness + model + project quota) or an explicit backward-compatible Harness selection.',
    parameters: {
      node_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
      template_id: { type: 'string', required: true, description: 'Configured K3s Harness template id.' },
      agent_profile_id: { type: 'string', description: 'Workspace Agent Profile id; required when the project config has multiple profiles for one Harness.' },
      model_connection_id: { type: 'string', description: 'Explicit compatible model override; must resolve to one allowed Agent Profile.' },
      prompt: { type: 'string', required: true, description: 'Complete bounded Worker instruction requiring tests and a task-branch commit.' },
      lease_duration_ms: { type: 'integer', required: true },
    },
    output: OUTPUT,
    timeoutMs: 86_400_000,
    async execute(args, exec) {
      return jsonObject(await ctx.pactflow.dispatchK3sNodeWithSignal(requireSessionId(exec.agent?.session.id), {
        nodeId: args.node_id,
        expectedRevision: args.expected_revision,
        templateId: args.template_id,
        ...(args.agent_profile_id === undefined ? {} : { agentProfileId: args.agent_profile_id }),
        ...(args.model_connection_id === undefined ? {} : { modelConnectionId: args.model_connection_id }),
        prompt: args.prompt,
        leaseDurationMs: args.lease_duration_ms,
      }, exec.signal))
    },
  }))

}

function requireSessionId(value: string | undefined): string {
  if (value === undefined) throw new Error('PactFlow tools require a calling Agent Session')
  return value
}

/** Detach domain DTOs onto the open-object JSON tool boundary. */
function jsonObject(value: unknown): Readonly<Record<string, JsonValue>> {
  const detached = JSON.parse(JSON.stringify(value)) as unknown
  if (detached === null || typeof detached !== 'object' || Array.isArray(detached)) {
    throw new Error('PactFlow tool output must be an object')
  }
  return detached as Readonly<Record<string, JsonValue>>
}
