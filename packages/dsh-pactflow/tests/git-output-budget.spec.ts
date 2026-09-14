import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'

/**
 * Both child processes the workspace runs were capped at 1 MiB of stdout.
 *
 * `verifyTaskSet` runs `git rev-list <commit>` over the whole history — 41 bytes
 * a line, so a repository past roughly 25,500 commits overflowed and closing
 * reported "整合分支任务集校验失败", a message with no relation to the real cause,
 * which no retry could ever get past. The same cap sat on registered validation
 * commands, where `mvn test` or `pnpm test` output passes 1 MiB routinely; there
 * the overflow was reported as "validation command failed (exit unavailable)",
 * i.e. a passing test suite presented as a failing one.
 */

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('PactFlow child-process output budgets', () => {
  it('reads git output larger than a mebibyte', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-git-output-'))
    roots.push(root)
    const { workspace } = createGitFixture(root)
    await writeFile(join(workspace, 'big.txt'), `${'x'.repeat(4 * 1024 * 1024)}\n`)
    execFileSync('git', ['-C', workspace, 'add', 'big.txt'], { stdio: 'ignore' })
    execFileSync('git', ['-C', workspace, 'commit', '-m', 'big'], { stdio: 'ignore' })

    const instance = new PactFlowGitWorkspace()
    const git = Reflect.get(instance, 'git') as (cwd: string, args: readonly string[]) => Promise<string>
    const output = await git.call(instance, workspace, ['show', 'HEAD:big.txt'])
    expect(output.length).toBeGreaterThan(1024 * 1024)
  })

  it('names the overflow instead of reporting it as an unrelated git failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-git-overflow-'))
    roots.push(root)
    const { workspace } = createGitFixture(root)
    const instance = new PactFlowGitWorkspace()
    const git = Reflect.get(instance, 'git') as (
      cwd: string, args: readonly string[], environment?: NodeJS.ProcessEnv, signal?: AbortSignal, maxBuffer?: number,
    ) => Promise<string>
    // Whatever the ceiling is, exceeding it must be distinguishable from "the
    // command failed": the two call for completely different operator responses.
    await expect(git.call(instance, workspace, ['log', '--format=%H%n%s%n%b'], undefined, undefined, 16))
      .rejects.toThrow(/output exceeded/)
  })

  it('accepts validation command output larger than a mebibyte', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-validation-output-'))
    roots.push(root)
    const instance = new PactFlowGitWorkspace()
    const runValidation = Reflect.get(instance, 'runValidation') as (
      cwd: string, validation: { command: string; args: readonly string[]; timeoutMs: number },
    ) => Promise<{ exitCode: number }>
    const evidence = await runValidation.call(instance, root, {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("y".repeat(4 * 1024 * 1024))'],
      timeoutMs: 60_000,
    })
    expect(evidence.exitCode).toBe(0)
  })
})
