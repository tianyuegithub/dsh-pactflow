import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { Context } from '../../../../deepseek-harness-pactflow-upstream-pr/vendor/cordis/lib/index.js'
import { LocalSandboxProvider } from '../../../../deepseek-harness-pactflow-upstream-pr/packages/sandbox/sandbox-local/lib/index.js'
import { preflightLocalExecution } from '../src/local-preflight.ts'
import { isolatedGit, materializeLocalCheckout } from '../src/local-workspace.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'

vi.setConfig({ testTimeout: 60_000 })

type Mode = 'read-only' | 'workspace-write' | 'danger-full-access'
type SandboxPort = {
  confine(argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string }): {
    argv: string[]
    enforcement: 'full' | 'partial'
  }
}

interface Fixture {
  readonly mainRoot: string
  readonly managedRoot: string
  readonly source: string
  readonly spec: PactFlowGitRunSpec
  cleanup(): Promise<void>
}

async function fixture(): Promise<Fixture> {
  const mainRoot = await mkdtemp(join(homedir(), '.pactflow-sandbox-test-main-'))
  let managedRoot: string | undefined
  try {
    const createdManagedRoot = await mkdtemp(join(homedir(), '.pactflow-sandbox-test-task-'))
    managedRoot = createdManagedRoot
    const source = join(mainRoot, 'main-repository')
    await mkdir(source)
    await isolatedGit(source, ['init', '--quiet', '--initial-branch', 'main'])
    await isolatedGit(source, ['config', '--local', 'user.name', 'PactFlow Test'])
    await isolatedGit(source, ['config', '--local', 'user.email', 'pactflow-test@example.invalid'])
    await writeFile(join(source, 'tracked.txt'), 'baseline\n')
    await isolatedGit(source, ['add', 'tracked.txt'])
    await isolatedGit(source, ['commit', '--quiet', '-m', 'baseline'])
    const baseCommit = await isolatedGit(source, ['rev-parse', 'HEAD'])
    const spec: PactFlowGitRunSpec = {
      checkoutKind: 'isolated-clone',
      remote: 'origin',
      remoteUrl: source,
      defaultBranch: 'main',
      baseCommit,
      branch: 'pactflow/test/preflight',
      worktreePath: join(createdManagedRoot, 'task-repository'),
      validationCommands: [],
    }
    await materializeLocalCheckout(source, spec)
    return {
      mainRoot,
      managedRoot: createdManagedRoot,
      source,
      spec,
      cleanup: async () => {
        await rm(createdManagedRoot, { recursive: true, force: true })
        await rm(mainRoot, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (managedRoot !== undefined) {
      await rm(managedRoot, { recursive: true, force: true })
    }
    await rm(mainRoot, { recursive: true, force: true })
    throw error
  }
}

function ports(options: {
  readonly mode?: Mode
  readonly policy?: { resolve(request: unknown): { mode: Mode } } | undefined
  readonly sandbox?: SandboxPort | undefined
  readonly provider?: object
  readonly getProvider?: (name: string) => object
}) {
  const provider = options.provider ?? {}
  const policy = options.policy ?? (options.mode === undefined ? undefined : {
    resolve: vi.fn(() => ({ mode: options.mode! })),
  })
  const parent = {
    session: { id: 'preflight-session' },
    ctx: {
      get: (name: string) => name === 'sandboxPolicy' ? policy : name === 'sandbox' ? options.sandbox : undefined,
    },
  } as unknown as Agent
  const subagents = {
    getProvider: vi.fn(options.getProvider ?? (() => provider)),
  } as unknown as SubagentRuntime
  return { parent, subagents }
}

function missingSpec(): PactFlowGitRunSpec {
  return {
    checkoutKind: 'isolated-clone', remote: 'origin', remoteUrl: '/missing', defaultBranch: 'main',
    baseCommit: '0'.repeat(40), branch: 'pactflow/test/missing', worktreePath: '/missing', validationCommands: [],
  }
}

const seatbeltUsable = process.platform === 'darwin' && spawnSync('sandbox-exec', [
  '-p', '(version 1) (allow default)', '--', 'true',
], { timeout: 5_000, stdio: 'ignore' }).status === 0

describe.skipIf(!seatbeltUsable)('local preflight with the public sandbox-local Seatbelt backend', () => {
  it('allows a fresh independent repository, protects the main Git directory, and rejects a shared worktree', async () => {
    const f = await fixture()
    const sandboxContext = new Context()
    try {
      await sandboxContext.plugin(LocalSandboxProvider, {})
      const sandbox = (sandboxContext as unknown as { get(name: string): unknown }).get('sandbox') as SandboxPort
      const { parent, subagents } = ports({ mode: 'workspace-write', sandbox })
      const sentinel = join(f.source, '.git', 'preflight-sentinel')
      await writeFile(sentinel, 'unchanged\n')

      const assertCurrent = await preflightLocalExecution(parent, subagents, 'spawn', f.spec, join(f.source, '.git'))
      expect(() => { assertCurrent() }).not.toThrow()
      expect(await readFile(sentinel, 'utf8')).toBe('unchanged\n')
      expect((await readdir(join(f.source, '.git'))).filter(name => name.startsWith('pactflow-preflight-'))).toEqual([])

      const sharedPath = join(f.managedRoot, 'shared-worktree')
      await isolatedGit(f.source, ['worktree', 'add', '--quiet', '-b', 'shared-preflight', sharedPath, f.spec.baseCommit])
      expect((await lstat(join(sharedPath, '.git'))).isFile()).toBe(true)
      await writeFile(join(sharedPath, 'uncommitted.txt'), 'old layout reproduction\n')
      const deniedArgv = sandbox.confine(['git', '-C', sharedPath, 'add', 'uncommitted.txt'], { mode: 'workspace-write', workspaceRoot: sharedPath }).argv
      const denied = spawnSync(deniedArgv[0]!, deniedArgv.slice(1), { cwd: sharedPath, encoding: 'utf8', timeout: 10000 })
      expect(denied.status).not.toBe(0)
      expect(denied.stderr).toMatch(/index.lock.*(?:Operation not permitted|Permission denied)/)
      expect(await isolatedGit(sharedPath, ['diff', '--cached', '--name-only'])).toBe('')
      await expect(preflightLocalExecution(parent, subagents, 'spawn', {
        ...f.spec,
        branch: 'shared-preflight',
        worktreePath: sharedPath,
      }, join(f.source, '.git'))).rejects.toThrow(/Git 元数据必须位于仓内独立目录/)
    } finally {
      await sandboxContext.fiber.dispose()
      await f.cleanup()
    }
  })
})

describe('local preflight fail-closed guards', () => {
  it('rejects unsupported providers, missing policy, and read-only mode before probing', async () => {
    const unsupported = ports({ mode: 'workspace-write' })
    await expect(preflightLocalExecution(unsupported.parent, unsupported.subagents, 'remote', missingSpec(), '/missing'))
      .rejects.toThrow(/尚未验证该提供器/)

    const missingPolicy = ports({})
    await expect(preflightLocalExecution(missingPolicy.parent, missingPolicy.subagents, 'spawn', missingSpec(), '/missing'))
      .rejects.toThrow(/缺少宿主沙箱策略服务/)

    const readOnly = ports({ mode: 'read-only' })
    await expect(preflightLocalExecution(readOnly.parent, readOnly.subagents, 'spawn', missingSpec(), '/missing'))
      .rejects.toThrow(/当前为只读/)
  })

  it('rejects a missing sandbox and partial enforcement for a valid independent checkout', async () => {
    const f = await fixture()
    try {
      const missingSandbox = ports({ mode: 'workspace-write' })
      await expect(preflightLocalExecution(missingSandbox.parent, missingSandbox.subagents, 'spawn', f.spec, join(f.source, '.git')))
        .rejects.toThrow(/缺少原生沙箱/)

      const partial = ports({ mode: 'workspace-write', sandbox: {
        confine: argv => ({ argv: [...argv], enforcement: 'partial' }),
      } })
      await expect(preflightLocalExecution(partial.parent, partial.subagents, 'spawn', f.spec, join(f.source, '.git')))
        .rejects.toThrow(/完整文件沙箱支持/)
    } finally {
      await f.cleanup()
    }
  })

  it('rejects policy mode or provider identity changes detected after the probe', async () => {
    const f = await fixture()
    try {
      let policyCalls = 0
      const changingPolicy = ports({ policy: {
        resolve: () => ({ mode: policyCalls++ === 0 ? 'danger-full-access' : 'workspace-write' }),
      } })
      await expect(preflightLocalExecution(changingPolicy.parent, changingPolicy.subagents, 'spawn', f.spec, join(f.source, '.git')))
        .rejects.toThrow(/预检后执行器或沙箱策略变化/)

      const firstProvider = {}
      const secondProvider = {}
      let providerCalls = 0
      const changingProvider = ports({
        mode: 'danger-full-access',
        getProvider: () => providerCalls++ === 0 ? firstProvider : secondProvider,
      })
      await expect(preflightLocalExecution(changingProvider.parent, changingProvider.subagents, 'spawn', f.spec, join(f.source, '.git')))
        .rejects.toThrow(/预检后执行器或沙箱策略变化/)
    } finally {
      await f.cleanup()
    }
  })

  it('honors cancellation without returning a usable assertion', async () => {
    const f = await fixture()
    try {
      const controller = new AbortController()
      controller.abort()
      const { parent, subagents } = ports({ mode: 'danger-full-access' })
      await expect(preflightLocalExecution(parent, subagents, 'spawn', f.spec, join(f.source, '.git'), controller.signal))
        .rejects.toThrow(/本地派发前检查失败/)
    } finally {
      await f.cleanup()
    }
  })
})
