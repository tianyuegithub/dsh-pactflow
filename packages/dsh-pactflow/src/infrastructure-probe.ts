import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export interface PactFlowHttpProbeOptions {
  readonly url: string
  readonly tlsVerify?: boolean
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * Harbor lists repository names with the project prefix, while the artifact
 * endpoint expects a project-relative repository path. Nested repository
 * names must remain encoded after the HTTP router performs its first decode.
 */
export function harborRepositoryPathSegment(project: string, repository: string): string {
  const prefix = `${project}/`
  const relative = repository.startsWith(prefix) ? repository.slice(prefix.length) : repository
  if (relative.trim() === '') throw new Error('Harbor repository name is empty')
  return encodeURIComponent(encodeURIComponent(relative))
}

export function harborProjectName(project: string): string {
  const normalized = project.trim().replace(/^\/+|\/+$/g, '')
  if (normalized === '') throw new Error('Harbor project name is empty')
  return normalized
}

/** Small bounded HTTP probe which never logs headers or response bodies. */
export async function probeHttp(options: PactFlowHttpProbeOptions): Promise<number> {
  const url = new URL(options.url)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('probe URL must use HTTP(S)')
  return await new Promise<number>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      headers: options.headers,
      ...(url.protocol === 'https:' ? { rejectUnauthorized: options.tlsVerify ?? true } : {}),
      timeout: 10_000,
    }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('timeout', () => request.destroy(new Error('request timed out after 10000ms')))
    request.once('error', (error) => reject(new Error(`connection failed: ${error.message}`)))
    request.end()
  })
}

/** Read one bounded JSON response for product-owned discovery calls. */
export async function requestJson<T>(options: PactFlowHttpProbeOptions): Promise<{ status: number; value: T }> {
  const url = new URL(options.url)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('request URL must use HTTP(S)')
  return await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: options.headers,
      ...(url.protocol === 'https:' ? { rejectUnauthorized: options.tlsVerify ?? true } : {}),
      timeout: 10_000,
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 2_097_152) {
          response.destroy(new Error('response exceeded 2097152 bytes'))
          return
        }
        chunks.push(chunk)
      })
      response.once('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode ?? 0, value: JSON.parse(text) as T })
        } catch {
          reject(new Error('response was not valid JSON'))
        }
      })
    })
    request.once('timeout', () => request.destroy(new Error('request timed out after 10000ms')))
    request.once('error', (error) => reject(new Error(`connection failed: ${error.message}`)))
    request.end()
  })
}
