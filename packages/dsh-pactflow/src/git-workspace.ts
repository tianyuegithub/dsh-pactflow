/** Host-owned Git checkout, task branch, and worktree operations. */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  BindPactFlowGitRequest,
  PactFlowGitBinding,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowNode,
  PactFlowRunId,
} from './types.ts'

const GIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/

/** Git operations used by the PactFlow Host; commands never use a shell. */
export class PactFlowGitWorkspace {
  private readonly worktreeRoot = join(resolveDshHome(), 'pactflow', 'worktrees')

  /** Validate and snapshot one credential-free remote binding. */
  async inspectBinding(
    workspace: string | undefined,
    request: BindPactFlowGitRequest,
  ): Promise<Omit<PactFlowGitBinding, 'revision' | 'boundAt'>> {
    const root = await this.requireWorkspaceRoot(workspace)
    const remote = this.gitName('remote', request.remote)
    const defaultBranch = this.gitName('default branch', request.defaultBranch)
    const remoteUrl = this.credentialFreeRemote(await this.git(root, ['remote', 'get-url', remote]))
    await this.git(root, ['rev-parse', '--verify', `refs/remotes/${remote}/${defaultBranch}^{commit}`])
    return { remote, remoteUrl, defaultBranch }
  }

  /** Build an immutable Run spec from the current remote-tracking baseline. */
  async plan(
    workspace: string | undefined,
    sessionId: string,
    runId: PactFlowRunId,
    node: PactFlowNode,
    binding: PactFlowGitBinding,
  ): Promise<PactFlowGitRunSpec> {
    const root = await this.requireWorkspaceRoot(workspace)
    const currentUrl = this.credentialFreeRemote(await this.git(root, ['remote', 'get-url', binding.remote]))
    if (currentUrl !== binding.remoteUrl) throw new Error('PactFlow Git remote URL changed after project binding')
    const baseCommit = await this.git(root, [
      'rev-parse', '--verify', `refs/remotes/${binding.remote}/${binding.defaultBranch}^{commit}`,
    ])
    const suffix = runId.slice('run-'.length, 'run-'.length + 12)
    const branch = `pactflow/${node.needId}/${node.id}/${suffix}`
    await this.git(root, ['check-ref-format', '--branch', branch])
    const projectKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
    const worktreePath = join(this.worktreeRoot, projectKey, runId)
    return {
      remote: binding.remote,
      remoteUrl: binding.remoteUrl,
      defaultBranch: binding.defaultBranch,
      baseCommit,
      branch,
      worktreePath,
    }
  }

  /** Materialize the exact branch and worktree named by a claimed Run. */
  async materialize(workspace: string | undefined, spec: PactFlowGitRunSpec): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (await this.exists(spec.worktreePath)) throw new Error('PactFlow Git worktree path already exists')
    await mkdir(dirname(spec.worktreePath), { recursive: true, mode: 0o700 })
    await this.git(root, ['worktree', 'add', '-b', spec.branch, spec.worktreePath, spec.baseCommit])
    const branch = await this.git(spec.worktreePath, ['branch', '--show-current'])
    const commit = await this.git(spec.worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (branch !== spec.branch || commit !== spec.baseCommit) {
      throw new Error('PactFlow Git worktree materialized with unexpected identity')
    }
  }

  /** Accept only a clean descendant commit on the Host-selected task branch. */
  async validateResult(spec: PactFlowGitRunSpec): Promise<PactFlowGitResult> {
    const branch = await this.git(spec.worktreePath, ['branch', '--show-current'])
    if (branch !== spec.branch) throw new Error('PactFlow Worker changed the Host-owned task branch')
    const dirty = await this.git(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (dirty.length > 0) throw new Error('PactFlow Worker left uncommitted changes in its worktree')
    const commit = await this.git(spec.worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (commit === spec.baseCommit) throw new Error('PactFlow Worker produced no commit')
    try {
      await this.git(spec.worktreePath, ['merge-base', '--is-ancestor', spec.baseCommit, commit])
    } catch {
      throw new Error('PactFlow Worker commit is not descended from the Run baseline')
    }
    return { branch, commit }
  }

  private async requireWorkspaceRoot(workspace: string | undefined): Promise<string> {
    if (workspace === undefined || !isAbsolute(workspace)) {
      throw new Error('PactFlow Git operations require an absolute Session workspace')
    }
    const workspacePath = await realpath(workspace)
    const root = await realpath(await this.git(workspacePath, ['rev-parse', '--show-toplevel']))
    if (root !== workspacePath) throw new Error('PactFlow Session workspace must be the Git checkout root')
    return root
  }

  private gitName(label: string, value: string): string {
    const normalized = value.trim()
    if (!GIT_NAME.test(normalized) || normalized.includes('..') || normalized.endsWith('/')) {
      throw new Error(`PactFlow Git ${label} is invalid`)
    }
    return normalized
  }

  private credentialFreeRemote(value: string): string {
    const remote = value.trim()
    if (remote.length === 0 || /[\r\n]/.test(remote)) throw new Error('PactFlow Git remote URL is invalid')
    if (isAbsolute(remote)) return remote
    if (/^[^\s@]+@[^\s:]+:[^\s?#]+$/.test(remote)) return remote
    let parsed: URL
    try {
      parsed = new URL(remote)
    } catch {
      throw new Error('PactFlow Git remote URL must be an absolute path, scp URL, or supported URL')
    }
    if (!['http:', 'https:', 'ssh:', 'file:'].includes(parsed.protocol)
      || parsed.password !== '' || parsed.search !== '' || parsed.hash !== ''
      || ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.username !== '')) {
      throw new Error('PactFlow Git remote URL must not embed credentials, query parameters, or fragments')
    }
    return remote
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await lstat(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private git(cwd: string, args: readonly string[]): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }, (error, stdout) => {
        if (error !== null) {
          reject(new Error(`PactFlow Git command failed: ${args[0] ?? 'unknown'}`))
          return
        }
        resolveOutput(stdout.trim())
      })
    })
  }
}
