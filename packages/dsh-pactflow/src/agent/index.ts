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
    name: 'pactflow_view',
    description: 'Read the current PactFlow project and DAG projections. Use before any mutation.',
    parameters: {},
    output: OUTPUT,
    execute(_args, exec) {
      const sessionId = requireSessionId(exec.agent?.session.id)
      return Promise.resolve(jsonObject(ctx.pactflow.snapshot(sessionId)))
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
