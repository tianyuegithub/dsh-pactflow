import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type {} from '../index.ts'

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

/** Register PactFlow-only tools into the preset's standing Agent scope. */
export function apply(ctx: Context): void {
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
      gitea_base_url: { type: 'string', description: 'Credential-free Gitea base URL; configure with all gitea_* fields.' },
      gitea_owner: { type: 'string', description: 'Gitea repository owner.' },
      gitea_repo: { type: 'string', description: 'Gitea repository name.' },
      gitea_token_credential_ref: { type: 'string', description: 'DSH Credentials reference containing a Gitea API token.' },
      validation_commands: {
        type: 'array',
        description: 'Host-side validation commands executed without a shell after the Worker commits and before push.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', required: true },
            args: { type: 'array', required: true, items: { type: 'string' } },
            timeout_ms: { type: 'integer', required: true },
          },
        },
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
        ...args.gitea_base_url === undefined ? {} : { giteaBaseUrl: args.gitea_base_url },
        ...args.gitea_owner === undefined ? {} : { giteaOwner: args.gitea_owner },
        ...args.gitea_repo === undefined ? {} : { giteaRepo: args.gitea_repo },
        ...args.gitea_token_credential_ref === undefined
          ? {}
          : { giteaTokenCredentialRef: args.gitea_token_credential_ref },
        ...args.validation_commands === undefined ? {} : {
          validationCommands: args.validation_commands.map(command => ({
            command: command.command,
            args: command.args,
            timeoutMs: command.timeout_ms,
          })),
        },
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
      return jsonObject(await ctx.pactflow.dispatchGitNode(requireSessionId(exec.agent?.session.id), {
        nodeId: args.node_id,
        expectedRevision: args.expected_revision,
        provider: args.provider,
        prompt: args.prompt,
        leaseDurationMs: args.lease_duration_ms,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_dispatch_k3s',
    description: 'Execute one Git-backed node through a Host-configured K3s Harness template. Each template fixes its supported API mode; Secret values stay in Kubernetes.',
    parameters: {
      node_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
      template_id: { type: 'string', required: true, description: 'Configured K3s Harness template id.' },
      prompt: { type: 'string', required: true, description: 'Complete bounded Worker instruction requiring tests and a task-branch commit.' },
      lease_duration_ms: { type: 'integer', required: true },
    },
    output: OUTPUT,
    timeoutMs: 86_400_000,
    async execute(args, exec) {
      return jsonObject(await ctx.pactflow.dispatchK3sNode(requireSessionId(exec.agent?.session.id), {
        nodeId: args.node_id,
        expectedRevision: args.expected_revision,
        templateId: args.template_id,
        prompt: args.prompt,
        leaseDurationMs: args.lease_duration_ms,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pactflow_dispatch_local',
    description: 'Claim one ready DAG node and execute it through an installed DSH Subagent provider. Returns only after the Run settles.',
    parameters: {
      node_id: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true },
      provider: { type: 'string', required: true, description: 'Installed provider name such as spawn or fork.' },
      prompt: { type: 'string', required: true, description: 'Complete bounded Worker instruction.' },
      lease_duration_ms: { type: 'integer', required: true, description: 'Lease duration from 1000 through 86400000.' },
    },
    output: OUTPUT,
    timeoutMs: 86_400_000,
    async execute(args, exec) {
      const value = await ctx.pactflow.dispatchLocalNode(requireSessionId(exec.agent?.session.id), {
        nodeId: args.node_id,
        expectedRevision: args.expected_revision,
        provider: args.provider,
        prompt: args.prompt,
        leaseDurationMs: args.lease_duration_ms,
      })
      return jsonObject(value)
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
