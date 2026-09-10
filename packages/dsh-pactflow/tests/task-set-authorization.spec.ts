import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import type { PactFlowGitBinding } from '../src/types.ts'

// F03 rewrote the closing task-set invariant to allow dependency closures. This
// adversarial check proves it still rejects unauthorized commits.
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

describe('PactFlow integration task-set authorization', () => {
  it('rejects an unauthorized commit merged alongside an authorized task', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-vts-'))
    try {
      const remote = join(root, 'remote.git')
      const seed = join(root, 'seed')
      const ws = join(root, 'ws')
      execFileSync('git', ['init', '--bare', remote])
      execFileSync('git', ['init', seed])
      git(seed, ['config', 'user.name', 't'])
      git(seed, ['config', 'user.email', 't@e'])
      git(seed, ['switch', '-c', 'main'])
      execFileSync('git', ['-C', seed, 'commit', '--allow-empty', '-m', 'base'])
      git(seed, ['remote', 'add', 'origin', remote])
      git(seed, ['push', '-u', 'origin', 'main'])
      execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
      execFileSync('git', ['clone', remote, ws])
      git(ws, ['config', 'user.name', 'w'])
      git(ws, ['config', 'user.email', 'w@e'])
      const workspace = new PactFlowGitWorkspace({ worktreeRoot: join(root, 'wt') })
      const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main' } as PactFlowGitBinding
      const verify = Reflect.get(workspace, 'verifyTaskSet').bind(workspace) as (
        repository: string, branches: readonly { branch: string; expectedCommit?: string }[],
        integrationCommit: string, baseCommit: string,
      ) => Promise<void>

      const base = git(ws, ['rev-parse', 'HEAD'])
      git(ws, ['switch', '-c', 'task', 'main'])
      execFileSync('git', ['-C', ws, 'commit', '--allow-empty', '-m', 'task'])
      const task = git(ws, ['rev-parse', 'HEAD'])
      git(ws, ['switch', 'main'])

      // Integration containing the authorized task AND an unauthorized rogue commit.
      git(ws, ['switch', '-c', 'rogue', 'main'])
      execFileSync('git', ['-C', ws, 'commit', '--allow-empty', '-m', 'rogue'])
      git(ws, ['switch', '-c', 'int', 'main'])
      execFileSync('git', ['-C', ws, 'merge', '--no-ff', '--no-edit', 'task'], { stdio: 'ignore' })
      execFileSync('git', ['-C', ws, 'merge', '--no-ff', '--no-edit', 'rogue'], { stdio: 'ignore' })
      const integration = git(ws, ['rev-parse', 'HEAD'])
      await expect(verify(ws, [{ branch: 'task', expectedCommit: task }], integration, base))
        .rejects.toThrow(/unexpected commit|merges an unexpected/)

      // Control: the task-only integration is accepted.
      git(ws, ['switch', '-c', 'int2', 'main'])
      execFileSync('git', ['-C', ws, 'merge', '--no-ff', '--no-edit', 'task'], { stdio: 'ignore' })
      const integration2 = git(ws, ['rev-parse', 'HEAD'])
      await expect(verify(ws, [{ branch: 'task', expectedCommit: task }], integration2, base)).resolves.toBeUndefined()
      void binding
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts a dependency chain where the dependent commit contains its predecessor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-vts-chain-'))
    try {
      const remote = join(root, 'remote.git')
      const seed = join(root, 'seed')
      const ws = join(root, 'ws')
      execFileSync('git', ['init', '--bare', remote])
      execFileSync('git', ['init', seed])
      git(seed, ['config', 'user.name', 't'])
      git(seed, ['config', 'user.email', 't@e'])
      git(seed, ['switch', '-c', 'main'])
      execFileSync('git', ['-C', seed, 'commit', '--allow-empty', '-m', 'base'])
      git(seed, ['remote', 'add', 'origin', remote])
      git(seed, ['push', '-u', 'origin', 'main'])
      execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
      execFileSync('git', ['clone', remote, ws])
      git(ws, ['config', 'user.name', 'w'])
      git(ws, ['config', 'user.email', 'w@e'])
      const workspace = new PactFlowGitWorkspace({ worktreeRoot: join(root, 'wt') })
      const verify = Reflect.get(workspace, 'verifyTaskSet').bind(workspace) as (
        repository: string, branches: readonly { branch: string; expectedCommit?: string }[],
        integrationCommit: string, baseCommit: string,
      ) => Promise<void>

      const base = git(ws, ['rev-parse', 'HEAD'])
      git(ws, ['switch', '-c', 'a', 'main'])
      execFileSync('git', ['-C', ws, 'commit', '--allow-empty', '-m', 'a'])
      const a = git(ws, ['rev-parse', 'HEAD'])
      // B starts from A's commit, so B's history already contains A.
      git(ws, ['switch', '-c', 'b'])
      execFileSync('git', ['-C', ws, 'commit', '--allow-empty', '-m', 'b'])
      const b = git(ws, ['rev-parse', 'HEAD'])
      git(ws, ['switch', 'main'])
      git(ws, ['switch', '-c', 'int'])
      execFileSync('git', ['-C', ws, 'merge', '--no-ff', '--no-edit', 'b'], { stdio: 'ignore' })
      const integration = git(ws, ['rev-parse', 'HEAD'])
      await expect(verify(ws, [
        { branch: 'a', expectedCommit: a }, { branch: 'b', expectedCommit: b },
      ], integration, base)).resolves.toBeUndefined()
      void remote
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
