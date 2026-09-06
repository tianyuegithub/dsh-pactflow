/** Minimal Gitea 1.22 API client for repository and branch-protection admission. */

import type { PactFlowGiteaBinding, PactFlowGiteaStatus } from './types.ts'
import { joinUrlPath } from './infrastructure-probe.ts'

interface RepositoryResponse {
  readonly id?: unknown
  readonly full_name?: unknown
  readonly default_branch?: unknown
  readonly private?: unknown
  readonly archived?: unknown
  readonly default_merge_style?: unknown
  readonly clone_url?: unknown
  readonly ssh_url?: unknown
}

export interface PactFlowCreatedGiteaRepository {
  readonly fullName: string
  readonly cloneUrl: string
  readonly sshUrl?: string
  readonly defaultBranch: string
  readonly private: boolean
}

interface BranchProtectionResponse {
  readonly required_approvals?: unknown
  readonly status_check_contexts?: unknown
}

interface PullRequestResponse {
  readonly number?: unknown
  readonly html_url?: unknown
  readonly merge_commit_sha?: unknown
  readonly merged?: unknown
  readonly mergeable?: unknown
  readonly head?: { readonly ref?: unknown; readonly sha?: unknown }
  readonly base?: { readonly ref?: unknown }
}

export interface PactFlowGiteaPullRequest {
  readonly number: number
  readonly htmlUrl: string
  readonly mergeCommit?: string
  readonly merged: boolean
}

class GiteaRequestError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`PactFlow Gitea API returned HTTP ${String(status)}${detail.length === 0 ? '' : `: ${detail}`}`)
  }
}

type CandidatePayload = {
  readonly id?: unknown
  readonly full_name?: unknown
  readonly clone_url?: unknown
  readonly default_branch?: unknown
  readonly private?: unknown
  readonly empty?: unknown
  readonly description?: unknown
  readonly created_at?: unknown
}

function parseRepositorySummary(repository: CandidatePayload): PactFlowGiteaRepositorySummary | undefined {
  if (typeof repository.id !== 'number' || typeof repository.full_name !== 'string'
    || typeof repository.clone_url !== 'string' || typeof repository.default_branch !== 'string'
    || typeof repository.private !== 'boolean') return undefined
  return {
    id: repository.id, fullName: repository.full_name, cloneUrl: credentialFreeCloneUrl(repository.clone_url),
    defaultBranch: repository.default_branch, private: repository.private,
    empty: repository.empty === true,
    description: typeof repository.description === 'string' ? repository.description : '',
    createdAt: typeof repository.created_at === 'string' ? repository.created_at : '',
  }
}

/** Read-only repository summary used for creation reconciliation; never carries credentials. */
export interface PactFlowGiteaRepositorySummary {
  readonly id: number
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string
  readonly private: boolean
  readonly empty: boolean
  readonly description: string
  readonly createdAt: string
}

