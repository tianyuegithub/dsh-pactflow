import { approveExecutionPlanFixture } from '../tests/execution-plan-fixture.ts'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

// Real dogfood run: real model + real K3s container + real Git, on a small real
// project (a static web app repo). It runs a TWO-node dependency chain — a page is
// built first, then a dependent node documents it on top of the first node's commit
// — and finishes by driving the delivered page in a real browser. Nothing is mocked.
const enabled = process.env.DSH_K3S_E2E === '1'
const repository = 'ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git'
const registry = '192.168.31.200:8080/datavdl/pactflow-worker'
const template = {
  id: 'codex', harness: 'codex' as const, apiMode: 'openai-responses' as const,
  // Digest is pinned by the Harness profile settings the operator registered.
  image: process.env.PACTFLOW_TODO_IMAGE ?? `${registry}@sha256:a7d75d0191e82c243f77429cdd652a61636dd185058f1f8c7babc72bf80288c4`,
  model: 'deepseek-v4-flash-vision-exp', baseUrl: 'https://api.deepseek.com',
  modelSecretName: 'pactflow-legacy-codex-deepseek-v4flash',
  cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '2', memoryLimit: '2Gi',
}

const PAGE_PROMPT = [
  'Add a small todo (待办事项) single-page web app to this repository, following the existing pages exactly.',
  'Create todo.html: a self-contained page with an inline <script>, a Chinese UI, and localStorage persistence, supporting add / toggle-complete / delete.',
  'It MUST expose this exact testable surface: an input with id "new-todo"; a button with id "add-btn" that adds the current input value; a container with id "todo-list" whose items each have class "todo-item" containing a checkbox with class "toggle" and a button with class "delete"; a counter with id "remaining".',
  'Pressing the add button with a non-empty input appends one item, clears the input, and persists items to localStorage under key "pactflow-todos" (a JSON array of {text,done}).',
  'Create test-todo-smoke.js: a headless Node smoke test in the same style as test-notes-smoke.js that loads todo.html, executes its inline script against minimal DOM and localStorage stubs, and prints a PASS line; it must exit 0 on success.',
  'Run `node test-todo-smoke.js` and make it pass before committing.',
  'Commit todo.html and test-todo-smoke.js on the current branch with a clear message.',
  'Do not modify README.md or any other file. Do not switch branches, merge, or push to main.',
].join(' ')

const README_PROMPT = [
  'todo.html and test-todo-smoke.js already exist in this worktree (delivered by the parent task); do not modify or recreate them.',
  'Update README.md only: add todo.html to the "运行说明" list of pages and add test-todo-smoke.js to the smoke-test list, matching the existing wording style.',
  'Commit README.md on the current branch with a clear message.',
  'Do not modify any other file. Do not switch branches, merge, or push to main.',
].join(' ')

