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
      binding, token, `/branch_protections/${encodeURIComponent(expectedDefaultBranch)}`, true,
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

  private async request<T>(
    binding: PactFlowGiteaBinding,
    token: string,
    suffix: string,
    allowNotFound = false,
  ): Promise<T> {
    const owner = encodeURIComponent(binding.owner)
    const repo = encodeURIComponent(binding.repo)
    let response: Response
    try {
      response = await fetch(`${binding.baseUrl}/api/v1/repos/${owner}/${repo}${suffix}`, {
        headers: { accept: 'application/json', authorization: `token ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('PactFlow could not connect to the configured Gitea API')
    }
    if (allowNotFound && response.status === 404) return undefined as T
    if (!response.ok) throw new Error(`PactFlow Gitea API returned HTTP ${String(response.status)}`)
    try {
      return await response.json() as T
    } catch {
      throw new Error('PactFlow Gitea API returned invalid JSON')
    }
  }
}
