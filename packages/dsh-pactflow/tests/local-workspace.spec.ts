import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyRecovery,
  assertLocalCheckout,
  captureRecovery,
  isolatedGit,
  localMavenCache,
  localRuntimePath,
  materializeLocalCheckout,
  type LocalGit,
} from '../src/local-workspace.ts'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'

vi.setConfig({ testTimeout: 30_000 })

const javaUsable = spawnSync('java', ['-version'], { timeout: 5_000, stdio: 'ignore' }).status === 0

let fixtureRoot = ''
let source = ''
let remote = ''
let baseCommit = ''
let sequence = 0

async function initializeFixture(): Promise<void> {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'pactflow-local-workspace-'))
  source = join(fixtureRoot, 'source')
  remote = join(fixtureRoot, 'remote.git')
  await mkdir(source)
  await isolatedGit(source, ['init', '--quiet', '--initial-branch', 'main'])
  await isolatedGit(source, ['config', '--local', 'user.name', 'PactFlow Test'])
  await isolatedGit(source, ['config', '--local', 'user.email', 'pactflow-test@example.invalid'])
  await writeFile(join(source, 'tracked.txt'), 'baseline\n')
  await writeFile(join(source, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255]))
  await isolatedGit(source, ['add', 'tracked.txt', 'binary.bin'])
  await isolatedGit(source, ['commit', '--quiet', '-m', 'fixed baseline'])
  baseCommit = await isolatedGit(source, ['rev-parse', 'HEAD'])
  await isolatedGit(fixtureRoot, ['init', '--quiet', '--bare', remote])
  await isolatedGit(source, ['remote', 'add', 'origin', remote])
  await isolatedGit(source, ['push', '--quiet', 'origin', 'main'])
}

function runSpec(label: string, recoveryInput?: PactFlowGitRunSpec['recoveryInput']): PactFlowGitRunSpec {
  sequence += 1
  return {
    checkoutKind: 'isolated-clone',
    ...(recoveryInput === undefined ? {} : { recoveryInput }),
    remote: 'origin',
    remoteUrl: remote,
    defaultBranch: 'main',
    baseCommit,
    branch: `pactflow/test/${label}-${sequence}`,
    worktreePath: join(fixtureRoot, 'tasks', `${label}-${sequence}`),
    validationCommands: [],
  }
}

async function materialize(spec: PactFlowGitRunSpec): Promise<void> {
  await mkdir(join(fixtureRoot, 'tasks'), { recursive: true })
  await materializeLocalCheckout(source, spec)
}

async function expectMissing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

beforeEach(async () => {
  sequence = 0
  await initializeFixture()
})

afterEach(async () => {
  if (fixtureRoot !== '') await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = ''
})

