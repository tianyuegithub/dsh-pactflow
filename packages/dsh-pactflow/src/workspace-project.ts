import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withWorkspaceFileLock } from './workspace-lock.ts'
import { pactFlowWorkspaceProjectSchema } from './schema.ts'
import type {
  PactFlowWorkspaceGitStatus,
  PactFlowWorkspaceProjectConfig,
} from './types.ts'

const exec = promisify(execFile)

export async function workspaceHeadCommit(path: string, targetBranch?: string): Promise<string> {
  if (targetBranch !== undefined) await git(path, ['check-ref-format', `refs/heads/${targetBranch}`])
  return await git(path, ['rev-parse', '--verify', 'HEAD^{commit}'])
}

async function git(path: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', ['-C', path, ...args], {
    encoding: 'utf8', maxBuffer: 2_097_152,
  })
  return result.stdout.trim()
}

async function gitOptional(path: string, args: readonly string[]): Promise<string | undefined> {
  try { return await git(path, args) } catch { return undefined }
}

/** Inspect one host-owned workspace without reading file contents or credentials. */
export async function inspectWorkspaceGit(path: string): Promise<PactFlowWorkspaceGitStatus> {
  const inside = await gitOptional(path, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') {
    return {
      initialized: false, hasCommit: false, clean: true, changedFiles: 0, untrackedFiles: 0,
      hasGitignore: await fileExists(join(path, '.gitignore')),
    }
  }
  const status = await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const entries = status === '' ? [] : status.split('\0').filter(Boolean)
  const untrackedFiles = entries.filter(entry => entry.startsWith('?? ')).length
  const branch = await gitOptional(path, ['branch', '--show-current'])
  const remoteUrl = await gitOptional(path, ['remote', 'get-url', 'origin'])
  return {
    initialized: true,
    ...(branch === undefined || branch === '' ? {} : { branch }),
    ...(remoteUrl === undefined || remoteUrl === '' ? {} : { remoteUrl }),
    hasCommit: await gitOptional(path, ['rev-parse', '--verify', 'HEAD']) !== undefined,
    clean: entries.length === 0,
    changedFiles: entries.length - untrackedFiles,
    untrackedFiles,
    hasGitignore: await fileExists(join(path, '.gitignore')),
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch { return false }
}

/** Initialize only the local repository; never stages or commits workspace files. */
export async function initializeWorkspaceGit(path: string): Promise<PactFlowWorkspaceGitStatus> {
  const current = await inspectWorkspaceGit(path)
  if (!current.initialized) await exec('git', ['-C', path, 'init', '-b', 'main'], { encoding: 'utf8' })
  return await inspectWorkspaceGit(path)
}

/** Add origin and push without placing credentials in argv, URLs, files, or logs. */
export async function attachAndPushWorkspaceRemote(
  path: string,
  remoteUrl: string,
  username: string,
  token: string,
  branch: string,
  expectedCommit: string,
): Promise<void> {
  await git(path, ['check-ref-format', `refs/heads/${branch}`])
  if (await workspaceHeadCommit(path) !== expectedCommit) throw new Error('PactFlow Workspace commit changed before push')
  const existing = await gitOptional(path, ['remote', 'get-url', 'origin'])
  if (existing !== undefined && existing !== remoteUrl) {
    throw new Error('PactFlow Workspace origin changed before push')
  }
  if (existing === undefined) await git(path, ['remote', 'add', 'origin', remoteUrl])
  const helperDir = await mkdtemp(join(tmpdir(), 'pactflow-askpass-'))
  const helper = join(helperDir, 'askpass.sh')
  try {
    await writeFile(helper, '#!/bin/sh\ncase "$1" in *Username*) printf %s "$PACTFLOW_GIT_USERNAME";; *) printf %s "$PACTFLOW_GIT_PASSWORD";; esac\n', { mode: 0o700 })
    const options = {
      encoding: 'utf8', maxBuffer: 2_097_152,
      env: {
        ...process.env, GIT_ASKPASS: helper, GIT_TERMINAL_PROMPT: '0',
        PACTFLOW_GIT_USERNAME: username, PACTFLOW_GIT_PASSWORD: token,
      },
    } as const
    const ref = `refs/heads/${branch}`
    const tip = (await exec('git', ['-C', path, 'ls-remote', remoteUrl, ref], options)).stdout.trim().split(/\s+/)[0]
    if (tip === expectedCommit) return
    if (tip !== '') throw new Error('PactFlow remote branch changed before initial push')
    // Lease permits only creation of an absent ref, never replacement of another commit.
    await exec('git', ['-C', path, 'push', `--force-with-lease=${ref}:`, remoteUrl, `${expectedCommit}:${ref}`], options)
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

/** Durable plugin-owned project configuration store keyed by the stable DSH workspace id. */
export class PactFlowWorkspaceProjectStore {
  private static readonly locks = new Map<string, Promise<void>>()
  private readonly rows = new Map<string, PactFlowWorkspaceProjectConfig>()

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'workspace-projects.json')) {}

  async list(): Promise<readonly PactFlowWorkspaceProjectConfig[]> {
    return await this.withLock(async () => {
      await this.reload()
      return [...this.rows.values()].map(row => structuredClone(row))
    })
  }

  async get(workspaceId: string): Promise<PactFlowWorkspaceProjectConfig | undefined> {
    return await this.withLock(async () => {
      await this.reload()
      const row = this.rows.get(workspaceId)
      return row === undefined ? undefined : structuredClone(row)
    })
  }

  /**
   * Atomically replaces one Workspace configuration only when its persisted revision matches.
   * A missing configuration has revision zero; each successful write must advance it by one.
   */
  async putIfRevision(expectedRevision: number, config: PactFlowWorkspaceProjectConfig): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('PactFlow Workspace expected revision must be a non-negative integer')
    }
    if (config.revision !== expectedRevision + 1) {
      throw new Error('PactFlow Workspace configuration revision must advance by exactly one')
    }
    if (!validConfig(config)) throw new Error('PactFlow Workspace configuration is invalid')
    return await this.withLock(async () => {
      await this.reload()
      const current = this.rows.get(config.workspaceId)
      if ((current?.revision ?? 0) !== expectedRevision) return false
      if (current?.remoteCreation !== undefined) {
        const { state: oldState, cloneUrl: oldUrl, ...oldIdentity } = current.remoteCreation
        const { state: nextState, cloneUrl: nextUrl, ...nextIdentity } = config.remoteCreation ?? {}
        if (JSON.stringify(oldIdentity) !== JSON.stringify(nextIdentity)
          || (oldUrl !== undefined && oldUrl !== nextUrl)
          || !(nextState === oldState || (oldState === 'creating' && nextState === 'created')
            || (oldState === 'created' && nextState === 'completed'))) {
          throw new Error('PactFlow remote creation responsibility cannot be discarded or retargeted')
        }
      }
      this.rows.set(config.workspaceId, structuredClone(config))
      await this.persist()
      return true
    })
  }

  private async reload(): Promise<void> {
    const next = new Map<string, PactFlowWorkspaceProjectConfig>()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!Array.isArray(parsed)) throw new Error('PactFlow Workspace configuration file must contain an array')
      for (const row of parsed) {
        if (!validConfig(row)) throw new Error('PactFlow Workspace configuration file contains an invalid record')
        if (next.has(row.workspaceId)) throw new Error('PactFlow Workspace configuration file contains duplicate workspace IDs')
        next.set(row.workspaceId, structuredClone(row))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.rows.clear()
    for (const [id, row] of next) this.rows.set(id, row)
  }

  private async persist(): Promise<void> {
    const content = `${JSON.stringify([...this.rows.values()], null, 2)}\n`
    const checksum = createHash('sha256').update(content).digest('hex')
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${checksum.slice(0, 12)}.tmp`
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, this.path)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = PactFlowWorkspaceProjectStore.locks.get(this.path) ?? Promise.resolve()
    let unlock: (() => void) | undefined
    const current = new Promise<void>(resolve => { unlock = resolve })
    PactFlowWorkspaceProjectStore.locks.set(this.path, previous.then(() => current, () => current))
    await previous.catch(() => undefined)
    try {
      return await withWorkspaceFileLock(this.path, operation)
    } finally { unlock!() }
  }
}

function validConfig(value: unknown): value is PactFlowWorkspaceProjectConfig {
  return pactFlowWorkspaceProjectSchema.safeParse(value).success
}
