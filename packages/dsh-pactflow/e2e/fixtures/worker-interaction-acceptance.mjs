// Test-only DSH extension; never copied into the distributed execution image.
import { writeFile } from 'node:fs/promises'
export const inject = ['approval', 'userQuestions', 'agents']
export function apply(ctx) {
  const entered = new Set()
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (entered.has(agent.id) || !ctx.agents.roots().includes(agent)) return next()
    entered.add(agent.id)
    const approved = await ctx.approval.request({ agent, signal, toolName: 'relay_acceptance_write', reason: '验收：是否允许在当前测试任务分支新增 relay-proof.json？仅该文件。' })
    if (approved !== 'allowed-once') throw new Error('Required acceptance approval was not granted')
    const chosen = await ctx.userQuestions.ask({ agent, signal, questions: [{ id: 'colour', header: '远程选择验收', question: '请选择验收文件的颜色值',
      options: [{ label: '蓝色', description: '写入 blue' }, { label: '绿色', description: '写入 green' }], multiSelect: false }] })
    const denied = await ctx.approval.request({ agent, signal, toolName: 'relay_acceptance_forbidden', reason: '拒绝路径验收：这个操作必须被拒绝，不应新增 forbidden.txt。' })
    if (denied !== 'rejected') throw new Error('Rejection scenario was incorrectly granted')
    if (chosen.answers[0]?.selected?.[0] !== '蓝色') throw new Error('Unexpected acceptance answer')
    await writeFile('/workspace/repo/relay-proof.json', JSON.stringify({ approved: true, colour: 'blue', rejected: true, runId: process.env.PACTFLOW_RUN_ID }) + '\n')
    return next()
  })
}
