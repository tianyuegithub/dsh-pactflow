import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'

// Real-Git fixtures are slow under load; relax timeouts without touching assertions.
vi.setConfig({ testTimeout: 20_000 })

describe('PactFlow exact integration task set', () => {
  it.each(['historical-merge', 'extra-commit', 'missing-expected'] as const)('handles %s relative to the current integration baseline', async variant => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-task-set-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace, remote } = createGitFixture(root)
      const git = (args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (variant === 'historical-merge') {
        git(['switch', '-c', 'historical'])
        git(['commit', '--allow-empty', '-m', 'historical work'])
        git(['switch', 'main'])
        git(['merge', '--no-ff', '--no-edit', 'historical'])
        git(['push', 'origin', 'main'])
      }
      const branch = 'pactflow/need/node/task'
      git(['switch', '-c', branch, 'main'])
      git(['commit', '--allow-empty', '-m', 'current task'])
      const expectedCommit = git(['rev-parse', 'HEAD'])
      git(['push', 'origin', branch])
      git(['switch', 'main'])
      const workspaceGit = new PactFlowGitWorkspace()
      const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1, boundAt: 1, validationCommands: [] }
      const refs = [{ remoteRef: `refs/remotes/origin/${branch}`, expectedCommit }]
      if (variant === 'missing-expected') {
        await expect(workspaceGit.prepareClosing(workspace, 'session', 'need', 1, binding, [refs[0]!.remoteRef as never]))
          .rejects.toThrow(/expected commit/)
        expect(git(['for-each-ref', '--format=%(refname)', 'refs/heads/pactflow/closing/'])).toBe('')
        return
      }
      const first = await workspaceGit.prepareClosing(workspace, 'session', 'need', 1, binding, refs)
      if (variant === 'extra-commit') {
        execFileSync('git', ['-C', first.worktreePath, 'commit', '--allow-empty', '-m', 'unverified addition'], { stdio: 'ignore' })
        execFileSync('git', ['-C', first.worktreePath, 'push', 'origin', first.branch], { stdio: 'ignore' })
        await expect(workspaceGit.prepareClosing(workspace, 'session', 'need', 1, binding, refs)).rejects.toThrow(/task-set|integration/)
      } else {
        expect(first.commit).not.toBe(expectedCommit)
        await expect(workspaceGit.prepareClosing(workspace, 'session', 'need', 1, binding, refs)).resolves.toEqual(first)
      }
    } finally {
      if (priorHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
