import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { inspectWorkspaceGit } from '../src/workspace-project.ts'
import { redactUrlCredentials } from '../src/redaction.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

describe('PactFlow credential-safe display', () => {
  it('removes embedded credentials but keeps host and path', () => {
    expect(redactUrlCredentials('https://user:secret-token@git.example/owner/repo.git'))
      .toBe('https://***@git.example/owner/repo.git')
    expect(redactUrlCredentials('http://alice:hunter2@git.example:3000/owner/repo.git'))
      .toBe('http://***@git.example:3000/owner/repo.git')
  })

  it('redacts a URL embedded anywhere in a larger message', () => {
    const message = 'clone failed for https://user:secret-token@git.example/owner/repo.git (exit 128)'
    const redacted = redactUrlCredentials(message)
    expect(redacted).not.toContain('secret-token')
    expect(redacted).toContain('git.example/owner/repo.git')
  })

  it('removes the password from an scp-style remote', () => {
    expect(redactUrlCredentials('alice:secret-token@git.example:owner/repo.git'))
      .toBe('alice:***@git.example:owner/repo.git')
  })

  it('leaves credential-free remotes unchanged', () => {
    for (const value of [
      'https://git.example/owner/repo.git',
      'git@git.example:owner/repo.git',
      '/srv/git/repo.git',
      'ssh://git@git.example:22/owner/repo.git',
    ]) {
      expect(redactUrlCredentials(value)).toBe(value)
    }
  })

  it('redacts a credential embedded in a checked workspace origin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-redact-ws-'))
    roots.push(root)
    git(['init', root])
    await writeFile(join(root, '.gitignore'), '')
    git(['-C', root, 'remote', 'add', 'origin', 'https://user:secret-token@git.example/owner/repo.git'])
    const status = await inspectWorkspaceGit(root)
    expect(JSON.stringify(status)).not.toContain('secret-token')
    expect(status.remoteUrl).toContain('git.example')
    expect(status.remoteUrl).toContain('owner/repo')
  })

  it('redacts an error summary before truncating it', () => {
    const service = Object.create(PactFlowService.prototype) as PactFlowService
    const bounded = (value: unknown): string => Reflect.get(service, 'boundedOutcome').call(service, value)
    // Short: the credential is removed, host/path remain.
    const short = bounded(new Error('clone failed for https://user:secret-token@git.example/owner/repo.git'))
    expect(short).not.toContain('secret-token')
    expect(short).toContain('git.example')
    // Long: a credential near the front must not survive truncation as a visible prefix.
    const long = bounded(new Error(`https://user:secret-token@git.example/owner/repo.git ${'x'.repeat(8_000)}`))
    expect(long).not.toContain('secret-token')
    expect(long.length).toBeLessThanOrEqual(4_096)
  })
})
