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

import type { PactFlowGiteaCheck, PactFlowGiteaCheckState } from './types.ts'
export type { PactFlowGiteaCheck, PactFlowGiteaCheckState }

export interface PactFlowGiteaPullRequest {
  readonly number: number
  readonly htmlUrl: string
  readonly mergeCommit?: string
  readonly merged: boolean
}


/**
 * Read-only snapshot of a PR's review gate.
 *
 * Everything here is observed, never influenced: the Host reads approvals and
 * check results and it never submits a review, never edits branch protection and
 * never force-merges. A check the repository requires but that has not reported
 * at all is `pending`, not absent — silence is not success.
 */
export interface PactFlowGiteaGateState {
  readonly number: number
  readonly headCommit: string
  readonly baseBranch: string
  readonly merged: boolean
  readonly mergeCommit?: string
  readonly approvals: number
  readonly checks: readonly PactFlowGiteaCheck[]
}

interface ReviewResponse {
  readonly state?: unknown
  readonly stale?: unknown
  readonly dismissed?: unknown
  readonly user?: { readonly id?: unknown; readonly login?: unknown }
}

interface CommitStatusResponse {
  readonly context?: unknown
  readonly status?: unknown
  readonly created_at?: unknown
}

const CHECK_STATE: Readonly<Record<string, PactFlowGiteaCheckState>> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failure: 'failure',
  error: 'failure',
  warning: 'failure',
}

class GiteaRequestError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`PactFlow Gitea API returned HTTP ${String(status)}${detail.length === 0 ? '' : `: ${detail}`}`)
  }
}

/**
 * Authenticated Gitea API requests never follow redirects: a cross-origin
 * redirect must not receive the Authorization header we attached to the request.
 * Refusing the redirect keeps the credential bound to its registered endpoint.
 */