describe.skipIf(!enabled)('PactFlow real todo web app dogfood', { timeout: 900_000 }, () => {
  let root: string
  let ctx: Context
  let priorDshHome: string | undefined
  const workspaces: { readonly id: string; readonly path: string; readonly title: string; readonly sessionIds: string[] }[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-todo-dogfood-'))
    priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.provide('workspaceRegistry', {
      list: () => workspaces,
      get: id => workspaces.find(item => item.id === id),
    } as never)
    await ctx.plugin(PactFlowService, {
      k3s: {
        namespace: 'pactflow', imagePullSecret: 'pactflow-registry-home-harbor', pollIntervalMs: 1_000,
        templates: [template],
      },
    })
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    if (priorDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorDshHome
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('builds and documents a working todo page through a real two-node K3s chain', async () => {
    const workspace = join(root, 'workspace')
    execFileSync('git', ['clone', '--branch', 'main', repository, workspace], {
      stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    execFileSync('git', ['-C', workspace, 'config', 'user.name', 'PactFlow Host'])
    execFileSync('git', ['-C', workspace, 'config', 'user.email', 'pactflow-host@example.invalid'])
    const session = ctx.sessions.create(SessionId('todo-dogfood'), {
      meta: { agentPreset: 'pactflow', cwd: workspace },
    })
    try {
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Todo dogfood' })
      workspaces.length = 0
      workspaces.push({ id: 'todo-dogfood-ws', path: workspace, title: 'Todo dogfood', sessionIds: [session.id] })
      // Real Host-side validation: run the page's own smoke test on the delivered commit.
      await ctx.pactflow.saveValidationProfiles({ workspaceId: 'todo-dogfood-ws', expectedRevision: 0,
        profiles: [{ id: 'todo-smoke', displayName: 'Todo smoke', command: 'node',
          args: ['test-todo-smoke.js'], timeoutMs: 60_000 }] })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
        k3sGitSecretName: 'pactflow-git-zeromai-demo-v2',
        validationProfileIds: ['todo-smoke'],
      })
      ctx.pactflow.createNeed(session.id, { id: 'todo', title: 'Todo web app', description: 'dogfood' })
      const pageNode = ctx.pactflow.createNode(session.id, { id: 'todo-page', needId: 'todo', title: 'Add todo page', dependencies: [] })
      const readmeNode = ctx.pactflow.createNode(session.id, {
        id: 'todo-readme', needId: 'todo', title: 'Document the page', dependencies: ['todo-page'],
        // F03: declare the dependency whose successful commit becomes this node's code input.
        codeInputs: ['todo-page'],
      })
      // A dependent node starts pending and must only become ready once its dependency succeeds.
      expect(dagState(session, 'todo-readme')).toBe('pending')

      await approveExecutionPlanFixture(ctx, session.id, PAGE_PROMPT, { kind: 'k3s', templateId: template.id }, pageNode.id)
      const pageRun = await ctx.pactflow.dispatchK3sNode(session.id, {
        nodeId: pageNode.id, expectedRevision: pageNode.revision, templateId: template.id,
        leaseDurationMs: 600_000, prompt: PAGE_PROMPT,
      })
      expect(pageRun.run.state, pageRun.run.outcome).toBe('succeeded')
      expect(pageRun.run.k3sResult).toMatchObject({ exitCode: 0 })
      expect(pageRun.run.gitResult?.validations.length).toBeGreaterThan(0)
      // Node 1's success promotes its dependent to ready.
      expect(dagState(session, 'todo-readme')).toBe('ready')
      const pageTree = pageRun.run.git!.worktreePath
      expect(readFileSync(join(pageTree, 'todo.html'), 'utf8')).toContain('localStorage')
      expect(readFileSync(join(pageTree, 'test-todo-smoke.js'), 'utf8')).toContain('PASS')

      // Node 2 runs on top of node 1: its worktree must carry node 1's commit (code input).
      const readmeNodeState = ctx.pactflow.dag(session.id).byId['todo-readme']!
      await approveExecutionPlanFixture(ctx, session.id, README_PROMPT, { kind: 'k3s', templateId: template.id }, readmeNode.id)
      const readmeRun = await ctx.pactflow.dispatchK3sNode(session.id, {
        nodeId: readmeNode.id, expectedRevision: readmeNodeState.revision, templateId: template.id,
        leaseDurationMs: 600_000, prompt: README_PROMPT,
      })
      const readmeTree = readmeRun.run.git!.worktreePath
      // Diagnostics for the dependent node's delivered tree and validation outcome.
      {
        const { readdirSync } = await import('node:fs')
        console.log(`[todo-dogfood] readme outcome=${readmeRun.run.outcome}`)
        console.log(`[todo-dogfood] readme files=${readdirSync(readmeTree).join(',')}`)
        console.log(`[todo-dogfood] readme validations=${JSON.stringify(readmeRun.run.gitResult?.validations)}`)
      }
      expect(readmeRun.run.state, readmeRun.run.outcome).toBe('succeeded')
      // The dependent node inherited the parent's page (folded code input) ...
      expect(readFileSync(join(readmeTree, 'todo.html'), 'utf8')).toContain('localStorage')
      // ... and actually documented it.
      expect(readFileSync(join(readmeTree, 'README.md'), 'utf8')).toContain('todo.html')

      // Finally, the page the chain produced really works in a real browser.
      const browser = await chromium.launch()
      try {
        const browserPage = await browser.newPage()
        const errors: string[] = []
        browserPage.on('pageerror', error => errors.push(String(error)))
        await browserPage.goto(pathToFileURL(join(readmeTree, 'todo.html')).href, { waitUntil: 'load' })
        await browserPage.locator('#new-todo').fill('买牛奶')
        await browserPage.locator('#add-btn').click()
        await browserPage.locator('#new-todo').fill('写周报')
        await browserPage.locator('#add-btn').click()
        expect(await browserPage.locator('.todo-item').count()).toBe(2)
        const stored = await browserPage.evaluate(() => window.localStorage.getItem('pactflow-todos'))
        expect(stored).toContain('买牛奶')
        expect(stored).toContain('写周报')
        await browserPage.locator('.todo-item .toggle').first().check()
        await browserPage.locator('.todo-item .delete').last().click()
        expect(await browserPage.locator('.todo-item').count()).toBe(1)
        await browserPage.reload({ waitUntil: 'load' })
        await browserPage.waitForSelector('.todo-item')
        expect(await browserPage.locator('.todo-item').count()).toBe(1)
        expect(await browserPage.locator('.todo-item').first().innerText()).toContain('买牛奶')
        expect(errors, `page errors: ${errors.join('; ')}`).toEqual([])
        if (process.env.PACTFLOW_KEEP_ROOT === '1') {
          const { mkdir, copyFile } = await import('node:fs/promises')
          const keep = join(process.cwd(), '.arts', 'todo-dogfood')
          await mkdir(keep, { recursive: true })
          await copyFile(join(readmeTree, 'todo.html'), join(keep, 'todo.html'))
          await copyFile(join(readmeTree, 'test-todo-smoke.js'), join(keep, 'test-todo-smoke.js'))
          console.log(`[todo-dogfood] kept ${keep}/todo.html`)
        }
      } finally {
        await browser.close()
      }

      console.log(`[todo-dogfood] page branch=${pageRun.run.git!.branch} commit=${pageRun.run.gitResult!.commit}`)
      console.log(`[todo-dogfood] readme branch=${readmeRun.run.git!.branch} commit=${readmeRun.run.gitResult!.commit}`)
    } finally {
      cleanupRuns(session, workspace)
    }
  })

  function dagState(session: Session, nodeId: string): string | undefined {
    return ctx.pactflow.dag(session.id).byId[nodeId]?.state
  }

  function cleanupRuns(session: Session, workspace: string): void {
    for (const run of Object.values(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId ?? {})) {
      const jobName = run.k3s?.jobName
      const configMapName = run.k3s?.configMapName
      if (jobName !== undefined) {
        execFileSync('kubectl', ['-n', 'pactflow', 'delete', 'job', jobName, '--ignore-not-found=true', '--wait=true'], { stdio: 'ignore' })
      }
      if (configMapName !== undefined) {
        execFileSync('kubectl', ['-n', 'pactflow', 'delete', 'configmap', configMapName, '--ignore-not-found=true', '--wait=true'], { stdio: 'ignore' })
      }
      const branch = run.git?.branch
      if (branch === undefined) continue
      const exists = execFileSync('git', ['-C', workspace, 'ls-remote', '--heads', 'origin', branch], {
        encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).trim()
      if (exists.length > 0) {
        execFileSync('git', ['-C', workspace, 'push', 'origin', '--delete', branch], {
          stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        })
      }
    }
  }
})
