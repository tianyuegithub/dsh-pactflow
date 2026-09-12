import { approveExecutionPlanFixture } from '../packages/dsh-pactflow/tests/execution-plan-fixture.ts'
/**
 * Multi-process crash-restart driver (authorized B-class run).
 *
 * A standalone Node process that composes the REAL plugin (Cordis + SessionStore +
 * SessionProjectionRegistry + JSONL persistence on a shared disk root +
 * PactFlowService with a real kubeconfig), so a parent test can SIGKILL it mid-flight
 * and then start a *fresh* process against the same DSH_HOME to prove recovery from
 * durable facts.
 *
 * Modes:
 *   start   - create session/project/git binding, dispatch a REAL K3s Job, write the
 *             crash state, then idle so the parent can SIGKILL it.
 *   resume  - load the session from disk in a brand-new process and report whether the
 *             non-terminal Run + its exact K3s identity survived.
 */
import { writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import PactFlowService from '../packages/dsh-pactflow/lib/index.js'

const mode = process.argv[2]
const root = process.env.PACTFLOW_CRASH_ROOT
const statePath = process.env.PACTFLOW_CRASH_STATE
const workspace = process.env.PACTFLOW_CRASH_WORKSPACE
const SESSION_ID = process.env.PACTFLOW_CRASH_SESSION ?? 'crash-root'

async function compose() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(PactFlowService, {
    k3s: {
      namespace: 'pactflow',
      kubeconfig: process.env.KUBECONFIG ?? undefined,
      imagePullSecret: 'pactflow-registry-home-harbor',
      pollIntervalMs: 1_000,
      templates: [{
        id: 'dsh-deepseek-v4flash',
        harness: 'dsh',
        apiMode: 'openai-chat-completions',
        image: process.env.PACTFLOW_CRASH_IMAGE,
        model: 'deepseek-v4-flash-vision-exp',
        baseUrl: 'https://api.deepseek.com',
        modelSecretName: process.env.PACTFLOW_CRASH_MODEL_SECRET,
        cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '2', memoryLimit: '2Gi',
      }],
    },
  })
  return ctx
}

function runsOf(ctx, session) {
  return Object.values(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId ?? {})
}

async function start() {
  const ctx = await compose()
  const session = ctx.sessions.create(SessionId(SESSION_ID), { meta: { agentPreset: 'pactflow', cwd: workspace } })
  const initialized = ctx.pactflow.initialize(session.id, { name: 'Crash restart' })
  const registered = { id: 'crash-workspace', path: workspace, title: 'Crash', sessionIds: [session.id] }
  ctx.provide('workspaceRegistry', { list: () => [registered], get: () => registered })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
  await ctx.pactflow.bindGit(session.id, {
    expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
    k3sGitSecretName: process.env.PACTFLOW_CRASH_GIT_SECRET,
  })

  // Real dispatch; we do NOT await it — the parent kills us while the Job is live.
  await approveExecutionPlanFixture(ctx, session.id, 'Create crash-restart-proof.txt containing CRASH OK and commit it. Do not modify any other file, switch branches, merge, or deploy.', { kind: 'k3s', templateId: 'dsh-deepseek-v4flash' }, node.id)
  void ctx.pactflow.dispatchK3sNode(session.id, {
    nodeId: node.id, expectedRevision: ctx.pactflow.dag(session.id).byId.node.revision,
    templateId: 'dsh-deepseek-v4flash', leaseDurationMs: 600_000,
    prompt: 'Create crash-restart-proof.txt containing CRASH OK and commit it. Do not modify any other file, switch branches, merge, or deploy.',
  }).catch(error => { writeFileSync(`${statePath}.error`, String(error?.message ?? error)) })

  const deadline = Date.now() + 240_000
  for (;;) {
    const claimed = runsOf(ctx, session).find(run => run.k3s !== undefined && run.git !== undefined)
    if (claimed !== undefined) {
      await ctx.sessions.flush(session)
      writeFileSync(statePath, JSON.stringify({
        pid: process.pid, sessionId: String(session.id), runId: String(claimed.id),
        jobName: claimed.k3s.jobName, configMapName: claimed.k3s.configMapName,
        branch: claimed.git.branch, state: claimed.state,
      }))
      // Idle forever; the parent SIGKILLs us to model an abrupt host death.
      setInterval(() => {}, 1 << 30)
      return
    }
    if (Date.now() > deadline) throw new Error('dispatch did not produce a claimed K3s Run in time')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

async function resume() {
  const ctx = await compose()
  const stored = await ctx.sessionPersistence.load(SessionId(SESSION_ID))
  ctx.provide('sessionQuery', { readSession: () => Promise.resolve({ session: stored.meta, events: [...stored.events] }) })
  const session = ctx.sessions.prepare(SessionId(SESSION_ID), {
    seed: structuredClone([...stored.events]), meta: structuredClone(stored.meta), seedSource: 'persistence',
  })
  const runs = runsOf(ctx, session)
  const nonTerminal = runs.filter(run => !['succeeded', 'failed', 'cancelled'].includes(run.state))
  // The resumed session is a *prepared* (not live) session, so read its project from
  // the projection rather than the live-session Remote.
  const project = ctx.sessionProjections.stateOf(session, 'pactflowProject')?.project ?? null
  writeFileSync(statePath, JSON.stringify({
    sessionId: String(session.id),
    runCount: runs.length,
    nonTerminal: nonTerminal.map(run => ({
      id: String(run.id), state: run.state,
      jobName: run.k3s?.jobName, jobUid: run.k3s?.jobUid, branch: run.git?.branch,
    })),
    projectPresent: project !== null,
  }))
  await ctx.fiber.dispose()
}

try {
  if (mode === 'start') await start()
  else if (mode === 'resume') await resume()
  else throw new Error(`unknown mode ${String(mode)}`)
} catch (error) {
  const detail = String(error?.stack ?? error)
  try { writeFileSync(`${statePath}.error`, detail) } catch { /* stderr below is the primary channel */ }
  process.stderr.write(`[crash-restart-driver] ${detail}\n`)
  process.exitCode = 1
}
