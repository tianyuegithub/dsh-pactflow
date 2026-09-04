import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  PactFlowWorkspaceGitStatus,
  PactFlowWorkspaceProjectConfig,
} from './types.ts'

const exec = promisify(execFile)

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
): Promise<void> {
  if (await gitOptional(path, ['remote', 'get-url', 'origin']) !== undefined) {
    throw new Error('PactFlow Workspace already has an origin remote')
  }
  await git(path, ['remote', 'add', 'origin', remoteUrl])
  const helperDir = await mkdtemp(join(tmpdir(), 'pactflow-askpass-'))
  const helper = join(helperDir, 'askpass.sh')
  try {
    await writeFile(helper, '#!/bin/sh\ncase "$1" in *Username*) printf %s "$PACTFLOW_GIT_USERNAME";; *) printf %s "$PACTFLOW_GIT_PASSWORD";; esac\n', { mode: 0o700 })
    await exec('git', ['-C', path, 'push', '-u', 'origin', branch], {
      encoding: 'utf8', maxBuffer: 2_097_152,
      env: {
        ...process.env, GIT_ASKPASS: helper, GIT_TERMINAL_PROMPT: '0',
        PACTFLOW_GIT_USERNAME: username, PACTFLOW_GIT_PASSWORD: token,
      },
    })
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

/** Durable plugin-owned project configuration store keyed by the stable DSH workspace id. */
export class PactFlowWorkspaceProjectStore {
  private static readonly locks = new Map<string, Promise<void>>()
  private readonly rows = new Map<string, PactFlowWorkspaceProjectConfig>()
  private loaded: Promise<void> | undefined

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'workspace-projects.json')) {}

  async list(): Promise<readonly PactFlowWorkspaceProjectConfig[]> {
    await this.load()
    return [...this.rows.values()].map(row => structuredClone(row))
  }

  async get(workspaceId: string): Promise<PactFlowWorkspaceProjectConfig | undefined> {
    await this.load()
    const row = this.rows.get(workspaceId)
    return row === undefined ? undefined : structuredClone(row)
  }

  /** Legacy unconditional write. New Workspace mutations must use putIfRevision(). */
  async put(config: PactFlowWorkspaceProjectConfig): Promise<void> {
    await this.load()
    await this.withLock(async () => {
      await this.reload()
      this.rows.set(config.workspaceId, structuredClone(config))
      await this.persist()
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
    await this.load()
    return await this.withLock(async () => {
      await this.reload()
      const current = this.rows.get(config.workspaceId)
      if ((current?.revision ?? 0) !== expectedRevision) return false
      this.rows.set(config.workspaceId, structuredClone(config))
      await this.persist()
      return true
    })
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      await this.reload()
    })()
    await this.loaded
  }

  private async reload(): Promise<void> {
    this.rows.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return
      for (const row of parsed) {
        if (!validConfig(row)) continue
        this.rows.set(row.workspaceId, structuredClone(row))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
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
      return await operation()
    } finally {
      unlock!()
    }
  }
}

function validConfig(value: unknown): value is PactFlowWorkspaceProjectConfig {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<PactFlowWorkspaceProjectConfig>
  return row.schema === 'dsh_pactflow_workspace_project/v1'
    && typeof row.workspaceId === 'string' && typeof row.workspacePath === 'string'
    && typeof row.workspaceTitle === 'string' && typeof row.revision === 'number'
    && Number.isSafeInteger(row.revision) && row.revision > 0
    && typeof row.createdAt === 'number' && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0
    && typeof row.updatedAt === 'number' && Number.isSafeInteger(row.updatedAt) && row.updatedAt >= 0
    && (row.validationCommands === undefined || Array.isArray(row.validationCommands))
    && (row.validationProfiles === undefined || validValidationProfiles(row.validationProfiles))
    && (row.validationProfileIds === undefined || (Array.isArray(row.validationProfileIds)
      && row.validationProfileIds.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
      && (row.validationProfiles === undefined || row.validationProfileIds.every(id =>
        row.validationProfiles!.some(profile => profile.id === id)))))
}

function validValidationProfiles(value: readonly unknown[]): boolean {
  const ids = value.map(profile => typeof profile === 'object' && profile !== null
    ? (profile as { readonly id?: unknown }).id : undefined)
  return new Set(ids).size === ids.length && value.every(profile => validValidationProfile(profile))
}

function validValidationProfile(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Record<string, unknown>
  const command = profile.command
  const executable = typeof command === 'string' ? command.split('/').pop()?.toLowerCase() : undefined
  return typeof profile.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.id)
    && typeof profile.displayName === 'string' && profile.displayName.trim() !== ''
    && typeof command === 'string' && /^[^\s\0\r\n;&|<>$()`]{1,256}$/.test(command)
    && (executable === undefined || !new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh']).has(executable))
    && Array.isArray(profile.args) && profile.args.length <= 64
    && profile.args.every(argument => typeof argument === 'string' && argument.length <= 4_096 && !/[\0\r\n]/.test(argument))
    && Number.isSafeInteger(profile.timeoutMs) && (profile.timeoutMs as number) >= 1_000
    && (profile.timeoutMs as number) <= 3_600_000
    && Number.isSafeInteger(profile.revision) && (profile.revision as number) > 0
}
