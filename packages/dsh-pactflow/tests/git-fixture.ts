import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

export interface GitFixture {
  readonly remote: string
  readonly workspace: string
}

export interface AuthenticatedGitServer {
  readonly url: string
  close(): Promise<void>
}

/** Create one credential-free remote, main baseline, and clone for real Git tests. */
export function createGitFixture(root: string): GitFixture {
  const remote = join(root, 'remote.git')
  const seed = join(root, 'seed')
  const workspace = join(root, 'workspace')
  git(['init', '--bare', remote])
  git(['init', seed])
  git(['-C', seed, 'config', 'user.name', 'PactFlow Test'])
  git(['-C', seed, 'config', 'user.email', 'pactflow@example.invalid'])
  git(['-C', seed, 'switch', '-c', 'main'])
  writeFileSync(join(seed, 'README.md'), 'PactFlow Worker baseline\n')
  git(['-C', seed, 'add', 'README.md'])
  git(['-C', seed, 'commit', '-m', 'baseline'])
  git(['-C', seed, 'remote', 'add', 'origin', remote])
  git(['-C', seed, 'push', '-u', 'origin', 'main'])
  git(['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(['clone', remote, workspace])
  git(['-C', workspace, 'config', 'user.name', 'PactFlow Worker'])
  git(['-C', workspace, 'config', 'user.email', 'worker@example.invalid'])
  return { remote, workspace }
}

/** Serve one bare repository through real Git Smart HTTP with Basic Auth. */
export async function serveAuthenticatedGit(
  root: string,
  remote: string,
  username: string,
  token: string,
): Promise<AuthenticatedGitServer> {
  git(['--git-dir', remote, 'config', 'http.receivepack', 'true'])
  const expected = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
  const server = createServer((request, response) => {
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="PactFlow Git"' })
      response.end()
      return
    }
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(requestUrl.pathname),
        QUERY_STRING: requestUrl.search.slice(1),
        REQUEST_METHOD: request.method ?? 'GET',
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        CONTENT_LENGTH: request.headers['content-length'] ?? '',
        REMOTE_USER: username,
        REMOTE_ADDR: request.socket.remoteAddress ?? '127.0.0.1',
        SERVER_PROTOCOL: `HTTP/${request.httpVersion}`,
        HTTP_GIT_PROTOCOL: request.headers['git-protocol'] ?? '',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    request.pipe(backend.stdin)
    let headers = Buffer.alloc(0)
    let sent = false
    backend.stdout.on('data', (chunk: Buffer) => {
      if (sent) {
        response.write(chunk)
        return
      }
      headers = Buffer.concat([headers, chunk])
      const marker = headers.indexOf('\r\n\r\n')
      if (marker < 0) return
      const lines = headers.subarray(0, marker).toString('utf8').split('\r\n')
      let status = 200
      const responseHeaders: Record<string, string> = {}
      for (const line of lines) {
        const separator = line.indexOf(':')
        if (separator < 0) continue
        const name = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim()
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10)
        else responseHeaders[name] = value
      }
      response.writeHead(status, responseHeaders)
      sent = true
      response.write(headers.subarray(marker + 4))
    })
    backend.once('close', (code) => {
      if (!sent) response.writeHead(code === 0 ? 200 : 500)
      response.end()
    })
    backend.once('error', () => {
      if (!sent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(address.port)}/${remote.slice(root.length + 1)}`,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close(error => { if (error === undefined) resolveClose(); else reject(error) })
    }),
  }
}

function git(args: readonly string[]): void {
  execFileSync('git', args, { stdio: 'ignore' })
}