describe('local workspace isolation', () => {
  it('materializes the fixed base into a self-contained repository', async () => {
    const spec = runSpec('fresh')
    await materialize(spec)

    expect(await isolatedGit(spec.worktreePath, ['rev-parse', 'HEAD'])).toBe(baseCommit)
    const metadata = join(spec.worktreePath, '.git')
    expect((await lstat(metadata)).isDirectory()).toBe(true)
    expect(await realpath(await isolatedGit(spec.worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])))
      .toBe(await realpath(metadata))
    await expectMissing(join(metadata, 'objects', 'info', 'alternates'))
    expect((await stat(localMavenCache(spec))).isDirectory()).toBe(true)

    const looseObject = (root: string) => join(root, '.git', 'objects', baseCommit.slice(0, 2), baseCommit.slice(2))
    try {
      const sourceObject = await stat(looseObject(source))
      const taskObject = await stat(looseObject(spec.worktreePath))
      expect({ dev: taskObject.dev, ino: taskObject.ino }).not.toEqual({ dev: sourceObject.dev, ino: sourceObject.ino })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  })

  it('does not copy prior tracked or untracked dirt from the source checkout', async () => {
    await writeFile(join(source, 'tracked.txt'), 'dirty source\n')
    await writeFile(join(source, 'source only.txt'), 'must not cross the boundary\n')
    const spec = runSpec('clean-input')
    await materialize(spec)

    expect(await readFile(join(spec.worktreePath, 'tracked.txt'), 'utf8')).toBe('baseline\n')
    await expectMissing(join(spec.worktreePath, 'source only.txt'))
    expect(await isolatedGit(spec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
  })

  it.each(['metadata-pointer', 'remote', 'branch'] as const)('rejects %s identity drift', async variant => {
    const spec = runSpec(variant)
    await materialize(spec)
    if (variant === 'metadata-pointer') {
      await rename(join(spec.worktreePath, '.git'), join(spec.worktreePath, '.git-real'))
      await writeFile(join(spec.worktreePath, '.git'), 'gitdir: .git-real\n')
    } else if (variant === 'remote') {
      await isolatedGit(spec.worktreePath, ['remote', 'set-url', spec.remote, join(fixtureRoot, 'other.git')])
    } else {
      await isolatedGit(spec.worktreePath, ['switch', '--quiet', '-c', 'drifted-branch'])
    }
    await expect(assertLocalCheckout(spec)).rejects.toThrow()
  })

  it('captures byte-exact dirty state and applies exactly the selected recovery snapshot', async () => {
    const sourceSpec = runSpec('recovery-source')
    await materialize(sourceSpec)
    const binaryAtCapture = Buffer.from([255, 0, 9, 8, 7, 10])
    const spacedAtCapture = Buffer.from('line with trailing spaces   \nlast line  ')
    const executableAtCapture = Buffer.from('#!/bin/sh\nprintf recovered\n')
    await writeFile(join(sourceSpec.worktreePath, 'binary.bin'), binaryAtCapture)
    await writeFile(join(sourceSpec.worktreePath, 'notes with spaces.txt'), spacedAtCapture)
    await writeFile(join(sourceSpec.worktreePath, 'recover.sh'), executableAtCapture, { mode: 0o755 })
    await chmod(join(sourceSpec.worktreePath, 'recover.sh'), 0o755)

    const selected = await captureRecovery('run-selected', sourceSpec)
    await writeFile(join(sourceSpec.worktreePath, 'notes with spaces.txt'), 'different candidate\n')
    const other = await captureRecovery('run-selected', sourceSpec)
    expect(other.digest).not.toBe(selected.digest)
    expect(selected.changedFiles).toBe(3)

    const sourceHeadBefore = await isolatedGit(sourceSpec.worktreePath, ['rev-parse', 'HEAD'])
    const sourceDirtyBefore = await isolatedGit(sourceSpec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
    const targetSpec = runSpec('recovery-target', {
      runId: selected.runId,
      digest: selected.digest,
      sourceHead: selected.sourceHead,
    })
    await materialize(targetSpec)
    await applyRecovery(targetSpec, selected)

    expect(await readFile(join(targetSpec.worktreePath, 'binary.bin'))).toEqual(binaryAtCapture)
    expect(await readFile(join(targetSpec.worktreePath, 'notes with spaces.txt'))).toEqual(spacedAtCapture)
    expect(await readFile(join(targetSpec.worktreePath, 'recover.sh'))).toEqual(executableAtCapture)
    expect((await stat(join(targetSpec.worktreePath, 'recover.sh'))).mode & 0o111).toBe(0o111)
    expect(await isolatedGit(sourceSpec.worktreePath, ['rev-parse', 'HEAD'])).toBe(sourceHeadBefore)
    expect(await isolatedGit(sourceSpec.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(sourceDirtyBefore)
  })

  it('rejects recovery digest and base mismatches', async () => {
    const sourceSpec = runSpec('mismatch-source')
    await materialize(sourceSpec)
    await writeFile(join(sourceSpec.worktreePath, 'tracked.txt'), 'candidate\n')
    const candidate = await captureRecovery('run-mismatch', sourceSpec)
    const targetSpec = runSpec('mismatch-target', {
      runId: candidate.runId,
      digest: candidate.digest,
      sourceHead: candidate.sourceHead,
    })
    await materialize(targetSpec)

    await expect(applyRecovery({ ...targetSpec, recoveryInput: { ...targetSpec.recoveryInput!, digest: 'wrong-digest' } }, candidate))
      .rejects.toThrow(/不匹配/)
    await expect(applyRecovery({ ...targetSpec, baseCommit: '0'.repeat(40) }, candidate)).rejects.toThrow(/不匹配/)
  })

  it('rejects symlinked and path-escaping untracked recovery inputs', async () => {
    const spec = runSpec('unsafe-source')
    await materialize(spec)
    const outside = join(fixtureRoot, 'outside.txt')
    await writeFile(outside, 'outside\n')
    await symlink(outside, join(spec.worktreePath, 'linked.txt'))
    await expect(captureRecovery('run-symlink', spec)).rejects.toThrow(/普通文件/)
    await rm(join(spec.worktreePath, 'linked.txt'))

    const escapingGit: LocalGit = async (cwd, args, signal) => {
      if (args[0] === 'ls-files' && args.includes('--others')) return '../escape.txt\0'
      return await isolatedGit(cwd, args, signal)
    }
    await expect(captureRecovery('run-escape', spec, escapingGit)).rejects.toThrow(/路径越界/)
  })

  it('allows a real task commit without moving the source checkout HEAD', async () => {
    const spec = runSpec('worker-commit')
    const sourceHead = await isolatedGit(source, ['rev-parse', 'HEAD'])
    await materialize(spec)
    await writeFile(join(spec.worktreePath, 'worker.txt'), 'isolated worker output\n')
    await isolatedGit(spec.worktreePath, ['add', 'worker.txt'])
    await isolatedGit(spec.worktreePath, ['commit', '--quiet', '-m', 'worker result'])

    const taskHead = await isolatedGit(spec.worktreePath, ['rev-parse', 'HEAD'])
    expect(taskHead).not.toBe(baseCommit)
    expect(await isolatedGit(spec.worktreePath, ['merge-base', '--is-ancestor', baseCommit, taskHead])).toBe('')
    expect(await isolatedGit(source, ['rev-parse', 'HEAD'])).toBe(sourceHead)
    expect(await isolatedGit(source, ['branch', '--show-current'])).toBe('main')
  })

  it('rejects a repository hook while command-level push protection prevents it from running', async () => {
    const spec = runSpec('protected-push')
    await materialize(spec)
    const sentinel = join(fixtureRoot, 'pre-push-sentinel')
    const hook = join(localRuntimePath(spec), 'hooks', 'pre-push')
    await writeFile(hook, `#!/bin/sh\nprintf hook-ran > ${shellLiteral(sentinel)}\n`, { mode: 0o700 })
    await chmod(hook, 0o700)

    await expect(assertLocalCheckout(spec)).rejects.toThrow(/不能提供宿主执行钩子/)
    await isolatedGit(spec.worktreePath, ['push', '--quiet', spec.remote, `HEAD:refs/heads/${spec.branch}`])
    await expectMissing(sentinel)
    expect(await isolatedGit(fixtureRoot, ['--git-dir', remote, 'rev-parse', `refs/heads/${spec.branch}`]))
      .toBe(await isolatedGit(spec.worktreePath, ['rev-parse', 'HEAD']))
  })

  it.each([
    'core.sshCommand',
    'include.path',
  ] as const)('rejects unauthorized local Git config %s', async key => {
    const spec = runSpec(`unsafe-config-${key.replace('.', '-')}`)
    await materialize(spec)
    const value = key === 'core.sshCommand'
      ? 'sh -c "touch unauthorized-ssh"'
      : join(fixtureRoot, 'untrusted-git-config')
    await isolatedGit(spec.worktreePath, ['config', '--local', key, value])
    await expect(assertLocalCheckout(spec)).rejects.toThrow(/包含未授权的执行设置/)
  })

  it.skipIf(!javaUsable)('passes the private Maven cache through JAVA_TOOL_OPTIONS to Java launched by an mvnw-style script', async () => {
    const original = runSpec('mvnw-java')
    const spec: PactFlowGitRunSpec = {
      ...original,
      worktreePath: join(fixtureRoot, 'tasks', 'task repository with spaces'),
    }
    await materialize(spec)
    const wrapper = join(spec.worktreePath, 'mvnw')
    const proof = join(fixtureRoot, 'java settings proof with spaces.txt')
    const expectedCache = localMavenCache(spec)
    await writeFile(wrapper, [
      '#!/bin/sh',
      'set -eu',
      '[ "$#" -eq 2 ]',
      'proof=$1',
      'expected=$2',
      'java -XshowSettings:properties -version 2> "$proof"',
      'grep -F "maven.repo.local = $expected" "$proof" > /dev/null',
      '',
    ].join('\n'), { mode: 0o700 })
    await chmod(wrapper, 0o700)
    await isolatedGit(spec.worktreePath, ['add', 'mvnw'])
    await isolatedGit(spec.worktreePath, ['commit', '--quiet', '-m', 'add mvnw validation fixture'])
    const command = { command: wrapper, args: [proof, expectedCache], timeoutMs: 15_000 }
    const authorizedCommands = [command]
    const result = await new PactFlowGitWorkspace().validateResult({
      ...spec,
      validationCommands: authorizedCommands,
    }, authorizedCommands)

    expect(result.validations).toHaveLength(1)
    expect(result.validations[0]).toMatchObject({ ...command, exitCode: 0 })
    expect(await readFile(proof, 'utf8')).toContain(`maven.repo.local = ${expectedCache}`)
  })
})
