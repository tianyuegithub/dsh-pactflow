/** Minimal Gitea 1.22 API client for repository and branch-protection admission. */

import type { PactFlowGiteaBinding, PactFlowGiteaStatus } from './types.ts'

interface RepositoryResponse {
  readonly full_name?: unknown
  readonly default_branch?: unknown
  readonly private?: unknown
  readonly archived?: unknown
  readonly default_merge_style?: unknown
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
}

export interface PactFlowGiteaPullRequest {
  readonly number: number
  readonly htmlUrl: string
  readonly mergeCommit?: string
  readonly merged: boolean
}

export class PactFlowGiteaClient {
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

  async mergePullRequest(
    binding: PactFlowGiteaBinding,
    token: string,
    number: number,
    headCommit: string,
  ): Promise<PactFlowGiteaPullRequest> {
    await this.request<undefined>(binding, token, `/pulls/${String(number)}/merge`, {
      method: 'POST',
      body: { Do: 'merge', head_commit_id: headCommit, delete_branch_after_merge: true, force_merge: false },
      expectedStatus: 200,
      noContent: true,
    })
    const response = await this.request<PullRequestResponse>(binding, token, `/pulls/${String(number)}`)
    return this.pullRequest(response)
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
          accept: 'application/json', authorization: `token ${token}`,
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
      throw new Error(`PactFlow Gitea API returned HTTP ${String(response.status)}`)
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
