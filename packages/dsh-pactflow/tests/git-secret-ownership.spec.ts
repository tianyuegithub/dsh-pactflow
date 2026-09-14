import { mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PACTFLOW_GIT_SECRET_PREFIX, PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'

/**
 * `k3s_git_secret_name` is a free string on a model-callable tool, and whatever
 * it names is mounted as a volume into a Pod whose prompt the same model wrote.
 * Only the shape of the name was ever checked, so any Opaque Secret in the
 * namespace — another service's credentials, the run's own model or artifact
 * Secret — could be named and read out through the task branch.
 *
 * The listing endpoint already filters to the `pactflow-git-` prefix, but a UI
 * filter is a convention, not a boundary. The binding entry point enforces it.
 */

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-git-secret-'))
  roots.push(root)
  const fixture = createGitFixture(root)
  execFileSync('git', ['-C', fixture.workspace, 'fetch', 'origin'], { stdio: 'ignore' })
  return fixture.workspace
}

const bind = (path: string, name: string) => new PactFlowGitWorkspace().inspectBinding(path, {
  remote: 'origin', defaultBranch: 'main', k3sGitSecretName: name,
})

describe('PactFlow K3s Git Secret ownership', () => {
  it('refuses a Secret outside the PactFlow Git namespace prefix', async () => {
    const path = await workspace()
    for (const name of [
      'dsh-pf-abcdef0123456789abcd-model',   // another run's model credentials
      'dsh-pf-abcdef0123456789abcd-artifact', // object-store long-lived keys
      'kube-root-ca',
      'pactflow-registry-pull',               // adjacent but not a Git Secret
    ]) {
      await expect(bind(path, name), name).rejects.toThrow(/must be named/)
    }
  })

  it('accepts a Secret that carries the prefix', async () => {
    const path = await workspace()
    const binding = await bind(path, `${PACTFLOW_GIT_SECRET_PREFIX}demo-v2`)
    expect(binding.k3sGitSecretName).toBe(`${PACTFLOW_GIT_SECRET_PREFIX}demo-v2`)
  })

  it('still rejects a name that is not a legal Kubernetes object name', async () => {
    const path = await workspace()
    await expect(bind(path, `${PACTFLOW_GIT_SECRET_PREFIX}Bad_Name`)).rejects.toThrow(/invalid/)
  })

  it('leaves the binding alone when no Secret is named', async () => {
    const path = await workspace()
    const binding = await new PactFlowGitWorkspace().inspectBinding(path, { remote: 'origin', defaultBranch: 'main' })
    expect(binding.k3sGitSecretName).toBeUndefined()
  })
})