async function giteaFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    throw new GiteaRequestError(response.status, 'redirect refused')
  }
  return response
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
      response = await giteaFetch(endpoint, {
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
        response = await giteaFetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...auth } })
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
      response = await giteaFetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...auth } })
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
    signal?: AbortSignal,
  ): Promise<PactFlowGiteaPullRequest> {
    const response = await this.request<PullRequestResponse>(binding, token, '/pulls', {
      method: 'POST', body: input, expectedStatus: 201, ...(signal === undefined ? {} : { signal }),
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

  /**
   * Read how far one PR is from satisfying the branch protection gate.
   *
   * Approvals count one per reviewer, taking only that reviewer's latest review
   * and ignoring stale or dismissed ones — otherwise a reviewer who approved and
   * then requested changes would still count toward the requirement.
   *
   * `requiredChecks` comes from branch protection. A required context with no
   * reported status is returned as `pending`: a check that never ran must never
   * read as a check that passed.
   */
  async pullRequestGateState(
    binding: PactFlowGiteaBinding,
    token: string,
    number: number,
    requiredChecks: readonly string[],
    signal?: AbortSignal,
  ): Promise<PactFlowGiteaGateState> {
    const cancellation = signal === undefined ? {} : { signal }
    const pull = await this.request<PullRequestResponse>(binding, token, `/pulls/${String(number)}`, cancellation)
    const head = pull.head?.sha
    const base = pull.base?.ref
    if (typeof head !== 'string' || head.length === 0 || typeof base !== 'string' || base.length === 0) {
      throw new Error('PactFlow Gitea pull request is missing its head or base identity')
    }

    const reviews = await this.request<readonly ReviewResponse[]>(
      binding, token, `/pulls/${String(number)}/reviews?limit=100`, cancellation,
    )
    if (!Array.isArray(reviews)) throw new Error('PactFlow Gitea review response is not an array')
    const latestByReviewer = new Map<string, string>()
    for (const review of reviews) {
      if (review.stale === true || review.dismissed === true) continue
      const reviewer = typeof review.user?.id === 'number' ? String(review.user.id)
        : typeof review.user?.login === 'string' ? review.user.login : undefined
      const state = typeof review.state === 'string' ? review.state.toUpperCase() : undefined
      if (reviewer === undefined || state === undefined) continue
      // Comment-only reviews neither approve nor block; they must not displace a
      // reviewer's standing decision.
      if (state === 'COMMENT' || state === 'PENDING') continue
      latestByReviewer.set(reviewer, state)
    }
    const approvals = [...latestByReviewer.values()].filter(state => state === 'APPROVED').length

    const checks: PactFlowGiteaCheck[] = []
    if (requiredChecks.length > 0) {
      const statuses = await this.request<readonly CommitStatusResponse[]>(
        binding, token, `/statuses/${encodeURIComponent(head)}?limit=100`, { allowNotFound: true, ...cancellation },
      ) ?? []
      const latest = new Map<string, PactFlowGiteaCheckState>()
      for (const status of Array.isArray(statuses) ? statuses : []) {
        if (typeof status.context !== 'string') continue
        // Gitea returns newest first; keep the first seen per context.
        if (latest.has(status.context)) continue
        const raw = typeof status.status === 'string' ? status.status.toLowerCase() : ''
        latest.set(status.context, CHECK_STATE[raw] ?? 'unknown')
      }
      for (const context of requiredChecks) {
        checks.push({ context, state: latest.get(context) ?? 'pending' })
      }
    }

    const merged = pull.merged === true
    return {
      number,
      headCommit: head,
      baseBranch: base,
      merged,
      approvals,
      checks,
      ...typeof pull.merge_commit_sha === 'string' && pull.merge_commit_sha.length > 0
        ? { mergeCommit: pull.merge_commit_sha }
        : {},
    }
  }

  async mergePullRequest(
    binding: PactFlowGiteaBinding,
    token: string,
    number: number,
    headCommit: string,
    signal?: AbortSignal,
    beforeMerge?: () => Promise<void>,
    /** True when the default branch requires approvals or status checks. */
    reviewGated?: boolean,
  ): Promise<PactFlowGiteaPullRequest> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      signal?.throwIfAborted()
      const response = await this.request<PullRequestResponse>(
        binding, token, `/pulls/${String(number)}`, signal === undefined ? {} : { signal },
      )
      if (response.head?.sha !== headCommit) {
        throw new Error('PactFlow Gitea PR head changed before merge')
      }
      if (response.merged === true) return this.pullRequest(response)
      if (response.mergeable === true) {
        try {
          await beforeMerge?.()
          signal?.throwIfAborted()
          await this.request<undefined>(binding, token, `/pulls/${String(number)}/merge`, {
            method: 'POST',
            body: { Do: 'merge', head_commit_id: headCommit, delete_branch_after_merge: true, force_merge: false },
            expectedStatus: 200,
            noContent: true,
            ...(signal === undefined ? {} : { signal }),
          })
          const merged = await this.request<PullRequestResponse>(
            binding, token, `/pulls/${String(number)}`,
          )
          return this.pullRequest(merged)
        } catch (error) {
          if (!(error instanceof GiteaRequestError) || error.status !== 405
            || !/not in mergeable state|not ready to be merged/i.test(error.detail)) throw error
          // On a protected branch this rejection means the review gate is not
          // satisfied — an outcome no amount of retrying changes. Spinning here
          // would turn a bounded race-window retry into a loop that keeps
          // knocking on branch protection, so fail closed and let the caller's
          // review-gate wait state handle it.
          if (reviewGated === true) {
            throw new Error(
              'PactFlow Gitea refused the merge while branch protection is unsatisfied; the review gate decides when to merge',
            )
          }
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
      response = await giteaFetch(joinUrlPath(binding.baseUrl, `/api/v1/repos/${owner}/${repo}${suffix}`), {
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
    } catch (error) {
      options.signal?.throwIfAborted()
      // A refused redirect is a deliberate safety decision, not a connectivity failure.
      if (error instanceof GiteaRequestError) throw error
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
