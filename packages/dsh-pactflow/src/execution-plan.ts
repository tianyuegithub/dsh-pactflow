import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PactFlowExecutionPlan, PactFlowNode } from './types.ts'

const text = z.string().trim().min(1).max(16_384).refine(
  value => !/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(value),
  'execution plan must not contain credential-like values',
)
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export const executionRouteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('git'), provider: text, recovery: z.object({ runId: z.string().regex(/^run-[a-f0-9-]{36}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict(),
  z.object({ kind: z.literal('k3s'), templateId: text, agentProfileId: text.optional(),
    modelConnectionId: text.optional(), workerPoolId: text.optional() }).strict(),
]).transform((route): PactFlowExecutionPlan['nodes'][number]['execution'] => route.kind === 'git' ? { kind: route.kind, provider: route.provider, ...(route.recovery ? { recovery: route.recovery } : {}) } : ({
  kind: route.kind, templateId: route.templateId,
  ...(route.agentProfileId === undefined ? {} : { agentProfileId: route.agentProfileId }),
  ...(route.modelConnectionId === undefined ? {} : { modelConnectionId: route.modelConnectionId }),
  ...(route.workerPoolId === undefined ? {} : { workerPoolId: route.workerPoolId }),
}))
export const executionPlanSchema = z.object({
  id, mode: z.enum(['single', 'split']), summary: text, rationale: text,
  nodes: z.array(z.object({ id, title: text, prompt: text,
    acceptance: z.array(text).min(1), dependencies: z.array(id), codeInputs: z.array(id),
    execution: executionRouteSchema,
    executionDescription: text.optional(),
    providerIdentity: z.string().optional(),
  }).strict()).min(1).max(64),
}).strict().superRefine((plan, ctx) => {
  if ((plan.mode === 'single') !== (plan.nodes.length === 1)) ctx.addIssue({ code: 'custom', message: 'single requires one node; split requires multiple nodes' })
  const nodes = new Map(plan.nodes.map(node => [node.id, node]))
  if (nodes.size !== plan.nodes.length) ctx.addIssue({ code: 'custom', message: 'duplicate plan node' })
  const visited = new Set<string>(), visiting = new Set<string>()
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return
    if (visiting.has(nodeId)) { ctx.addIssue({ code: 'custom', message: 'cyclic plan dependencies' }); return }
    const node = nodes.get(nodeId)
    if (node === undefined) { ctx.addIssue({ code: 'custom', message: 'missing plan dependency' }); return }
    visiting.add(nodeId)
    if (new Set(node.dependencies).size !== node.dependencies.length || new Set(node.codeInputs).size !== node.codeInputs.length
      || node.codeInputs.some(input => !node.dependencies.includes(input))) ctx.addIssue({ code: 'custom', message: 'invalid plan code inputs or duplicate dependencies' })
    node.dependencies.forEach(visit)
    visiting.delete(nodeId); visited.add(nodeId)
  }
  plan.nodes.forEach(node => visit(node.id))
})
export const executionPlanRequestSchema = z.object({
  needId: id, recommendedId: id, plans: z.array(executionPlanSchema).min(1).max(2),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.plans.map(plan => plan.id)).size !== value.plans.length
    || !value.plans.some(plan => plan.id === value.recommendedId)) ctx.addIssue({ code: 'custom', message: 'invalid recommended plan or duplicate plan id' })
  if (JSON.stringify(value).length > 65_536) ctx.addIssue({ code: 'custom', message: 'execution plan is too large' })
})
export const executionPlanAuthorizationSchema = z.object({
  plan: executionPlanSchema, scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  proposalDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

/** Stable object encoding; array order remains part of the presented plan. */
export function executionDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : item
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function planNodeMatches(node: PactFlowNode, proposed: PactFlowExecutionPlan['nodes'][number]): boolean {
  return node.id === proposed.id && node.title === proposed.title
    && executionDigest([...node.dependencies].sort()) === executionDigest([...proposed.dependencies].sort())
    && executionDigest([...(node.codeInputs ?? [])].sort()) === executionDigest([...proposed.codeInputs].sort())
}

export function executionPlanMarkdown(plan: PactFlowExecutionPlan): string {
  return [`### ${plan.summary}`, `模式：${plan.mode === 'single' ? '单节点完整交付' : `拆分为 ${plan.nodes.length} 个节点`}`,
    `理由：${plan.rationale}`, ...plan.nodes.map(node => [
      `#### ${node.id}：${node.title}`, `执行规格：${JSON.stringify(node.execution)}`, node.executionDescription ?? '',
      `依赖：${node.dependencies.join('、') || '无'}；代码输入：${node.codeInputs.join('、') || '无'}`,
      '任务指令：', node.prompt, '验收清单：', ...node.acceptance.map(item => `- ${item}`),
    ].join('\n'))].join('\n\n')
}
