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
  private readonly rows = new Map<string, PactFlowWorkspaceProjectConfig>()
  private loaded: Promise<void> | undefined
  private writes = Promise.resolve()

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'workspace-projects.json')) {}

  async list(): Promise<readonly PactFlowWorkspaceProjectConfig[]> {
    await this.load()
    return [...this.rows.values()]
  }

  async get(workspaceId: string): Promise<PactFlowWorkspaceProjectConfig | undefined> {
    await this.load()
    return this.rows.get(workspaceId)
  }

  async put(config: PactFlowWorkspaceProjectConfig): Promise<void> {
    await this.load()
    this.rows.set(config.workspaceId, structuredClone(config))
    await this.persist()
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
        if (!Array.isArray(parsed)) return
        for (const row of parsed) {
          if (!validConfig(row)) continue
          this.rows.set(row.workspaceId, row)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })()
    await this.loaded
  }

  private async persist(): Promise<void> {
    const content = `${JSON.stringify([...this.rows.values()], null, 2)}\n`
    const checksum = createHash('sha256').update(content).digest('hex')
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${checksum.slice(0, 12)}.tmp`
      await writeFile(temporary, content, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    await this.writes
  }
}

function validConfig(value: unknown): value is PactFlowWorkspaceProjectConfig {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<PactFlowWorkspaceProjectConfig>
  return row.schema === 'dsh_pactflow_workspace_project/v1'
    && typeof row.workspaceId === 'string' && typeof row.workspacePath === 'string'
    && typeof row.workspaceTitle === 'string' && Number.isSafeInteger(row.revision)
    && typeof row.createdAt === 'number' && typeof row.updatedAt === 'number'
    && Array.isArray(row.validationCommands)
}
