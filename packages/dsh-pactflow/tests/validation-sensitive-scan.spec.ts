import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'

/**
 * The sensitive-change list is stated to the human approving a delivery, and an
 * empty list is rendered as the positive claim "验证敏感文件改动：无". Two ways
 * that claim used to be false:
 *
 *  - the diff covered `commit~1..commit`, i.e. only the tip commit, so a Worker
 *    that committed three times hid anything it changed in the first two;
 *  - any failure to compute the diff was caught and turned into an empty list,
 *    so "could not determine" was reported to the reviewer as "nothing".
 *
 * Both are asserted against real git here, because the claim is only worth what
 * the underlying range is.
 */

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-sensitive-'))
  roots.push(root)
  const { workspace } = createGitFixture(root)
  const baseCommit = git(['-C', workspace, 'rev-parse', 'HEAD^{commit}'])
  const branch = 'pactflow/need/node/scan'
  git(['-C', workspace, 'switch', '-c', branch])
  const spec = (): PactFlowGitRunSpec => ({
    remote: 'origin', remoteUrl: join(root, 'remote.git'), defaultBranch: 'main',
    baseCommit, branch, worktreePath: workspace, validationCommands: [],
  })
  const commit = async (path: string, body: string, message: string) => {
    await writeFile(join(workspace, path), body)
    git(['-C', workspace, 'add', path])
    git(['-C', workspace, 'commit', '-m', message])
  }
  return { workspace, spec, commit }
}

describe('PactFlow "Worker produced no commit" guard', () => {
  it('still fires when code inputs were folded into the task baseline', async () => {
    // The guard compared HEAD against `spec.baseCommit`. But every declared code
    // input is merged with `--no-ff` into the task branch BEFORE the Worker starts,
    // so HEAD already differs from the baseline and the comparison could never be
    // true for a dependent task. A Worker that did nothing then passed every check,
    // its branch (carrying only the predecessor's code) was pushed, and the Run was
    // recorded as succeeded with a commit representing no work at all.
    const { workspace, spec, commit } = await fixture()
    const base = spec()

    // A predecessor's delivery, on its own branch.
    execFileSync('git', ['-C', workspace, 'switch', '-c', 'pactflow/need/dep/x', base.baseCommit], { stdio: 'ignore' })
    await commit('dep.txt', 'predecessor work\n', 'predecessor delivery')
    const inputCommit = git(['-C', workspace, 'rev-parse', 'HEAD^{commit}'])

    // The dependent task's branch, with that input folded in and nothing else.
    execFileSync('git', ['-C', workspace, 'switch', base.branch], { stdio: 'ignore' })
    execFileSync('git', ['-C', workspace, 'merge', '--no-ff', '--no-edit', inputCommit], { stdio: 'ignore' })

    const withInput = { ...base, codeInputs: [{ dependency: 'dep', branch: 'pactflow/need/dep/x', commit: inputCommit }] }
    await expect(new PactFlowGitWorkspace().validateResult(withInput)).rejects.toThrow(/produced no commit/)
  })

  it('accepts a dependent task that did commit on top of its inputs', async () => {
    const { workspace, spec, commit } = await fixture()
    const base = spec()
    execFileSync('git', ['-C', workspace, 'switch', '-c', 'pactflow/need/dep/y', base.baseCommit], { stdio: 'ignore' })
    await commit('dep.txt', 'predecessor work\n', 'predecessor delivery')
    const inputCommit = git(['-C', workspace, 'rev-parse', 'HEAD^{commit}'])
    execFileSync('git', ['-C', workspace, 'switch', base.branch], { stdio: 'ignore' })
    execFileSync('git', ['-C', workspace, 'merge', '--no-ff', '--no-edit', inputCommit], { stdio: 'ignore' })
    await commit('own.txt', 'the dependent task did its own work\n', 'dependent delivery')

    const withInput = { ...base, codeInputs: [{ dependency: 'dep', branch: 'pactflow/need/dep/y', commit: inputCommit }] }
    const evidence = await new PactFlowGitWorkspace().validateResult(withInput)
    expect(evidence.branch).toBe(base.branch)
  })
})

describe('PactFlow validation-sensitive scan', () => {
  it('covers every task commit, not only the tip', async () => {
    const { spec, commit } = await fixture()
    // The verification wiring is rewritten first, then buried under ordinary work.
    await commit('package.json', '{"scripts":{"test":"true"}}\n', 'relax the test script')
    await commit('feature.txt', 'ordinary work\n', 'implement the feature')
    await commit('more.txt', 'more ordinary work\n', 'polish')

    const evidence = await new PactFlowGitWorkspace().validateResult(spec())
    expect(evidence.validationSensitiveChanges).toEqual(['package.json'])
    expect(evidence.validationSensitiveScanFailed).toBeUndefined()
  })

  it('still reports nothing when the task left the wiring alone', async () => {
    const { spec, commit } = await fixture()
    await commit('feature.txt', 'ordinary work\n', 'implement the feature')
    const evidence = await new PactFlowGitWorkspace().validateResult(spec())
    expect(evidence.validationSensitiveChanges).toBeUndefined()
    expect(evidence.validationSensitiveScanFailed).toBeUndefined()
  })

  it('reports a failed scan as unknown rather than as "nothing changed"', async () => {
    const { workspace, spec, commit } = await fixture()
    await commit('package.json', '{}\n', 'touch the wiring')
    const base = spec()
    // Make the diff itself fail while the commit checks still pass: the object
    // the range starts at is gone. Reporting `[]` here would tell the reviewer
    // the wiring was untouched, which is the opposite of the truth.
    git(['-C', workspace, 'rev-parse', 'HEAD'])
    const workspaceGit = new PactFlowGitWorkspace()
    const original = Reflect.get(workspaceGit, 'git') as (cwd: string, args: readonly string[]) => Promise<string>
    Reflect.set(workspaceGit, 'git', async (cwd: string, args: readonly string[]) => {
      if (args[0] === 'diff') throw new Error('PactFlow Git command failed: diff')
      return original.call(workspaceGit, cwd, args)
    })

    const evidence = await workspaceGit.validateResult(base)
    expect(evidence.validationSensitiveScanFailed).toBe(true)
    expect(evidence.validationSensitiveChanges).toBeUndefined()
  })
})
