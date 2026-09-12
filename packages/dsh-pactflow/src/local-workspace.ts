/** Self-contained local checkouts. No business code is committed by these helpers. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PactFlowGitRunSpec } from './types.ts'

export type LocalGit = (cwd: string, args: readonly string[], signal?: AbortSignal) => Promise<string>
export const localRuntimePath = (spec: PactFlowGitRunSpec): string => join(spec.worktreePath, '.git', 'pactflow-runtime')
export const localMavenCache = (spec: PactFlowGitRunSpec): string => join(localRuntimePath(spec), 'm2')
export function isWithin(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Do not inherit credential helpers, hooks, includes, rewrites or filters while preparing inputs. */
export function localGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' }
  for (const key of Object.keys(env)) if (/^GIT_(CONFIG$|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS)|TEMPLATE_DIR$|DIR$|WORK_TREE$|INDEX_FILE$|OBJECT_DIRECTORY$|ALTERNATE_OBJECT_DIRECTORIES$)/.test(key)) delete env[key]
  return env
}

/** Command-level overrides still apply if a background process changes repository config. */
export function protectedGitArgs(args: readonly string[]): string[] {
  return ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'core.fsmonitor=false',
    '-c', 'credential.helper=', '-c', 'core.sshCommand=ssh', '-c', 'protocol.ext.allow=never', ...args]
}

export function isolatedGit(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((accept, reject) => execFile('git', ['-C', cwd, ...protectedGitArgs(args)], {
    env: localGitEnvironment(), maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(signal ? { signal } : {}),
  }, (error, stdout) => error ? reject(new Error(`本地仓库 Git 操作失败：${args[0] ?? 'unknown'}`)) : accept(args[0] === 'diff' || args.includes('-z') ? stdout : stdout.trim())))
}

export async function materializeLocalCheckout(root: string, spec: PactFlowGitRunSpec, git: LocalGit = isolatedGit): Promise<void> {
  await mkdir(spec.worktreePath, { recursive: false, mode: 0o700 })
  await git(spec.worktreePath, ['init', '--quiet', '--template=', '--initial-branch', spec.branch])
  // Transporting exact objects into a fresh repository never creates hardlinks or alternates.
  await git(spec.worktreePath, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', root,
    spec.baseCommit, ...(spec.codeInputs ?? []).map(input => input.commit)])
  await git(spec.worktreePath, ['checkout', '--quiet', '-B', spec.branch, spec.baseCommit])
  await git(spec.worktreePath, ['remote', 'add', spec.remote, spec.remoteUrl])
  await mkdir(join(localRuntimePath(spec), 'hooks'), { recursive: true, mode: 0o700 })
  await mkdir(localMavenCache(spec), { recursive: true, mode: 0o700 })
  for (const [key, value] of [
    ['user.name', 'PactFlow Worker'], ['user.email', 'pactflow-worker@example.invalid'],
    ['core.hooksPath', join(localRuntimePath(spec), 'hooks')], ['core.fsmonitor', 'false'],
    ['commit.gpgsign', 'false'], ['credential.helper', ''],
  ]) await git(spec.worktreePath, ['config', '--local', key!, value!])
  for (const input of spec.codeInputs ?? []) await git(spec.worktreePath, ['merge', '--no-ff', '--no-edit', input.commit])
  await assertLocalCheckout(spec, git)
}

