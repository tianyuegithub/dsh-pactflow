import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow exact integration cleanup', () => {
  it.each(['valid', 'remote-drift', 'racing-remote', 'foreign-path', 'missing-commit'] as const)('conditionally deletes task branches: %s', async variant => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-task-cleanup-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace, remote } = createGitFixture(root)
      const gitCommand = (args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const worktreePath = variant === 'foreign-path' ? join(root, 'user-checkout') : join(root, '.dsh', 'pactflow', 'worktrees', 'project', 'task')
      await mkdir(dirname(worktreePath), { recursive: true })
      const branch = 'pactflow/need/node/task'
      gitCommand(['worktree', 'add', '-b', branch, worktreePath])
      const commit = gitCommand(['rev-parse', branch])
      gitCommand(['push', 'origin', branch])
      let remoteCommit = commit
      if (variant === 'remote-drift' || variant === 'racing-remote') {
        remoteCommit = gitCommand(['commit-tree', `${commit}^{tree}`, '-p', commit, '-m', 'remote advance'])
        if (variant === 'remote-drift') gitCommand(['push', 'origin', `${remoteCommit}:refs/heads/${branch}`])
      }
      const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1, boundAt: 1, validationCommands: [] }
      const spec = { ...binding, baseCommit: commit, branch, worktreePath }
      const git = new PactFlowGitWorkspace()
      if (variant === 'racing-remote') {
        const original = Reflect.get(git, 'git')
        Reflect.set(git, 'git', async (cwd: string, args: readonly string[], environment?: NodeJS.ProcessEnv) => {
          if (args[0] === 'push' && args.includes(`:refs/heads/${branch}`)) {
            gitCommand(['push', 'origin', `${remoteCommit}:refs/heads/${branch}`])
          }
          return await original.call(git, cwd, args, environment)
        })
      }
      const expected = variant === 'missing-commit' ? undefined : commit
      if (variant === 'valid') {
        await git.cleanupTaskRun(workspace, binding, spec, undefined, expected)
        await expect(git.cleanupTaskRun(workspace, binding, spec, undefined, expected)).resolves.toBeUndefined()
        expect(gitCommand(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).toBe('')
      } else {
        await expect(git.cleanupTaskRun(workspace, binding, spec, undefined, expected)).rejects.toThrow()
        await expect(access(worktreePath)).resolves.toBeUndefined()
        expect(gitCommand(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).toContain(remoteCommit)
      }
    } finally {
      if (priorHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['valid', 'wrong-commit', 'wrong-branch', 'foreign-path', 'symlink-escape'] as const)('handles %s without deleting another target', async variant => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-exact-cleanup-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const worktreePath = variant === 'foreign-path' ? join(root, 'user-checkout')
        : join(root, '.dsh', 'pactflow', 'worktrees', 'project', 'closing')
      await mkdir(dirname(worktreePath), { recursive: true })
      const branch = 'pactflow/closing/project/r1'
      const actualPath = variant === 'symlink-escape' ? join(root, 'user-checkout') : worktreePath
      execFileSync('git', ['-C', workspace, 'worktree', 'add', '-b', branch, actualPath], { stdio: 'ignore' })
      if (variant === 'symlink-escape') await symlink(actualPath, worktreePath)
      const commit = execFileSync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      const target = { worktreePath, branch: variant === 'wrong-branch' ? 'pactflow/closing/other/r1' : branch,
        commit: variant === 'wrong-commit' ? 'f'.repeat(40) : commit }
      const git = new PactFlowGitWorkspace()
      if (variant === 'valid') {
        await git.cleanupClosing(workspace, target)
        await expect(git.cleanupClosing(workspace, target)).resolves.toBeUndefined()
        await expect(access(worktreePath)).rejects.toThrow()
      } else {
        await expect(git.cleanupClosing(workspace, target)).rejects.toThrow()
        await expect(access(worktreePath)).resolves.toBeUndefined()
        expect(execFileSync('git', ['-C', workspace, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim()).toBe(commit)
      }
    } finally {
      if (priorHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
