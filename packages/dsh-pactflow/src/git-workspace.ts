/** Host-owned Git checkout, task branch, and worktree operations. */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  BindPactFlowGitRequest,
  PactFlowGitAuth,
  PactFlowGitBinding,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowNode,
  PactFlowRunId,
  PactFlowValidationCommand,
  PactFlowValidationEvidence,
} from './types.ts'

const GIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
const K8S_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

export interface PactFlowGitAuthSecret {
  readonly username: string
  readonly token: string
}

interface PactFlowGitCommitEvidence {
  readonly branch: string
  readonly commit: string
  readonly validations: readonly PactFlowValidationEvidence[]
}

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
    const auth = this.auth(remoteUrl, request)
    const k3sGitSecretName = request.k3sGitSecretName?.trim()
    if (k3sGitSecretName !== undefined && !K8S_NAME.test(k3sGitSecretName)) {
      throw new Error('PactFlow K3s Git Secret name is invalid')
    }
    return {
      remote,
      remoteUrl,
      defaultBranch,
      validationCommands: this.validationCommands(request.validationCommands ?? []),
      ...auth === undefined ? {} : { auth },
      ...k3sGitSecretName === undefined ? {} : { k3sGitSecretName },
    }
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
      validationCommands: binding.validationCommands,
      ...binding.auth === undefined ? {} : { auth: binding.auth },
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

  /** Validate a clean commit, run Host commands, then prove the commit and tree stayed unchanged. */
  async validateResult(spec: PactFlowGitRunSpec): Promise<PactFlowGitCommitEvidence> {
    const before = await this.validateCommit(spec)
    const validations: PactFlowValidationEvidence[] = []
    for (const command of spec.validationCommands) {
      validations.push(await this.runValidation(spec.worktreePath, command))
    }
    const after = await this.validateCommit(spec)
    if (after.commit !== before.commit) throw new Error('PactFlow validation changed the Worker commit')
    return { ...after, validations }
  }

  private async validateCommit(spec: PactFlowGitRunSpec): Promise<Omit<PactFlowGitCommitEvidence, 'validations'>> {
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

  /** Push the task branch, fetch it through the root checkout, and bind the final commit. */
  async syncResult(
    workspace: string | undefined,
    spec: PactFlowGitRunSpec,
    result: PactFlowGitCommitEvidence,
    secret?: PactFlowGitAuthSecret,
  ): Promise<PactFlowGitResult> {
    const root = await this.requireWorkspaceRoot(workspace)
    if ((spec.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the Run spec')
    }
    await this.withAuthentication(secret, async (environment) => {
      await this.git(spec.worktreePath, [
        'push', '--porcelain', spec.remote, `HEAD:refs/heads/${spec.branch}`,
      ], environment)
      await this.git(root, [
        'fetch', '--no-tags', spec.remote,
        `refs/heads/${spec.branch}:refs/remotes/${spec.remote}/${spec.branch}`,
      ], environment)
    })
    const remoteRef = `refs/remotes/${spec.remote}/${spec.branch}`
    const fetched = await this.git(root, ['rev-parse', '--verify', `${remoteRef}^{commit}`])
    if (fetched !== result.commit) throw new Error('PactFlow fetched task commit differs from the Worker result')
    return { ...result, remoteRef, syncedAt: Date.now() }
  }

  /** Fetch a remote Worker branch, fast-forward its local worktree, and validate it. */
  async acceptRemoteResult(
    workspace: string | undefined,
    spec: PactFlowGitRunSpec,
    remoteCommit: string,
    secret?: PactFlowGitAuthSecret,
  ): Promise<PactFlowGitResult> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (!/^[0-9a-f]{40,64}$/.test(remoteCommit)) throw new Error('PactFlow remote Worker commit is invalid')
    if ((spec.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the Run spec')
    }
    const remoteRef = `refs/remotes/${spec.remote}/${spec.branch}`
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, [
        'fetch', '--no-tags', spec.remote,
        `refs/heads/${spec.branch}:${remoteRef}`,
      ], environment)
    })
    const fetched = await this.git(root, ['rev-parse', '--verify', `${remoteRef}^{commit}`])
    if (fetched !== remoteCommit) throw new Error('PactFlow fetched task commit differs from the remote Worker result')
    try {
      await this.git(root, ['merge-base', '--is-ancestor', spec.baseCommit, fetched])
    } catch {
      throw new Error('PactFlow remote Worker commit is not descended from the Run baseline')
    }
    await this.git(spec.worktreePath, ['merge', '--ff-only', remoteRef])
    const result = await this.validateResult(spec)
    if (result.commit !== remoteCommit) throw new Error('PactFlow local worktree differs from the remote Worker commit')
    return { ...result, remoteRef, syncedAt: Date.now() }
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

  private validationCommands(input: readonly PactFlowValidationCommand[]): readonly PactFlowValidationCommand[] {
    if (input.length > 16) throw new Error('PactFlow Git validationCommands may contain at most 16 commands')
    return input.map((candidate) => {
      const command = candidate.command.trim()
      if (command.length === 0 || command.length > 256 || /[\0\r\n]/.test(command)
        || candidate.args.length > 64
        || !Number.isSafeInteger(candidate.timeoutMs) || candidate.timeoutMs < 1_000 || candidate.timeoutMs > 3_600_000
        || candidate.args.some(argument => argument.length > 4_096 || /[\0\r\n]/.test(argument))) {
        throw new Error('PactFlow Git validation command is invalid')
      }
      return { command, args: [...candidate.args], timeoutMs: candidate.timeoutMs }
    })
  }

  private auth(remoteUrl: string, request: BindPactFlowGitRequest): PactFlowGitAuth | undefined {
    const username = request.username?.trim()
    const credentialRef = request.credentialRef?.trim()
    if ((username === undefined) !== (credentialRef === undefined)
      || username === '' || credentialRef === '') {
      throw new Error('PactFlow Git username and credentialRef must be configured together')
    }
    if (username === undefined || credentialRef === undefined) return undefined
    if (isAbsolute(remoteUrl) || /^[^\s@]+@[^\s:]+:/.test(remoteUrl)) {
      throw new Error('PactFlow Git token authentication requires an HTTP(S) remote')
    }
    const protocol = new URL(remoteUrl).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error('PactFlow Git token authentication requires an HTTP(S) remote')
    }
    return { kind: 'https-token', username, credentialRef }
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

  private async withAuthentication<T>(
    secret: PactFlowGitAuthSecret | undefined,
    operation: (environment: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    if (secret === undefined) return await operation({ ...process.env, GIT_TERMINAL_PROMPT: '0' })
    const authRoot = join(resolveDshHome(), 'pactflow', 'auth')
    await mkdir(authRoot, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(authRoot, 'git-'))
    await chmod(directory, 0o700)
    const program = join(directory, 'askpass.cjs')
    await writeFile(program, [
      "const prompt = process.argv[2] ?? ''",
      "const value = /username/i.test(prompt) ? process.env.PACTFLOW_GIT_USERNAME : process.env.PACTFLOW_GIT_TOKEN",
      "if (value === undefined) process.exit(1)",
      "process.stdout.write(`${value}\\n`)",
      '',
    ].join('\n'), { mode: 0o600 })
    const askpass = join(directory, process.platform === 'win32' ? 'askpass.cmd' : 'askpass')
    const wrapper = process.platform === 'win32'
      ? '@echo off\r\n"%PACTFLOW_NODE%" "%~dp0askpass.cjs" "%~1"\r\n'
      : '#!/bin/sh\nexec "$PACTFLOW_NODE" "$(dirname "$0")/askpass.cjs" "$1"\n'
    await writeFile(askpass, wrapper, { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(askpass, 0o700)
    try {
      return await operation({
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: askpass,
        GIT_ASKPASS_REQUIRE: 'force',
        PACTFLOW_NODE: process.execPath,
        PACTFLOW_GIT_USERNAME: secret.username,
        PACTFLOW_GIT_TOKEN: secret.token,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private runValidation(
    cwd: string,
    validation: PactFlowValidationCommand,
  ): Promise<PactFlowValidationEvidence> {
    const startedAt = Date.now()
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/(?:KEY|SECRET|TOKEN|PASSWORD)/i.test(name)))
    return new Promise((resolveEvidence, reject) => {
      execFile(validation.command, validation.args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: validation.timeoutMs,
        env: { ...environment, CI: '1', GIT_TERMINAL_PROMPT: '0' },
      }, (error) => {
        if (error !== null) {
          const exitCode = typeof error.code === 'number' ? error.code : 'unavailable'
          reject(new Error(`PactFlow validation command failed (${validation.command}, exit ${String(exitCode)})`))
          return
        }
        resolveEvidence({ ...validation, exitCode: 0, durationMs: Date.now() - startedAt })
      })
    })
  }

  private git(cwd: string, args: readonly string[], environment?: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: environment ?? { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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
