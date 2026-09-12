// Local native-DSH acceptance: no model/network access; only disposable containers.
import { spawn, execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, chmod, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executionDigest } from '../packages/dsh-pactflow/lib/types/execution-plan.js'
const root=await mkdtemp(join(tmpdir(), 'pf-relay-smoke-')); await chmod(root,0o755); await mkdir(`${root}/repo`,{mode:0o777}); await chmod(`${root}/repo`,0o777)
const pair=generateKeyPairSync('ed25519'); await writeFile(`${root}/interaction-public-key.pem`,pair.publicKey.export({type:'spki',format:'pem'})); await writeFile(`${root}/prompt.txt`,'Inspect relay-proof.json. Do not run external commands. Reply DONE.')
const name=`pf-relay-smoke-${randomUUID().slice(0,8)}`
let output=''; let ended=false; let count=0
const child=spawn('docker',['run','--pull','never','--rm','--platform','linux/amd64','--name',name,'--network','none','--env','OPENAI_API_KEY','--env','OPENAI_BASE_URL=https://example.invalid','--env','MODEL=fixture','--env','PACTFLOW_INTERACTION_PROTOCOL=dsh-worker-interactions/v1','--env','PACTFLOW_RUN_ID=run-fixture','--env','PACTFLOW_POD_UID=pod-fixture','--env','PROMPT_PATH=/opt/dsh-pactflow/prompt.txt','--mount',`type=bind,src=${root},dst=/opt/dsh-pactflow,readonly`,'--mount',`type=bind,src=${root}/repo,dst=/workspace/repo`,'--workdir','/workspace/repo','--entrypoint','/opt/pactflow-worker/runner.sh','pactflow-dsh-interactions:acceptance'],{env:{...process.env,OPENAI_API_KEY:'isolated-fixture-only'},stdio:['ignore','pipe','pipe']})
for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{output=(output+d).slice(-12000)})
child.on('exit',()=>{ended=true})

try {
 const deadline=Date.now()+20000
 while(Date.now()<deadline&&!ended&&count<3){
  await new Promise(r=>setTimeout(r,300))
  const bridge=spawn('docker',['exec','-i',name,'node','/opt/pactflow-worker/connect.mjs'],{stdio:['pipe','pipe','pipe']})
  let buffer=''
  bridge.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let frame;try{frame=JSON.parse(line)}catch{continue};if(frame.type==='request'){
   const r=frame.request;process.stdout.write(`request ${r.kind} ${r.toolName??''}\n`)
   const answer=r.kind==='question'?{answers:[{id:'colour',selected:['蓝色']}]}:{decision:r.toolName==='relay_acceptance_forbidden'?'reject':'approve'}
   const unsigned={runId:'run-fixture',podUid:'pod-fixture',expiresAt:r.expiresAt,type:'answer',bootId:r.bootId,requestId:r.requestId,digest:executionDigest(r),answer}
   bridge.stdin.write(JSON.stringify({...unsigned,signature:sign(null,Buffer.from(JSON.stringify(unsigned)),pair.privateKey).toString('base64')})+'\n');count++
  }}})
  await Promise.race([new Promise(r=>bridge.once('exit',r)),new Promise(r=>setTimeout(r,3000))])
  bridge.stdin.end()
 }
 for(let i=0;i<20&&!existsSync(`${root}/repo/relay-proof.json`)&&!ended;i++)await new Promise(r=>setTimeout(r,100))
 if(count!==3||!existsSync(`${root}/repo/relay-proof.json`))throw new Error(`Native container smoke failed; questions=${count}\n${output}`)
 process.stdout.write(`native container proof: ${await readFile(`${root}/repo/relay-proof.json`,'utf8')}`)
} finally {
 try { execFileSync('docker',['stop','-t','1',name],{stdio:'ignore'}) } catch {
   let remains = false
   try { remains = execFileSync('docker',['inspect','--format','{{.State.Running}}',name],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim() === 'true' } catch (error) {
     if (!ended) throw new Error('无法确认测试容器已停止；保留临时目录', { cause: error })
   }
   if (remains) throw new Error('测试容器未停止，保留临时目录')
 }
 await rm(root,{recursive:true,force:true})
}
