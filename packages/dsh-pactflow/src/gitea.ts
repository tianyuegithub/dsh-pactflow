/** Minimal Gitea 1.22 API client for repository and branch-protection admission. */

import type { PactFlowGiteaBinding, PactFlowGiteaStatus } from './types.ts'

interface RepositoryResponse {
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

export class PactFlowGiteaClient {
  /** Create one user/org repository after the caller has presented and confirmed its preview. */
  async createRepository(
    baseUrl: string,
    username: string | undefined,
    token: string,
    input: { readonly owner: string; readonly repo: string; readonly private: boolean; readonly defaultBranch: string },
  ): Promise<PactFlowCreatedGiteaRepository> {
    const endpoint = username !== undefined && input.owner === username
      ? `${baseUrl.replace(/\/+$/, '')}/api/v1/user/repos`
      : `${baseUrl.replace(/\/+$/, '')}/api/v1/orgs/${encodeURIComponent(input.owner)}/repos`
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
    if (repository.full_name !== `${input.owner}/${input.repo}` || typeof repository.clone_url !== 'string'
      || typeof repository.default_branch !== 'string' || typeof repository.private !== 'boolean') {
      throw new Error('PactFlow Gitea create repository response is invalid')
    }
    return {
      fullName: repository.full_name, cloneUrl: repository.clone_url,
      defaultBranch: repository.default_branch, private: repository.private,
      ...typeof repository.ssh_url === 'string' ? { sshUrl: repository.ssh_url } : {},
    }
  }

  /** Verify repository identity, default branch, and protection without changing Gitea. */
  async verify(
    binding: PactFlowGiteaBinding,
    token: string,
    expectedDefaultBranch: string,
  ): Promise<PactFlowGiteaStatus> {
    const repository = await this.request<RepositoryResponse>(binding, token, '')
    if (repository.full_name !== `${binding.owner}/${binding.repo}`
      || repository.default_branch !== expectedDefaultBranch
      || typeof repository.private !== 'boolean'
      || typeof repository.archived !== 'boolean') {
      throw new Error('PactFlow Gitea repository identity or default branch does not match the Git binding')
    }
    const protection = await this.request<BranchProtectionResponse | undefined>(
      binding, token, `/branch_protections/${encodeURIComponent(expectedDefaultBranch)}`, { allowNotFound: true },
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
  ): Promise<PactFlowGiteaPullRequest | undefined> {
    const responses = await this.request<PullRequestResponse[]>(binding, token, '/pulls?state=all&limit=50')
    const match = responses.find(candidate => candidate.head?.ref === head && candidate.base?.ref === base)
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
    } = {},
  ): Promise<T> {
    const owner = encodeURIComponent(binding.owner)
    const repo = encodeURIComponent(binding.repo)
    let response: Response
    try {
      response = await fetch(`${binding.baseUrl}/api/v1/repos/${owner}/${repo}${suffix}`, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          authorization: binding.username === undefined
            ? `token ${token}`
            : `Basic ${Buffer.from(`${binding.username}:${token}`).toString('base64')}`,
          ...options.body === undefined ? {} : { 'content-type': 'application/json' },
        },
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
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
