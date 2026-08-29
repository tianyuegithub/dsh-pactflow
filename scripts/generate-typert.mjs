import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
const artifacts = generator.generate(['dsh-pactflow'], ['host'])
if (artifacts.length !== 1 || artifacts[0]?.package !== 'dsh-pactflow') {
  throw new Error(`expected one dsh-pactflow Typert artifact, received ${String(artifacts.length)}`)
}
const artifact = artifacts[0]
const output = resolve(root, artifact.packageRoot, 'lib')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, `typert.${artifact.face}.js`), artifact.js)
writeFileSync(resolve(output, `typert.${artifact.face}.d.ts`), artifact.dts)
if (artifact.remote === undefined) throw new Error('dsh-pactflow Host emitted no Remote contribution')
writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
console.log('generate-typert: Host and Remote artifacts emitted')
