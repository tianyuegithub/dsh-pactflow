/** Host-owned Git checkout, task branch, and worktree operations. */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { validationSensitiveChanges } from './validation-integrity.ts'
import { applyRecovery, assertLocalCheckout, captureRecovery, isolatedGit, isWithin, localGitEnvironment, localMavenCache, materializeLocalCheckout, protectedGitArgs, type RecoverySnapshot } from './local-workspace.ts'
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
const COMMIT = /^[0-9a-f]{40,64}$/
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
  readonly validationSensitiveChanges?: readonly string[]
}

export interface PactFlowClosingTaskRef {
  readonly remoteRef: string
  readonly expectedCommit: string
}

/** The persisted snapshot is not authority; callers must resolve user-owned profiles. */
export function assertPactFlowValidationAuthorization(
  snapshot: Pick<PactFlowGitRunSpec, 'validationCommands' | 'legacyUntrusted'>,
  authorizedCommands: readonly PactFlowValidationCommand[],
): void {
  if (snapshot.legacyUntrusted === true || snapshot.validationCommands.length !== authorizedCommands.length
    || snapshot.validationCommands.some((command, index) => {
      const authorized = authorizedCommands[index]!
      return command.command !== authorized.command || command.timeoutMs !== authorized.timeoutMs
        || command.args.length !== authorized.args.length
        || command.args.some((argument, offset) => argument !== authorized.args[offset])
    })) {
    throw new Error('PactFlow validation commands lack current registry authorization; rebind the project')
  }
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
    authorizedCommands: readonly PactFlowValidationCommand[] = [],
  ): Promise<Omit<PactFlowGitBinding, 'revision' | 'boundAt'>> {
    if ((request.validationCommands?.length ?? 0) > 0) throw new Error('PactFlow raw validation commands are not allowed; select registered profile IDs')
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
    const commands = this.validationCommands(authorizedCommands)
    return {
      remote,
      remoteUrl,
      defaultBranch,
      validationCommands: commands,
      ...(request.validationProfileIds === undefined ? {} : {
        validationProfileIds: [...new Set(request.validationProfileIds.map(value => value.trim()).filter(Boolean))],
      }),
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
    codeInputs: readonly { readonly dependency?: string; readonly branch: string; readonly commit: string }[] = [],
    checkoutKind?: 'isolated-clone',
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
      ...(checkoutKind === undefined ? {} : { checkoutKind }),
      remote: binding.remote,
      remoteUrl: binding.remoteUrl,
      defaultBranch: binding.defaultBranch,
      baseCommit,
      // F03: predecessor code inputs become part of this Run's immutable execution
      // baseline, fetched by exact commit so no moving branch can drift underneath.
      ...(codeInputs.length === 0 ? {} : { codeInputs: codeInputs.map(input => ({
        ...input.dependency === undefined ? {} : { dependency: input.dependency },
        branch: input.branch, commit: input.commit,
      })) }),
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

  /**
   * Materialize the exact branch and worktree named by a claimed Run.
   *
   * Local Workers run *in* this worktree, so declared code inputs are folded here.
   * A remote (K3s) Worker instead receives the exact input commits and folds them
   * inside its own container (it alone holds the Git credentials there); the local
   * worktree then only needs to fast-forward to the returned commit, so folding is
   * suppressed to keep that fast-forward exact.
   */
  async materialize(
    workspace: string | undefined,
    spec: PactFlowGitRunSpec,
    options: { readonly foldCodeInputs?: boolean } = {},
  ): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (await this.exists(spec.worktreePath)) throw new Error('PactFlow Git worktree path already exists')
    await mkdir(dirname(spec.worktreePath), { recursive: true, mode: 0o700 })
    if (spec.checkoutKind === 'isolated-clone') {
      await materializeLocalCheckout(root, spec)
      return
    }
    await this.git(root, ['worktree', 'add', '-b', spec.branch, spec.worktreePath, spec.baseCommit])
    // F03: fold each declared code input (exact predecessor commit) into the task
    // baseline before the Worker starts, so a dependent task can build on it.
    if (options.foldCodeInputs !== false) {
      for (const input of spec.codeInputs ?? []) {
        try {
          await this.git(root, ['fetch', '--no-tags', spec.remote, input.commit])
        } catch {
          throw new Error(`PactFlow code input ${input.branch} is not available at ${input.commit}`)
        }
        try {
          await this.git(spec.worktreePath, ['merge', '--no-ff', '--no-edit', input.commit])
        } catch {
          throw new Error(`PactFlow code input ${input.branch} conflicts with the task baseline`)
        }
      }
    }
    const branch = await this.git(spec.worktreePath, ['branch', '--show-current'])
    const commit = await this.git(spec.worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (branch !== spec.branch) {
      throw new Error('PactFlow Git worktree materialized with unexpected identity')
    }
    // The Worktree HEAD now includes the code inputs; the Worker's commit must still
    // descend from this combined baseline.
    const expectedBase = await this.git(spec.worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (commit !== expectedBase) throw new Error('PactFlow Git worktree materialized with unexpected identity')
  }

  /** Validate a clean commit, run Host commands, then prove the commit and tree stayed unchanged. */
  async validateResult(spec: PactFlowGitRunSpec, authorizedCommands: readonly PactFlowValidationCommand[] = [], signal?: AbortSignal): Promise<PactFlowGitCommitEvidence> {
    assertPactFlowValidationAuthorization(spec, authorizedCommands)
    const commands = this.validationCommands(authorizedCommands)
    const before = await this.validateCommit(spec)
    const validations: PactFlowValidationEvidence[] = []
    for (const command of commands) {
      const effective = spec.checkoutKind === 'isolated-clone' && /^mvn(?:\.cmd)?$/.test(basename(command.command))
        ? { ...command, args: [...command.args, `-Dmaven.repo.local=${localMavenCache(spec)}`] } : command
      validations.push(await this.runValidation(spec.worktreePath, effective, signal, spec.checkoutKind === 'isolated-clone' ? localMavenCache(spec) : undefined))
    }
    const after = await this.validateCommit(spec)
    if (after.commit !== before.commit) throw new Error('PactFlow validation changed the Worker commit')
    // Surface (do not block on) task commits that rewrite the verification wiring.
    let sensitive: readonly string[] = []
    try {
      const inspect = spec.checkoutKind === 'isolated-clone' ? isolatedGit : this.git.bind(this)
      const diff = await inspect(spec.worktreePath, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', `${before.commit}~1..${before.commit}`])
      sensitive = validationSensitiveChanges(diff)
    } catch { sensitive = [] }
    return { ...after, validations, ...(sensitive.length === 0 ? {} : { validationSensitiveChanges: sensitive }) }
  }

  private async validateCommit(spec: PactFlowGitRunSpec): Promise<Omit<PactFlowGitCommitEvidence, 'validations'>> {
    if (spec.checkoutKind === 'isolated-clone') await assertLocalCheckout(spec)
    const inspect = spec.checkoutKind === 'isolated-clone' ? isolatedGit : this.git.bind(this)
    const branch = await inspect(spec.worktreePath, ['branch', '--show-current'])
    if (branch !== spec.branch) throw new Error('PactFlow Worker changed the Host-owned task branch')
    const dirty = await inspect(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (dirty.length > 0) throw new Error('PactFlow Worker left uncommitted changes in its worktree')
    const commit = await inspect(spec.worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (commit === spec.baseCommit) throw new Error('PactFlow Worker produced no commit')
    try {
      await inspect(spec.worktreePath, ['merge-base', '--is-ancestor', spec.baseCommit, commit])
    } catch {
      throw new Error('PactFlow Worker commit is not descended from the Run baseline')
    }
    return { branch, commit }
  }

  async recoverySnapshot(workspace: string | undefined, runId: string, spec: PactFlowGitRunSpec): Promise<RecoverySnapshot> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (!isWithin(resolve(this.worktreeRoot), resolve(spec.worktreePath))
      || !isWithin(await realpath(this.worktreeRoot), await realpath(spec.worktreePath))) throw new Error('候选不属于宿主管理目录')
    if (spec.checkoutKind === 'isolated-clone') await assertLocalCheckout(spec)
    else if (await realpath(await isolatedGit(spec.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
      !== await realpath(await isolatedGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))) throw new Error('候选 Git 元数据归属不匹配')
    return await captureRecovery(runId, spec)
  }

  async loadRecovery(spec: PactFlowGitRunSpec, input: RecoverySnapshot): Promise<void> {
    await applyRecovery(spec, input)
  }

  async metadataPath(workspace: string | undefined): Promise<string> {
    return await isolatedGit(await this.requireWorkspaceRoot(workspace), ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  }

  /** Push the task branch, fetch it through the root checkout, and bind the final commit. */
  async syncResult(
    workspace: string | undefined,
    spec: PactFlowGitRunSpec,
    result: PactFlowGitCommitEvidence,
    secret?: PactFlowGitAuthSecret,
    signal?: AbortSignal,
  ): Promise<PactFlowGitResult> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (spec.checkoutKind === 'isolated-clone') {
      await assertLocalCheckout(spec)
      if (this.credentialFreeRemote(await this.git(root, ['remote', 'get-url', spec.remote])) !== spec.remoteUrl) throw new Error('主仓远程身份变化，拒绝同步本地任务')
    }
    if ((spec.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the Run spec')
    }
    await this.withAuthentication(secret, async (environment) => {
      signal?.throwIfAborted()
      const isolated = spec.checkoutKind === 'isolated-clone'
      const target = isolated ? spec.remoteUrl : spec.remote
      const effectiveEnvironment = isolated ? localGitEnvironment(environment) : environment
      const args = (values: string[]) => isolated ? protectedGitArgs(values) : values
      await this.git(spec.worktreePath, args([
        'push', '--porcelain', target, `HEAD:refs/heads/${spec.branch}`,
      ]), effectiveEnvironment, signal)
      await this.git(root, args([
        'fetch', '--no-tags', target,
        `refs/heads/${spec.branch}:refs/remotes/${spec.remote}/${spec.branch}`,
      ]), effectiveEnvironment)
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
    authorizedCommands: readonly PactFlowValidationCommand[] = [],
  ): Promise<PactFlowGitResult> {
    assertPactFlowValidationAuthorization(spec, authorizedCommands)
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
    const result = await this.validateResult(spec, authorizedCommands)
    if (result.commit !== remoteCommit) throw new Error('PactFlow local worktree differs from the remote Worker commit')
    return { ...result, remoteRef, syncedAt: Date.now() }
  }

  /** Verify exact remote task tips without recreating an already-merged integration. */
  async verifyClosingTaskRefs(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    tasks: readonly PactFlowClosingTaskRef[],
    secret?: PactFlowGitAuthSecret,
  ): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    const prefix = `refs/remotes/${binding.remote}/`
    if (this.credentialFreeRemote(await this.git(root, ['remote', 'get-url', binding.remote])) !== binding.remoteUrl) {
      throw new Error('PactFlow closing remote URL changed')
    }
    await this.withAuthentication(secret, async environment => {
      for (const task of tasks) {
        if (!task.remoteRef.startsWith(prefix)) throw new Error('PactFlow closing received a foreign task ref')
        const branch = this.gitName('task branch', task.remoteRef.slice(prefix.length))
        const ref = `refs/heads/${branch}`
        const remote = await this.git(root, ['ls-remote', '--heads', binding.remote, ref], environment)
        const tip = remote.split('\n').map(line => line.split(/\s+/)).find(([, name]) => name === ref)?.[0]
        if (tip !== task.expectedCommit) throw new Error('PactFlow task branch changed after verification')
      }
    })
  }

  /** Merge verified task refs on an isolated integration branch and push it for PR creation. */
  async prepareClosing(
    workspace: string | undefined,
    sessionId: string,
    needId: string,
    needRevision: number,
    binding: PactFlowGitBinding,
    remoteRefs: readonly PactFlowClosingTaskRef[],
    secret?: PactFlowGitAuthSecret,
    authorizedCommands: readonly PactFlowValidationCommand[] = [],
    priorIdentity?: PactFlowClosingGit,
    baseline: readonly PactFlowValidationCommand[] = [],
    beforePush?: (closing: PactFlowClosingGit) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<PactFlowClosingGit> {
    assertPactFlowValidationAuthorization(binding, authorizedCommands)
    const root = await this.requireWorkspaceRoot(workspace)
    if (remoteRefs.length === 0) throw new Error('PactFlow closing requires at least one task branch')
    if ((binding.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the project binding')
    }
    const prefix = `refs/remotes/${binding.remote}/`
    if (remoteRefs.some(value => typeof value !== 'object' || value === null
      || typeof value.remoteRef !== 'string' || !/^[0-9a-f]{40,64}$/.test(value.expectedCommit ?? ''))) {
      throw new Error('PactFlow closing requires a remote ref and expected commit for every task')
    }
    const taskRefs = remoteRefs
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
    const projectKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
    const expectedBranch = `pactflow/closing/${projectKey}/${needId}/${suffix}`
    const expectedPath = join(this.worktreeRoot, 'closing', projectKey, needId, suffix)
    if (priorIdentity !== undefined && !(
      (priorIdentity.branch === expectedBranch && priorIdentity.worktreePath === expectedPath)
      || (priorIdentity.branch === `pactflow/closing/${needId}/${suffix}`
        && priorIdentity.worktreePath === join(this.worktreeRoot, 'closing', projectKey, suffix)))) {
      throw new Error('PactFlow prior integration identity belongs to another scope')
    }
    const branch = priorIdentity?.branch ?? expectedBranch
    const worktreePath = priorIdentity?.worktreePath ?? expectedPath
    await this.git(root, ['check-ref-format', '--branch', branch])
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
      if (priorIdentity !== undefined && priorIdentity.commit !== commit) throw new Error('PactFlow prior integration commit changed')
      await this.verifyTaskTips(root, prefix, branches, commit)
      await this.verifyTaskSet(root, branches, commit, baseCommit)
      if (!await this.exists(worktreePath)) {
        const localBranch = await this.git(root, ['branch', '--list', branch])
        await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 })
        await this.git(root, localBranch.length > 0
          ? ['worktree', 'add', worktreePath, branch]
          : ['worktree', 'add', '-b', branch, worktreePath, commit])
      }
      if (await this.git(worktreePath, ['branch', '--show-current']) !== branch
        || await this.git(worktreePath, ['rev-parse', 'HEAD']) !== commit) {
        throw new Error('PactFlow integration worktree identity changed')
      }
      return { branch, commit, worktreePath }
    }
    if (await this.exists(worktreePath) || (await this.git(root, ['branch', '--list', branch])).length > 0) {
      if (priorIdentity !== undefined && await this.exists(worktreePath)
        && await this.git(worktreePath, ['branch', '--show-current']) === branch
        && await this.git(worktreePath, ['rev-parse', 'HEAD']) === priorIdentity.commit
        && await this.git(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']) === '') {
        await this.verifyTaskTips(root, prefix, branches, priorIdentity.commit)
        await this.verifyTaskSet(root, branches, priorIdentity.commit, baseCommit)
        await this.withAuthentication(secret, async environment => {
          await beforePush?.(priorIdentity)
          signal?.throwIfAborted()
          await this.git(worktreePath, ['push', '--porcelain', binding.remote, `HEAD:refs/heads/${branch}`], environment, signal)
        })
        return priorIdentity
      }
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
    // A03-c: the host-owned baseline runs on the candidate commit BEFORE task
    // validations; any failure blocks closing (its authority is the owner's
    // workspace config, not the task binding, so it bypasses the binding
    // authorization assertion by construction).
    const baselineValidations: PactFlowValidationEvidence[] = []
    for (const command of baseline) {
      try {
        baselineValidations.push({ ...(await this.runValidation(worktreePath, command, signal)), source: 'host-baseline' })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`PactFlow host baseline validation failed and blocks closing (${command.command} ${command.args.join(' ')}): ${detail}`)
      }
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
    }, authorizedCommands, signal)
    await this.verifyTaskSet(worktreePath, branches, result.commit, baseCommit)
    const closing: PactFlowClosingGit = { branch, commit: result.commit, worktreePath,
      ...(baselineValidations.length === 0 ? {} : { baselineValidations }) }
    await this.withAuthentication(secret, async (environment) => {
      await beforePush?.(closing)
      signal?.throwIfAborted()
      await this.git(worktreePath, [
        'push', '--porcelain', binding.remote, `HEAD:refs/heads/${branch}`,
      ], environment, signal)
    })
    return {
      branch, commit: result.commit, worktreePath,
      ...(baselineValidations.length === 0 ? {} : { baselineValidations }),
    }
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

  /**
   * Verify the integration branch contains exactly the authorized delivery: every
   * expected task commit is an ancestor of the integration commit, no commit
   * outside the expected commits' ancestry closure (plus the first-parent merge
   * commits) was introduced, and every first-parent merge's extra parent is an
   * expected commit.
   *
   * A code-input dependency makes one task's history contain another's, so the
   * expected set is a dependency closure rather than a set of independent
   * one-merge-per-task commits.
   */
  private async verifyTaskSet(
    repository: string,
    branches: readonly { readonly branch: string; readonly expectedCommit?: string }[],
    integrationCommit: string,
    baseCommit: string,
  ): Promise<void> {
    const expected = branches.map(task => task.expectedCommit).filter((commit): commit is string => commit !== undefined)
    if (expected.length === 0 || expected.length !== branches.length) {
      throw new Error('PactFlow integration task-set requires an expected commit for every task')
    }
    const expectedSet = new Set(expected)
    for (const commit of expected) {
      try {
        await this.git(repository, ['merge-base', '--is-ancestor', commit, integrationCommit])
      } catch {
        throw new Error(`PactFlow integration branch does not contain verified task ${commit}`)
      }
    }
    // Commits reachable from the base are pre-existing; everything else must be
    // authorized (an expected commit's ancestry) or a first-parent merge commit.
    const baseAncestors = new Set(
      (await this.git(repository, ['rev-list', baseCommit])).split('\n').filter(Boolean),
    )
    const allowed = new Set<string>()
    for (const commit of expected) {
      for (const ancestor of (await this.git(repository, ['rev-list', commit])).split('\n').filter(Boolean)) {
        if (!baseAncestors.has(ancestor)) allowed.add(ancestor)
      }
    }
    const firstParentLines = (await this.git(repository, [
      'rev-list', '--first-parent', '--parents', `${baseCommit}..${integrationCommit}`,
    ])).split('\n').filter(Boolean)
    for (const line of firstParentLines) {
      const [commit, firstParent, ...extraParents] = line.trim().split(/\s+/u)
      if (commit === undefined || firstParent === undefined || extraParents.length === 0) {
        // Every new first-parent commit must be a merge; a plain commit means an
        // unauthorized change slipped onto the integration branch.
        throw new Error('PactFlow integration task-set contains an unexpected commit')
      }
      allowed.add(commit)
      for (const parent of extraParents) {
        if (!expectedSet.has(parent)) {
          throw new Error('PactFlow integration task-set merges an unexpected commit')
        }
      }
    }
    const introduced = (await this.git(repository, [
      'rev-list', `${baseCommit}..${integrationCommit}`,
    ])).split('\n').filter(Boolean)
    if (introduced.some(commit => !allowed.has(commit))) {
      throw new Error('PactFlow integration task-set contains an unexpected commit')
    }
  }

  /**
   * Fetch the default branch after a Gitea merge, then verify the exact merge
   * commit the provider reported. The delivery identity must be that commit,
   * never the (mutable) default-branch tip: an ancestor check alone would bind a
   * commit that was never validated. Returns the exact merge commit.
   */
  async verifyClosingMerged(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    integrationCommit: string,
    secret?: PactFlowGitAuthSecret,
    mergeCommit?: string,
  ): Promise<string> {
    const root = await this.requireWorkspaceRoot(workspace)
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, [
        'fetch', '--no-tags', binding.remote,
        `refs/heads/${binding.defaultBranch}:refs/remotes/${binding.remote}/${binding.defaultBranch}`,
      ], environment)
    })
    const defaultTip = await this.git(root, [
      'rev-parse', '--verify', `refs/remotes/${binding.remote}/${binding.defaultBranch}^{commit}`,
    ])
    // The integration commit must be reachable from the default branch.
    try {
      await this.git(root, ['merge-base', '--is-ancestor', integrationCommit, defaultTip])
    } catch {
      throw new Error('PactFlow Gitea default branch does not contain the integration commit')
    }
    if (mergeCommit === undefined) {
      // Without a provider-reported merge commit there is no exact delivery identity.
      throw new Error('PactFlow Gitea merge did not report an exact merge commit')
    }
    if (!COMMIT.test(mergeCommit)) throw new Error('PactFlow Gitea reported an invalid merge commit')
    // The exact merge commit must itself be reachable on the default branch.
    try {
      await this.git(root, ['merge-base', '--is-ancestor', mergeCommit, defaultTip])
    } catch {
      throw new Error('PactFlow Gitea default branch does not contain the reported merge commit')
    }
    // The integration commit must be contained in the exact merge commit.
    try {
      await this.git(root, ['merge-base', '--is-ancestor', integrationCommit, mergeCommit])
    } catch {
      throw new Error('PactFlow Gitea merge commit does not contain the integration commit')
    }
    return mergeCommit
  }

  /**
   * Re-run the registered validation commands against the exact merge commit in a
   * throwaway detached worktree, proving the delivered tree — not merely an
   * ancestor — passed validation.
   */
  async revalidateMergeCommit(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    mergeCommit: string,
    secret?: PactFlowGitAuthSecret,
    authorizedCommands: readonly PactFlowValidationCommand[] = [],
    signal?: AbortSignal,
  ): Promise<PactFlowGitCommitEvidence> {
    assertPactFlowValidationAuthorization(binding, authorizedCommands)
    const root = await this.requireWorkspaceRoot(workspace)
    const fetchRef = `refs/pactflow/merge/${mergeCommit}`
    await this.withAuthentication(secret, async (environment) => {
      await this.git(root, ['fetch', '--no-tags', binding.remote, mergeCommit], environment)
      // Name the fetched object under a temporary ref so `worktree add` can resolve
      // it; the ref is removed in the finally below and never accumulates.
      await this.git(root, ['update-ref', fetchRef, mergeCommit])
    })
    const worktreePath = join(this.worktreeRoot, 'merge-verify', mergeCommit)
    if (await this.exists(worktreePath)) throw new Error('PactFlow merge validation worktree already exists')
    await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 })
    await this.git(root, ['worktree', 'add', '--detach', worktreePath, mergeCommit])
    try {
      const head = await this.git(worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
      if (head !== mergeCommit) throw new Error('PactFlow merge validation worktree does not match the merge commit')
      const dirty = await this.git(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
      if (dirty.length > 0) throw new Error('PactFlow merge validation left local changes')
      const validations: PactFlowValidationEvidence[] = []
      for (const command of this.validationCommands(authorizedCommands)) {
        validations.push(await this.runValidation(worktreePath, command, signal))
      }
      const after = await this.git(worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
      if (after !== mergeCommit) throw new Error('PactFlow merge validation changed the merge commit')
      return { branch: binding.defaultBranch, commit: mergeCommit, validations }
    } finally {
      await this.git(root, ['worktree', 'remove', '--force', worktreePath]).catch(() => undefined)
      await this.git(root, ['update-ref', '-d', fetchRef]).catch(() => undefined)
    }
  }

  /** Remove only the clean local worktree and branch created for closing. */
  async cleanupClosing(workspace: string | undefined, closing: PactFlowClosingGit): Promise<void> {
    await this.cleanupOwnedCheckout(workspace, closing, 'pactflow/closing/')
  }

  private async cleanupOwnedCheckout(
    workspace: string | undefined,
    closing: PactFlowClosingGit,
    branchPrefix: string,
    beforeRemove?: () => Promise<void>,
  ): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    const branch = this.gitName('closing branch', closing.branch)
    const within = (parent: string, child: string): boolean => {
      const path = relative(parent, child)
      return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
    }
    if (!branch.startsWith(branchPrefix) || branch !== closing.branch
      || !/^[0-9a-f]{40,64}$/.test(closing.commit)
      || !isAbsolute(closing.worktreePath) || !within(resolve(this.worktreeRoot), resolve(closing.worktreePath))) {
      throw new Error('PactFlow closing cleanup target is outside Host-owned resources')
    }
    const ref = `refs/heads/${branch}`
    const refs = await this.git(root, ['for-each-ref', '--format=%(refname) %(objectname)', ref])
    const tip = refs.split('\n').find(line => line.startsWith(`${ref} `))?.slice(ref.length + 1)
    if (tip !== undefined && tip !== closing.commit) throw new Error('PactFlow closing cleanup branch commit changed')
    const hasWorktree = await this.exists(closing.worktreePath)
    if (hasWorktree) {
      if (!within(await realpath(this.worktreeRoot), await realpath(closing.worktreePath))) {
        throw new Error('PactFlow closing cleanup worktree resolves outside Host-owned resources')
      }
      const common = await this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      const targetCommon = await this.git(closing.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      if (await realpath(common) !== await realpath(targetCommon)
        || await this.git(closing.worktreePath, ['branch', '--show-current']) !== branch
        || await this.git(closing.worktreePath, ['rev-parse', 'HEAD']) !== closing.commit) {
        throw new Error('PactFlow closing cleanup worktree identity changed')
      }
      const dirty = await this.git(closing.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
      if (dirty.length > 0) throw new Error('PactFlow closing worktree is not clean')
    }
    await beforeRemove?.()
    if (hasWorktree) await this.git(root, ['worktree', 'remove', closing.worktreePath])
    if (tip !== undefined) {
      const worktrees = await this.git(root, ['worktree', 'list', '--porcelain'])
      if (worktrees.split('\n').includes(`branch ${ref}`)) throw new Error('PactFlow closing branch is still checked out')
      await this.git(root, ['update-ref', '-d', ref, closing.commit])
    }
  }

  /** Remove one merged task branch from the remote and its clean local worktree. */
  async cleanupTaskRun(
    workspace: string | undefined,
    binding: PactFlowGitBinding,
    spec: PactFlowGitRunSpec,
    secret?: PactFlowGitAuthSecret,
    expectedCommit?: string,
  ): Promise<void> {
    const root = await this.requireWorkspaceRoot(workspace)
    if (expectedCommit === undefined || !/^[0-9a-f]{40,64}$/.test(expectedCommit)) {
      throw new Error('PactFlow task cleanup requires a verified expected commit')
    }
    if (binding.remote !== spec.remote || binding.remoteUrl !== spec.remoteUrl
      || spec.branch === binding.defaultBranch || spec.branch === spec.defaultBranch
      || this.credentialFreeRemote(await this.git(root, ['remote', 'get-url', binding.remote])) !== spec.remoteUrl) {
      throw new Error('PactFlow task cleanup remote or branch identity changed')
    }
    if ((binding.auth === undefined) !== (secret === undefined)) {
      throw new Error('PactFlow Git authentication does not match the project binding')
    }
    const removeRemote = async () => this.withAuthentication(secret, async environment => {
        const ref = `refs/heads/${spec.branch}`
        const output = await this.git(root, ['ls-remote', '--heads', binding.remote, ref], environment)
        const tip = output.split('\n').map(line => line.split(/\s+/)).find(([, name]) => name === ref)?.[0]
        if (tip === undefined) return
        if (tip !== expectedCommit) throw new Error('PactFlow task cleanup remote commit changed')
        await this.git(root, ['push', '--porcelain', `--force-with-lease=${ref}:${expectedCommit}`, binding.remote, `:${ref}`], environment)
      })
    if (spec.checkoutKind === 'isolated-clone') {
      if (!spec.branch.startsWith('pactflow/') || !isWithin(resolve(this.worktreeRoot), resolve(spec.worktreePath))) throw new Error('独立仓库清理路径越界')
      const present = await this.exists(spec.worktreePath)
      if (present) {
        if (!isWithin(await realpath(this.worktreeRoot), await realpath(spec.worktreePath))) throw new Error('独立仓库清理路径别名越界')
        await assertLocalCheckout(spec)
        if (await isolatedGit(spec.worktreePath, ['rev-parse', 'HEAD']) !== expectedCommit
          || await isolatedGit(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') throw new Error('独立仓库清理要求提交未变化且工作区干净')
      }
      await removeRemote()
      if (present) await rm(spec.worktreePath, { recursive: true })
      return
    }
    await this.cleanupOwnedCheckout(workspace, { branch: spec.branch, worktreePath: spec.worktreePath, commit: expectedCommit }, 'pactflow/', removeRemote)
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
    signal?: AbortSignal,
    mavenCache?: string,
  ): Promise<PactFlowValidationEvidence> {
    const startedAt = Date.now()
    const environment = minimalValidationEnvironment()
    // JAVA_TOOL_OPTIONS also reaches mvnw and Java launched by shell/wrapper commands.
    // JVM option parsing supports quoted paths, unlike shell expansion of MAVEN_OPTS.
    if (mavenCache !== undefined) environment.JAVA_TOOL_OPTIONS = `-Dmaven.repo.local=${JSON.stringify(mavenCache)}`
    return new Promise((resolveEvidence, reject) => {
      execFile(validation.command, validation.args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: validation.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
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


  private git(cwd: string, args: readonly string[], environment?: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        ...(signal === undefined ? {} : { signal }),
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
