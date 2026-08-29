import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowGiteaClient } from '../src/gitea.ts'
import type { PactFlowGiteaBinding } from '../src/types.ts'

describe('PactFlow Gitea admission', () => {
  const servers: ReturnType<typeof createServer>[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })

  async function fixture(protectedBranch: boolean): Promise<PactFlowGiteaBinding> {
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe('token test-token')
      response.setHeader('content-type', 'application/json')
      if (request.url?.endsWith('/branch_protections/main') === true) {
        if (!protectedBranch) {
          response.statusCode = 404
          response.end('{}')
          return
        }
        response.end(JSON.stringify({ required_approvals: 2, status_check_contexts: ['ci/test'] }))
        return
      }
      response.end(JSON.stringify({
        full_name: 'owner/repo', default_branch: 'main', private: true, archived: false,
        default_merge_style: 'merge',
      }))
    })
    servers.push(server)
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address() as AddressInfo
    return {
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      owner: 'owner', repo: 'repo', tokenCredentialRef: 'GITEA_TOKEN',
    }
  }

  it('returns repository identity and branch protection without exposing the token', async () => {
    const client = new PactFlowGiteaClient()
    const status = await client.verify(await fixture(true), 'test-token', 'main')
    expect(status).toEqual({
      fullName: 'owner/repo', defaultBranch: 'main', private: true, archived: false,
      branchProtected: true, requiredApprovals: 2, statusChecks: ['ci/test'], mergeStyle: 'merge',
    })
    expect(JSON.stringify(status)).not.toContain('test-token')
  })

  it('reports an unprotected branch and rejects repository identity drift', async () => {
    const client = new PactFlowGiteaClient()
    await expect(client.verify(await fixture(false), 'test-token', 'main'))
      .resolves.toMatchObject({ branchProtected: false })
    await expect(client.verify(await fixture(true), 'test-token', 'develop'))
      .rejects.toThrow(/does not match/)
  })
})