export async function assertLocalCheckout(spec: PactFlowGitRunSpec, git: LocalGit = isolatedGit): Promise<void> {
  const root = await realpath(spec.worktreePath)
  const metadata = join(spec.worktreePath, '.git')
  const stat = await lstat(metadata)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(metadata) !== join(root, '.git')) throw new Error('任务仓库 Git 元数据必须位于仓内独立目录')
  const configuration = await lstat(join(metadata, 'config'))
  if (!configuration.isFile() || configuration.isSymbolicLink() || configuration.size > 16384) throw new Error('任务仓库配置身份不安全')
  const config = await git(spec.worktreePath, ['config', '--local', '--null', '--list', '--no-includes'])
  const ordinary = new Set(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'user.name', 'user.email'])
  const required = new Map([
    ['core.hookspath', join(localRuntimePath(spec), 'hooks')], ['core.fsmonitor', 'false'], ['commit.gpgsign', 'false'],
    ['credential.helper', ''], [`remote.${spec.remote}.url`, spec.remoteUrl], [`remote.${spec.remote}.fetch`, `+refs/heads/*:refs/remotes/${spec.remote}/*`],
  ])
  const seen = new Set<string>()
  for (const entry of config.split('\0').filter(Boolean)) {
    const split = entry.indexOf('\n'), key = entry.slice(0, split), value = entry.slice(split + 1)
    if (split < 0 || seen.has(key) || (!ordinary.has(key) && required.get(key) !== value)) throw new Error('任务仓库配置包含未授权的执行设置')
    if ((key === 'core.bare' && value !== 'false') || (key === 'core.repositoryformatversion' && value !== '0')) throw new Error('任务仓库格式变化')
    seen.add(key)
  }
  if ([...required.keys()].some(key => !seen.has(key))) throw new Error('任务仓库安全配置缺失')
  const hooks = join(localRuntimePath(spec), 'hooks')
  if ((await lstat(hooks)).isSymbolicLink() || (await readdir(hooks)).length > 0) throw new Error('任务仓库不能提供宿主执行钩子')
  const common = await git(spec.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (await realpath(common) !== await realpath(metadata)) throw new Error('任务仓库不能共享主仓 Git 元数据')
  try { await lstat(join(metadata, 'objects', 'info', 'alternates')); throw new Error('任务仓库不能引用共享对象库') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (await git(spec.worktreePath, ['branch', '--show-current']) !== spec.branch
    || await git(spec.worktreePath, ['remote', 'get-url', spec.remote]) !== spec.remoteUrl) throw new Error('任务仓库分支或远程身份变化')
}

export interface RecoverySnapshot {
  readonly runId: string
  readonly digest: string
  readonly sourceHead: string
  readonly baseCommit: string
  readonly changedFiles: number
  readonly patch: string
  readonly files: readonly { readonly path: string; readonly data: Buffer; readonly mode: number }[]
}

/** A bounded immutable copy in memory; callers return metadata only, never raw business files. */
export async function captureRecovery(runId: string, spec: PactFlowGitRunSpec, git: LocalGit = isolatedGit): Promise<RecoverySnapshot> {
  if (await git(spec.worktreePath, ['branch', '--show-current']) !== spec.branch) throw new Error('候选分支身份变化')
  const sourceHead = await git(spec.worktreePath, ['rev-parse', 'HEAD'])
  await git(spec.worktreePath, ['merge-base', '--is-ancestor', spec.baseCommit, sourceHead])
  const patch = await git(spec.worktreePath, ['diff', '--binary', '--no-ext-diff', '--no-textconv', spec.baseCommit, '--', '.'])
  const names = (await git(spec.worktreePath, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  if (names.length > 1000) throw new Error('候选新增文件过多，需人工定界')
  const files: { path: string; data: Buffer; mode: number }[] = []
  let bytes = Buffer.byteLength(patch)
  const root = await realpath(spec.worktreePath)
  for (const path of names.sort()) {
    if (isAbsolute(path) || !isWithin(root, resolve(root, path))) throw new Error('候选文件路径越界')
    const entry = join(root, path)
    const stat = await lstat(entry)
    if (!stat.isFile() || !isWithin(root, await realpath(entry))) throw new Error('候选新增文件必须为仓内普通文件')
    bytes += stat.size
    if (bytes > 64 * 1024 * 1024) throw new Error('候选改动超过64MiB，需人工定界')
    files.push({ path, data: await readFile(entry), mode: stat.mode & 0o777 })
  }
  const changedFiles = (await git(spec.worktreePath, ['diff', '--name-only', '--no-ext-diff', '--no-textconv', spec.baseCommit, '--', '.'])).split('\n').filter(Boolean).length + files.length
  const hash = createHash('sha256').update(JSON.stringify({ runId, sourceHead, baseCommit: spec.baseCommit, patch }))
  for (const file of files) hash.update(JSON.stringify({ path: file.path, mode: file.mode, length: file.data.length })).update(file.data)
  if (bytes > 64 * 1024 * 1024) throw new Error('候选改动超过64MiB，需人工定界')
  return { runId, digest: hash.digest('hex'), sourceHead, baseCommit: spec.baseCommit, changedFiles, patch, files }
}

export async function applyRecovery(spec: PactFlowGitRunSpec, candidate: RecoverySnapshot, git: LocalGit = isolatedGit): Promise<void> {
  if (spec.baseCommit !== candidate.baseCommit || spec.recoveryInput?.digest !== candidate.digest
    || spec.recoveryInput.runId !== candidate.runId || spec.recoveryInput.sourceHead !== candidate.sourceHead) throw new Error('恢复候选与运行规格不匹配')
  await assertLocalCheckout(spec, git)
  if (await git(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') throw new Error('恢复目标必须为干净的新任务仓库')
  if (candidate.patch) {
    const patchPath = join(localRuntimePath(spec), 'candidate.patch')
    await writeFile(patchPath, candidate.patch, { mode: 0o600 })
    try { await git(spec.worktreePath, ['apply', '--binary', '--whitespace=nowarn', '--', patchPath]) }
    finally { await rm(patchPath, { force: true }) }
  }
  for (const file of candidate.files) {
    const destination = resolve(spec.worktreePath, file.path)
    if (!isWithin(resolve(spec.worktreePath), destination) || file.path.split(/[\\/]/).includes('.git')) throw new Error('恢复文件路径越界')
    const parent = resolve(destination, '..')
    await mkdir(parent, { recursive: true })
    const targetRoot = await realpath(spec.worktreePath)
    const realParent = await realpath(parent)
    if ((realParent !== targetRoot && !isWithin(targetRoot, realParent))
      || realParent === join(targetRoot, '.git') || isWithin(join(targetRoot, '.git'), realParent)) throw new Error('恢复目录别名越界')
    await writeFile(destination, file.data, { flag: 'wx', mode: file.mode })
    await chmod(destination, file.mode)
  }
}
