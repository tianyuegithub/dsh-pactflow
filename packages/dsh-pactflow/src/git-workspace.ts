/** Host-owned Git checkout, task branch, and worktree operations. */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  BindPactFlowGitRequest,
  PactFlowGitAuth,
  PactFlowGiteaBinding,
  PactFlowGitBinding,
  PactFlowClosingGit,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowNode,
  PactFlowRunId,
  PactFlowValidationCommand,
  PactFlowValidationEvidence,
} from './types.ts'

const GIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
const K8S_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const VALIDATION_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CI', 'GIT_TERMINAL_PROMPT',
] as const

export interface PactFlowGitAuthSecret {
  readonly username: string
  readonly token: string
}

interface PactFlowGitCommitEvidence {
  readonly branch: string
  readonly commit: string
  readonly validations: readonly PactFlowValidationEvidence[]
}

export interface PactFlowClosingTaskRef {
  readonly remoteRef: string
  readonly expectedCommit: string
}

/** Keep validation subprocesses deterministic and prevent ambient credential leakage. */
function minimalValidationEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of VALIDATION_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  environment.CI = '1'
  environment.GIT_TERMINAL_PROMPT = '0'
  return environment
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
    const gitea = this.gitea(request)
    const rawValidationCommands = this.validationCommands(request.validationCommands ?? [])
    const legacyUntrusted = request.validationProfileIds === undefined && rawValidationCommands.length > 0
    return {
      remote,
      remoteUrl,
      defaultBranch,
      validationCommands: rawValidationCommands,
      ...(request.validationProfileIds === undefined ? {} : {
        validationProfileIds: [...new Set(request.validationProfileIds.map(value => value.trim()).filter(Boolean))],
      }),
      ...(legacyUntrusted ? { legacyUntrusted: true } : {}),
      ...auth === undefined ? {} : { auth },
      ...k3sGitSecretName === undefined ? {} : { k3sGitSecretName },
      ...gitea === undefined ? {} : { gitea },
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
      ...(binding.validationProfileIds === undefined ? {} : { validationProfileIds: [...binding.validationProfileIds] }),
      ...(binding.validationProfileRevisions === undefined ? {} : { validationProfileRevisions: { ...binding.validationProfileRevisions } }),
      ...(binding.legacyUntrusted === true || (binding.validationProfileIds === undefined && binding.validationCommands.length > 0)
        ? { legacyUntrusted: true } : {}),
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

  /** Merge verified task refs on an isolated integration branch and push it for PR creation. */
  async prepareClosing(
    workspace: string | undefined,
    sessionId: string,
    needId: string,
    needRevision: number,
    binding: PactFlowGitBinding,
    remoteRefs: readonly (string | PactFlowClosingTaskRef)[],
    secret?: PactFlowGitAuthSecret,
  ): Promise<PactFlowClosingGit> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (remoteRefs.length === 0) throw new Error('PactFlow closing requires at least one task branch')
    if ((binding.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the project binding')
    }
    const prefix = `refs/remotes/${binding.remote}/`
    const taskRefs = remoteRefs.map(value => typeof value === 'string'
      ? { remoteRef: value, expectedCommit: undefined }
      : value)
    const uniqueTaskRefs = new Map(taskRefs.map(item => [item.remoteRef, item]))
    if (uniqueTaskRefs.size !== taskRefs.length) throw new Error('PactFlow closing task refs must be unique')
    const branches = [...uniqueTaskRefs.values()]
      .sort((left, right) => left.remoteRef.localeCompare(right.remoteRef)).map((item) => {
        if (!item.remoteRef.startsWith(prefix)) throw new Error('PactFlow closing received a foreign task ref')
        if (item.expectedCommit !== undefined && !/^[0-9a-f]{40,64}$/.test(item.expectedCommit)) {
          throw new Error('PactFlow closing received an invalid expected task commit')
        }
        return {
          branch: item.remoteRef.slice(prefix.length),
          ...(item.expectedCommit === undefined ? {} : { expectedCommit: item.expectedCommit }),
        }
      })
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, [
        'fetch', '--no-tags', binding.remote,
        `refs/heads/${binding.defaultBranch}:refs/remotes/${binding.remote}/${binding.defaultBranch}`,
      ], environment)
      for (const task of branches) {
        await this.git(root, [
          'fetch', '--no-tags', binding.remote,
          `refs/heads/${task.branch}:refs/remotes/${binding.remote}/${task.branch}`,
        ], environment)
      }
    })
    const baseCommit = await this.git(root, [
      'rev-parse', '--verify', `refs/remotes/${binding.remote}/${binding.defaultBranch}^{commit}`,
    ])
    const suffix = `r${String(needRevision)}`
    const branch = `pactflow/closing/${needId}/${suffix}`
    await this.git(root, ['check-ref-format', '--branch', branch])
    const projectKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
    const worktreePath = join(this.worktreeRoot, 'closing', projectKey, suffix)
    const remoteClosingRef = `refs/remotes/${binding.remote}/${branch}`
    const existingRemote = await this.withAuthentication(secret, async environment =>
      this.git(root, ['ls-remote', '--heads', binding.remote, branch], environment))
    if (existingRemote.length > 0) {
      await this.withAuthentication(secret, async (environment) => {
        await this.git(root, [
          'fetch', '--no-tags', binding.remote, `refs/heads/${branch}:${remoteClosingRef}`,
        ], environment)
      })
      const commit = await this.git(root, ['rev-parse', '--verify', `${remoteClosingRef}^{commit}`])
      await this.verifyTaskTips(root, prefix, branches, commit)
      await this.verifyTaskSet(root, branches, commit)
      if (!await this.exists(worktreePath)) {
        const localBranch = await this.git(root, ['branch', '--list', branch])
        await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 })
        await this.git(root, localBranch.length > 0
          ? ['worktree', 'add', worktreePath, branch]
          : ['worktree', 'add', '-b', branch, worktreePath, commit])
      }
      return { branch, commit, worktreePath }
    }
    if (await this.exists(worktreePath) || (await this.git(root, ['branch', '--list', branch])).length > 0) {
      throw new Error('PactFlow found an unpushed local closing attempt; clean it before retry')
    }
    await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 })
    await this.git(root, ['worktree', 'add', '-b', branch, worktreePath, baseCommit])
    for (const task of branches) {
      const taskRef = `${prefix}${task.branch}`
      const taskCommit = await this.git(root, ['rev-parse', '--verify', `${taskRef}^{commit}`])
      if (task.expectedCommit !== undefined && taskCommit !== task.expectedCommit) {
        throw new Error(`PactFlow task branch ${task.branch} changed after verification`)
      }
      await this.git(worktreePath, ['merge', '--no-ff', '--no-edit', taskRef])
    }
    const result = await this.validateResult({
      remote: binding.remote,
      remoteUrl: binding.remoteUrl,
      defaultBranch: binding.defaultBranch,
      baseCommit,
      branch,
      worktreePath,
      validationCommands: binding.validationCommands,
      ...(binding.validationProfileIds === undefined ? {} : { validationProfileIds: [...binding.validationProfileIds] }),
      ...(binding.validationProfileRevisions === undefined ? {} : { validationProfileRevisions: { ...binding.validationProfileRevisions } }),
      ...(binding.legacyUntrusted === true ? { legacyUntrusted: true } : {}),
      ...binding.auth === undefined ? {} : { auth: binding.auth },
    })
    await this.verifyTaskSet(worktreePath, branches, result.commit)
    await this.withAuthentication(secret, async (environment) => {
      await this.git(worktreePath, [
        'push', '--porcelain', binding.remote, `HEAD:refs/heads/${branch}`,
      ], environment)
    })
    return { branch, commit: result.commit, worktreePath }
  }

  private async verifyTaskTips(
    root: string,
    prefix: string,
    branches: readonly { readonly branch: string; readonly expectedCommit?: string }[],
    integrationCommit: string,
  ): Promise<void> {
    for (const task of branches) {
      const taskRef = `${prefix}${task.branch}`
      const taskCommit = await this.git(root, ['rev-parse', '--verify', `${taskRef}^{commit}`])
      if (task.expectedCommit !== undefined && taskCommit !== task.expectedCommit) {
        throw new Error(`PactFlow task branch ${task.branch} changed after verification`)
      }
      try {
        await this.git(root, ['merge-base', '--is-ancestor', taskCommit, integrationCommit])
      } catch {
        throw new Error(`PactFlow integration branch does not contain verified task ${task.branch}`)
      }
    }
  }

  /** Verify the integration branch still contains exactly the expected merge set. */
  private async verifyTaskSet(
    repository: string,
    branches: readonly { readonly branch: string; readonly expectedCommit?: string }[],
    integrationCommit: string,
  ): Promise<void> {
    const expected = branches.map(task => task.expectedCommit).filter((commit): commit is string => commit !== undefined)
    if (expected.length === 0) return
    const lines = await this.git(repository, ['log', '--first-parent', '--format=%P', integrationCommit])
    const merged = new Set<string>()
    for (const line of lines.split('\n')) {
      const parents = line.trim().split(/\s+/u).filter(Boolean)
      if (parents.length >= 2) merged.add(parents[1]!)
    }
    const expectedSet = new Set(expected)
    if (merged.size !== expectedSet.size || [...expectedSet].some(commit => !merged.has(commit))) {
      throw new Error('PactFlow integration branch task-set digest changed after verification')
    }
  }

  /** Fetch the default branch after Gitea merge and require the integration commit in its ancestry. */
  async verifyClosingMerged(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    integrationCommit: string,
    secret?: PactFlowGitAuthSecret,
  ): Promise<string> {
    const root = await this.requireWorkspaceRoot(workspace)
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, [
        'fetch', '--no-tags', binding.remote,
        `refs/heads/${binding.defaultBranch}:refs/remotes/${binding.remote}/${binding.defaultBranch}`,
      ], environment)
    })
    const merged = await this.git(root, [
      'rev-parse', '--verify', `refs/remotes/${binding.remote}/${binding.defaultBranch}^{commit}`,
    ])
    try {
      await this.git(root, ['merge-base', '--is-ancestor', integrationCommit, merged])
    } catch {
      throw new Error('PactFlow Gitea default branch does not contain the integration commit')
    }
    return merged
  }

  /** Remove only the clean local worktree and branch created for closing. */
  async cleanupClosing(workspace: string | undefined, closing: PactFlowClosingGit): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    const dirty = await this.git(closing.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (dirty.length > 0) throw new Error('PactFlow closing worktree is not clean')
    await this.git(root, ['worktree', 'remove', closing.worktreePath])
    await this.git(root, ['branch', '-D', closing.branch])
  }

  /** Remove one merged task branch from the remote and its clean local worktree. */
  async cleanupTaskRun(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    spec: PactFlowGitRunSpec,
    secret?: PactFlowGitAuthSecret,
  ): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    if ((binding.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the project binding')
    }
    const dirty = await this.git(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (dirty.length > 0) throw new Error(`PactFlow task worktree ${spec.branch} is not clean`)
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, ['push', '--porcelain', binding.remote, `:refs/heads/${spec.branch}`], environment)
    })
    await this.git(root, ['worktree', 'remove', spec.worktreePath])
    await this.git(root, ['branch', '-D', spec.branch])
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

  private gitea(request: BindPactFlowGitRequest): PactFlowGiteaBinding | undefined {
    const fields = [
      request.giteaBaseUrl, request.giteaOwner, request.giteaRepo, request.giteaTokenCredentialRef,
    ]
    if (fields.every(value => value === undefined)) return undefined
    if (fields.some(value => value === undefined || value.trim() === '')) {
      throw new Error('PactFlow Gitea baseUrl, owner, repo, and tokenCredentialRef must be configured together')
    }
    const [rawBaseUrl, rawOwner, rawRepo, rawRef] = fields as [string, string, string, string]
    let parsed: URL
    try {
      parsed = new URL(rawBaseUrl)
    } catch {
      throw new Error('PactFlow Gitea baseUrl must be an HTTP(S) URL')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== ''
      || parsed.search !== '' || parsed.hash !== '') {
      throw new Error('PactFlow Gitea baseUrl must be credential-free')
    }
    const owner = rawOwner.trim()
    const repo = rawRepo.trim()
    const username = request.giteaUsername?.trim()
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
      throw new Error('PactFlow Gitea owner and repo are invalid')
    }
    if (username === '') throw new Error('PactFlow Gitea username must be non-empty when configured')
    return {
      baseUrl: parsed.toString().replace(/\/$/, ''),
      owner,
      repo,
      tokenCredentialRef: rawRef.trim(),
      ...username === undefined ? {} : { username },
    }
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
    const environment = minimalValidationEnvironment()
    return new Promise((resolveEvidence, reject) => {
      execFile(validation.command, validation.args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: validation.timeoutMs,
        shell: false,
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
