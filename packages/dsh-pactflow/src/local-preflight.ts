import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { PactFlowGitRunSpec } from './types.ts'
import { assertLocalCheckout, isWithin, localGitEnvironment, localMavenCache, localRuntimePath } from './local-workspace.ts'

type Mode = 'read-only' | 'workspace-write' | 'danger-full-access'
interface PolicyPort { resolve(request: { session: Agent['session'] }): { mode: Mode } }
interface SandboxPort { confine(argv: readonly string[], policy: { mode: Exclude<Mode, 'danger-full-access'>; workspaceRoot: string }): { argv: string[]; enforcement: 'full' | 'partial' } }

/** Only portable public service methods; no host monkey-patching or broader root grants. */
function services(parent: Agent): { policy: PolicyPort | undefined; sandbox: SandboxPort | undefined } {
  const ctx = parent.ctx as unknown as { get(name: string): unknown }
  return { policy: ctx.get('sandboxPolicy') as PolicyPort | undefined, sandbox: ctx.get('sandbox') as SandboxPort | undefined }
}

export const LOCAL_PREFLIGHT_SCRIPT = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const [root,runtime,cache,forbidden]=process.argv.slice(1);
let stage='write',probe;
try {
  fs.mkdirSync(runtime,{recursive:true}); fs.mkdirSync(cache,{recursive:true});
  probe=fs.mkdtempSync(path.join(runtime,'preflight-'));
  const marker=path.join(cache,'preflight-'+path.basename(probe));fs.writeFileSync(marker,'cache',{flag:'wx'});fs.unlinkSync(marker);
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|CONFIG_COUNT|CONFIG_KEY_|CONFIG_VALUE_|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)/.test(key)) delete env[key];
  function run(command,args,cwd=probe){const r=cp.spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:20000,maxBuffer:1048576});if(r.error||r.status!==0)throw Object.assign(new Error(stage),{code:r.error?.code||'EXIT_'+r.status});}
  stage='git';run('git',['init','--quiet']);run('git',['config','user.name','PactFlow Preflight']);run('git',['config','user.email','preflight@example.invalid']);
  run('git',['config','core.hooksPath',path.join(probe,'disabled-hooks')]);run('git',['config','commit.gpgsign','false']);
  fs.writeFileSync(path.join(probe,'proof.txt'),'preflight');run('git',['add','proof.txt']);run('git',['commit','--quiet','-m','preflight']);
  stage='boundary';
  if(forbidden){const target=path.join(forbidden,'pactflow-preflight-'+path.basename(probe));let wrote=false;try{fs.writeFileSync(target,'probe',{flag:'wx'});wrote=true;}catch(e){if(!['EPERM','EACCES','EROFS'].includes(e.code))throw e;}if(wrote){fs.unlinkSync(target);throw Object.assign(new Error('boundary'),{code:'UNEXPECTED_WRITE'});}}
  if(fs.existsSync(path.join(root,'pom.xml'))){stage='maven';run('mvn',['-Dmaven.repo.local='+cache,'-version'],root);stage='java';run('java',['-version'],root);}
  process.stdout.write('PREFLIGHT_OK');
}catch(e){process.stderr.write(JSON.stringify({stage,code:e.code||'FAILED'}));process.exitCode=1;}
finally{if(probe)fs.rmSync(probe,{recursive:true,force:true});}
`

/** Probe uses the native backend with the same effective mode and child cwd, before any model turn. */
export async function preflightLocalExecution(parent: Agent, subagents: SubagentRuntime, providerName: string,
  spec: PactFlowGitRunSpec, forbiddenGitDir: string, signal?: AbortSignal): Promise<() => void> {
  if (!['spawn', 'fork'].includes(providerName)) throw new Error('本地预检尚未验证该提供器的沙箱继承，拒绝执行')
  const provider = subagents.getProvider(providerName)
  const { policy, sandbox } = services(parent)
  if (!policy) throw new Error('本地预检缺少宿主沙箱策略服务，未启动执行代理')
  const mode = policy.resolve({ session: parent.session }).mode
  if (mode === 'read-only') throw new Error('本地执行需要工作区写权限，当前为只读')
  await assertLocalCheckout(spec)
  const root = await realpath(spec.worktreePath)
  const temporary = await realpath(tmpdir())
  const unixTemp = await realpath('/tmp').catch(() => '/tmp')
  const forbidden = await realpath(forbiddenGitDir)
  const covered = [root, temporary, unixTemp].some(base => base === forbidden || isWithin(base, forbidden))
  const command = [process.execPath, '-e', LOCAL_PREFLIGHT_SCRIPT, root, localRuntimePath(spec), localMavenCache(spec), mode === 'workspace-write' && !covered ? forbidden : '']
  let argv = command
  if (mode !== 'danger-full-access') {
    if (!sandbox) throw new Error('本地预检缺少原生沙箱，拒绝无约束回落')
    const confined = sandbox.confine(command, { mode, workspaceRoot: root })
    if (confined.enforcement !== 'full') throw new Error('本地预检要求完整文件沙箱支持')
    argv = confined.argv
  }
  await new Promise<void>((accept, reject) => execFile(argv[0]!, argv.slice(1), {
    cwd: root, env: localGitEnvironment(), timeout: 60000, maxBuffer: 1048576, encoding: 'utf8', ...(signal ? { signal } : {}),
  }, (error, stdout, stderr) => {
    if (!error && stdout === 'PREFLIGHT_OK') { accept(); return }
    const detail = /\{"stage":"[a-z]+","code":"[A-Z_0-9-]+"\}/.exec(stderr)?.[0] ?? '原生沙箱拒绝或预检进程失败'
    reject(new Error(`本地派发前检查失败：${detail}；未启动业务执行代理`))
  }))
  const assertCurrent = (): void => {
    // ctx.get() hands out a fresh Cordis traceable proxy per read, so service
    // identity cannot be compared across calls; re-derive the semantic facts.
    const current = services(parent)
    const drifted: string[] = []
    if (subagents.getProvider(providerName) !== provider) drifted.push('执行器提供器')
    if (current.policy?.resolve({ session: parent.session }).mode !== mode) drifted.push('沙箱策略')
    if (mode !== 'danger-full-access'
      && (current.sandbox === undefined
        || current.sandbox.confine(command, { mode, workspaceRoot: root }).enforcement !== 'full')) drifted.push('原生沙箱')
    if (drifted.length > 0) throw new Error(`预检后执行器或沙箱策略变化（${drifted.join('、')}），请重新派发`)
    signal?.throwIfAborted()
  }
  assertCurrent()
  return assertCurrent
}
