import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow integration isolation', () => {
  it.each(['different-needs', 'different-sessions', 'legacy-attempt'] as const)('isolates concurrent %s with equal revisions', async variant => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-closing-isolation-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace, remote } = createGitFixture(root)
      const command = (args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const refs = [1, 2].map(index => {
        const branch = `pactflow/need/node/task-${index}`
        command(['switch', '-c', branch, 'main'])
        command(['commit', '--allow-empty', '-m', `task ${index}`])
        const commit = command(['rev-parse', 'HEAD'])
        command(['push', 'origin', branch])
        command(['switch', 'main'])
        return { remoteRef: `refs/remotes/origin/${branch}`, expectedCommit: commit }
      })
      const git = new PactFlowGitWorkspace()
      const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1, boundAt: 1, validationCommands: [] }
      const first = await git.prepareClosing(workspace, 'session-a', 'need-a', 1, binding, [refs[0]!])
      if (variant === 'legacy-attempt') {
        const legacy = { ...first, branch: 'pactflow/closing/need-a/r1',
          worktreePath: join(dirname(dirname(first.worktreePath)), 'r1') }
        command(['branch', '-m', first.branch, legacy.branch])
        command(['worktree', 'move', first.worktreePath, legacy.worktreePath])
        command(['push', 'origin', `${legacy.branch}:refs/heads/${legacy.branch}`])
        command(['push', 'origin', '--delete', first.branch])
        expect(await git.prepareClosing(workspace, 'session-a', 'need-a', 1, binding, [refs[0]!], undefined, [], legacy))
          .toEqual(legacy)
        return
      }
      const second = await git.prepareClosing(workspace, variant === 'different-sessions' ? 'session-b' : 'session-a',
        variant === 'different-needs' ? 'need-b' : 'need-a', 1, binding, [refs[1]!])
      expect(first.branch).not.toBe(second.branch)
      expect(first.worktreePath).not.toBe(second.worktreePath)
      expect(command(['rev-parse', `refs/heads/${first.branch}`])).toBe(first.commit)
      expect(command(['rev-parse', `refs/heads/${second.branch}`])).toBe(second.commit)
    } finally {
      if (priorHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