export class PactFlowGiteaClient {
  /** Create one user/org repository after the caller has presented and confirmed its preview. */
  async createRepository(
    baseUrl: string,
    username: string | undefined,
    token: string,
    input: { readonly owner: string; readonly repo: string; readonly private: boolean; readonly defaultBranch: string },
  ): Promise<PactFlowCreatedGiteaRepository> {
    const endpoint = username !== undefined && input.owner === username
      ? joinUrlPath(baseUrl, '/api/v1/user/repos')
      : joinUrlPath(baseUrl, `/api/v1/orgs/${encodeURIComponent(input.owner)}/repos`)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          authorization: username === undefined
            ? `token ${token}`
            : `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`,
        },
        body: JSON.stringify({
          name: input.repo, private: input.private, default_branch: input.defaultBranch,
          auto_init: false, description: 'Managed by dsh-pactflow',
        }),
      })
    } catch {
      throw new Error('PactFlow could not connect to the configured Gitea API')
    }
    if (response.status !== 201) {
      let detail = ''
      try {
        const body = await response.json() as { readonly message?: unknown }
        if (typeof body.message === 'string') detail = body.message.slice(0, 300)
      } catch {}
      throw new GiteaRequestError(response.status, detail)
    }
    const repository = await response.json() as RepositoryResponse
    if (repository.full_name !== `${input.owner}/${input.repo}` || repository.default_branch !== input.defaultBranch
      || typeof repository.clone_url !== 'string'
      || typeof repository.default_branch !== 'string' || repository.private !== input.private) {
      throw new Error('PactFlow Gitea create repository response is invalid')
    }
    const cloneUrl = credentialFreeCloneUrl(repository.clone_url)
    const sshUrl = typeof repository.ssh_url === 'string' ? credentialFreeCloneUrl(repository.ssh_url, true) : undefined
    return {
      fullName: repository.full_name, cloneUrl,
      defaultBranch: repository.default_branch, private: repository.private,
      ...(sshUrl === undefined ? {} : { sshUrl }),
    }
  }

  /** Read-only candidate listing for creation reconciliation; exact repo plus owner-scoped name matches. */
  async listCandidateRepositories(
    baseUrl: string,
    username: string | undefined,
    token: string,
    input: { readonly owner: string; readonly repo: string },
  ): Promise<PactFlowGiteaRepositorySummary[]> {
    const auth = username === undefined
      ? { authorization: `token ${token}` }
      : { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}` }
    const endpoints = [
      joinUrlPath(baseUrl, `/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`),
      joinUrlPath(baseUrl, `/api/v1/users/${encodeURIComponent(input.owner)}/repos`),
      joinUrlPath(baseUrl, `/api/v1/orgs/${encodeURIComponent(input.owner)}/repos`),
    ]
    const summaries = new Map<number, PactFlowGiteaRepositorySummary>()
    for (const endpoint of endpoints) {
      let response: Response
      try {
        response = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...auth } })
      } catch {
        continue
      }
      if (!response.ok) continue
      const payload = await response.json() as unknown
      for (const item of Array.isArray(payload) ? payload : [payload]) {
        const summary = parseRepositorySummary(item as CandidatePayload)
        if (summary === undefined || !summary.fullName.toLowerCase().includes(input.repo.toLowerCase())) continue
        if (summaries.has(summary.id)) continue
        summaries.set(summary.id, summary)
      }
      if (summaries.size >= 20) break
    }
    return [...summaries.values()].sort((left, right) => {
      const exactLeft = left.fullName === `${input.owner}/${input.repo}` ? 0 : 1
      const exactRight = right.fullName === `${input.owner}/${input.repo}` ? 0 : 1
      return exactLeft - exactRight || left.id - right.id
    })
  }

  /** Fetch one repository by its exact numeric id; the caller owns identity verification against the intent. */
  async getRepositoryById(
    baseUrl: string,
    username: string | undefined,
    token: string,
    id: number,
  ): Promise<PactFlowGiteaRepositorySummary> {
    const auth = username === undefined
      ? { authorization: `token ${token}` }
      : { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}` }
    const endpoint = joinUrlPath(baseUrl, `/api/v1/repositories/${String(Number(id))}`)
    let response: Response
    try {
      response = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...auth } })
    } catch {
      throw new Error('PactFlow could not connect to the configured Gitea API')
    }
    if (response.status === 404) throw new GiteaRequestError(404, 'confirmed repository does not exist')
    if (!response.ok) throw new GiteaRequestError(response.status, '')
    const summary = parseRepositorySummary(await response.json() as CandidatePayload)
    if (summary === undefined) throw new Error('PactFlow Gitea repository response is invalid')
    return summary
  }

  /** Verify repository identity, default branch, and protection without changing Gitea. */
  async verify(
    binding: PactFlowGiteaBinding,
    token: string,
    expectedDefaultBranch: string,
    signal?: AbortSignal,
  ): Promise<PactFlowGiteaStatus> {    const cancellation = signal === undefined ? {} : { signal }
    const repository = await this.request<RepositoryResponse>(binding, token, '', cancellation)
    if (repository.full_name !== `${binding.owner}/${binding.repo}`
      || repository.default_branch !== expectedDefaultBranch
      || typeof repository.private !== 'boolean'
      || typeof repository.archived !== 'boolean') {
      throw new Error('PactFlow Gitea repository identity or default branch does not match the Git binding')
    }
    const protection = await this.request<BranchProtectionResponse | undefined>(
      binding, token, `/branch_protections/${encodeURIComponent(expectedDefaultBranch)}`, { allowNotFound: true, ...cancellation },
    )
    const contexts = protection?.status_check_contexts
    return {
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      private: repository.private,
      archived: repository.archived,
      branchProtected: protection !== undefined,
      requiredApprovals: typeof protection?.required_approvals === 'number'
        ? protection.required_approvals
        : 0,
      statusChecks: Array.isArray(contexts)
        ? contexts.filter((value): value is string => typeof value === 'string')
        : [],
      mergeStyle: typeof repository.default_merge_style === 'string'
        ? repository.default_merge_style
        : 'merge',
    }
  }

  async createPullRequest(
    binding: PactFlowGiteaBinding,
    token: string,
    input: { readonly title: string; readonly body: string; readonly head: string; readonly base: string },
  ): Promise<PactFlowGiteaPullRequest> {
    const response = await this.request<PullRequestResponse>(binding, token, '/pulls', {
      method: 'POST', body: input, expectedStatus: 201,
    })
    return this.pullRequest(response)
  }

  async findPullRequest(
    binding: PactFlowGiteaBinding,
    token: string,
    head: string,
    base: string,
    expectedHeadCommit?: string,
  ): Promise<PactFlowGiteaPullRequest | undefined> {
    const responses: PullRequestResponse[] = []
    for (let page = 1; page <= 20; page += 1) {
      const batch = await this.request<PullRequestResponse[]>(
        binding, token, `/pulls?state=all&limit=50&page=${String(page)}`,
      )
      if (!Array.isArray(batch)) throw new Error('PactFlow Gitea pull request response is not an array')
      responses.push(...batch)
      if (batch.length < 50) break
      if (page === 20) throw new Error('PactFlow Gitea pull request list exceeded the maximum page count')
    }
    const unique = new Map<number, PullRequestResponse>()
    for (const candidate of responses) {
      if (typeof candidate.number === 'number' && Number.isSafeInteger(candidate.number)) unique.set(candidate.number, candidate)
    }
    const match = [...unique.values()].find(candidate => candidate.head?.ref === head && candidate.base?.ref === base
      && (expectedHeadCommit === undefined || candidate.head?.sha === expectedHeadCommit))
    return match === undefined ? undefined : this.pullRequest(match)
  }

  async mergePullRequest(
    binding: PactFlowGiteaBinding,
    token: string,
    number: number,
    headCommit: string,
  ): Promise<PactFlowGiteaPullRequest> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await this.request<PullRequestResponse>(
        binding, token, `/pulls/${String(number)}`,
      )
      if (response.head?.sha !== headCommit) {
        throw new Error('PactFlow Gitea PR head changed before merge')
      }
      if (response.merged === true) return this.pullRequest(response)
      if (response.mergeable === true) {
        try {
          await this.request<undefined>(binding, token, `/pulls/${String(number)}/merge`, {
            method: 'POST',
            body: { Do: 'merge', head_commit_id: headCommit, delete_branch_after_merge: true, force_merge: false },
            expectedStatus: 200,
            noContent: true,
          })
          const merged = await this.request<PullRequestResponse>(
            binding, token, `/pulls/${String(number)}`,
          )
          return this.pullRequest(merged)
        } catch (error) {
          if (!(error instanceof GiteaRequestError) || error.status !== 405
            || !/not in mergeable state|not ready to be merged/i.test(error.detail)) throw error
        }
      }
      if (attempt < 39) await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
    }
    throw new Error('PactFlow Gitea PR did not become mergeable')
  }

  private async request<T>(
    binding: PactFlowGiteaBinding,
    token: string,
    suffix: string,
    options: {
      readonly allowNotFound?: boolean
      readonly method?: 'GET' | 'POST'
      readonly body?: unknown
      readonly expectedStatus?: number
      readonly noContent?: boolean
      readonly signal?: AbortSignal
    } = {},
  ): Promise<T> {
    const owner = encodeURIComponent(binding.owner)
    const repo = encodeURIComponent(binding.repo)
    let response: Response
    try {
      response = await fetch(joinUrlPath(binding.baseUrl, `/api/v1/repos/${owner}/${repo}${suffix}`), {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          authorization: binding.username === undefined
            ? `token ${token}`
            : `Basic ${Buffer.from(`${binding.username}:${token}`).toString('base64')}`,
          ...options.body === undefined ? {} : { 'content-type': 'application/json' },
        },
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
        signal: options.signal === undefined ? AbortSignal.timeout(10_000)
          : AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
      })
    } catch {
      options.signal?.throwIfAborted()
      throw new Error('PactFlow could not connect to the configured Gitea API')
    }
    if (options.allowNotFound === true && response.status === 404) return undefined as T
    if (response.status !== (options.expectedStatus ?? 200)) {
      let detail = ''
      try {
        const body = await response.json() as { readonly message?: unknown }
        if (typeof body.message === 'string') detail = body.message.slice(0, 300)
      } catch {}
      throw new GiteaRequestError(response.status, detail)
    }
    if (options.noContent === true) return undefined as T
    try {
      return await response.json() as T
    } catch {
      options.signal?.throwIfAborted()
      throw new Error('PactFlow Gitea API returned invalid JSON')
    }
  }

  private pullRequest(response: PullRequestResponse): PactFlowGiteaPullRequest {
    if (!Number.isSafeInteger(response.number) || typeof response.html_url !== 'string'
      || typeof response.merged !== 'boolean') {
      throw new Error('PactFlow Gitea API returned an invalid pull request')
    }
    return {
      number: response.number as number,
      htmlUrl: response.html_url,
      merged: response.merged,
      ...typeof response.merge_commit_sha === 'string' && response.merge_commit_sha.length > 0
        ? { mergeCommit: response.merge_commit_sha }
        : {},
    }
  }
}

function credentialFreeCloneUrl(value: string, ssh = false): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('PactFlow Gitea clone URL is invalid') }
  if ((!ssh && !['http:', 'https:'].includes(parsed.protocol)) || (ssh && parsed.protocol !== 'ssh:')
    || (!ssh && parsed.username !== '') || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('PactFlow Gitea clone URL must be credential-free')
  }
  return parsed.toString().replace(/\/$/, '')
}
