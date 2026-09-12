import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'
import type { PactFlowClosingGit } from '../src/types.ts'

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-cancel-'))
  const prior = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  const { workspace, remote } = createGitFixture(root)
  git(['-C', workspace, 'switch', '-c', 'pactflow/task'])
  git(['-C', workspace, 'commit', '--allow-empty', '-m', 'test task'])
  const commit = git(['-C', workspace, 'rev-parse', 'HEAD'])
  git(['-C', workspace, 'push', 'origin', 'pactflow/task'])
  git(['-C', workspace, 'switch', 'main'])
  const worker = new PactFlowGitWorkspace()
  const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1, boundAt: 1, validationCommands: [] }
  const refs = [{ remoteRef: 'refs/remotes/origin/pactflow/task', expectedCommit: commit }]
  return { root, workspace, remote, worker, binding, refs,
    finish: async () => { if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior; await rm(root, { recursive: true, force: true }) } }
}

describe('closing cancellation and persisted push identity', () => {
  it('cancels a real long validation process before any remote integration push', async () => {
    const f = await fixture()
    try {
      const marker = join(f.root, 'validation.pid')
      const controller = new AbortController()
      const beforePush = vi.fn()
      const pending = f.worker.prepareClosing(f.workspace, 'cancel', 'need', 1, f.binding, f.refs, undefined, [], undefined, [{
        command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`], timeoutMs: 30000,
      }], beforePush, controller.signal)
      void pending.catch(() => {})
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true))
      const pid = Number(readFileSync(marker, 'utf8'))
      controller.abort()
      await expect(pending).rejects.toThrow(/validation failed/)
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
      expect(beforePush).not.toHaveBeenCalled()
      expect(git(['--git-dir', f.remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/pactflow/closing/'])).toBe('')
    } finally { await f.finish() }
  })

  it('retains the exact unpushed identity and retries only that verified integration', async () => {
    const f = await fixture()
    try {
      const controller = new AbortController()
      let saved: PactFlowClosingGit | undefined
      await expect(f.worker.prepareClosing(f.workspace, 'cancel', 'need', 1, f.binding, f.refs, undefined, [], undefined, [], async closing => {
        saved = closing; controller.abort()
      }, controller.signal)).rejects.toThrow()
      expect(saved).toBeDefined()
      expect(git(['--git-dir', f.remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/pactflow/closing/'])).toBe('')
      const resumed = await f.worker.prepareClosing(f.workspace, 'cancel', 'need', 1, f.binding, f.refs, undefined, [], saved)
      expect(resumed.commit).toBe(saved!.commit)
      expect(git(['--git-dir', f.remote, 'rev-parse', `refs/heads/${saved!.branch}`])).toBe(saved!.commit)
    } finally { await f.finish() }
  })
})
