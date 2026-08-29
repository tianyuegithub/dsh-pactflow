import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

const enabled = process.env.DSH_K3S_E2E === '1'
const registry = '192.168.31.200:8080/datavdl/pactflow-worker'
const openAi = {
  model: 'deepseek-v4-flash-vision-exp',
  baseUrl: 'https://api.deepseek.com',
  modelSecretName: 'pactflow-legacy-codex-deepseek-v4flash',
}
const resources = {
  cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '2', memoryLimit: '2Gi',
}

describe.skipIf(!enabled)('PactFlow real Harness probes', { timeout: 900_000 }, () => {
  let ctx: Context

  beforeAll(async () => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      k3s: {
        namespace: 'pactflow', imagePullSecret: 'pactflow-registry-home-harbor', pollIntervalMs: 1_000,
        templates: [
          {
            id: 'claude', harness: 'claude', apiMode: 'anthropic-messages',
            image: `${registry}@sha256:e7569c3ccdc78fed9fab25e4c9f9ee708bee5114f62bf856e0010f474e5cf87a`,
            model: 'glm-5-2-260617', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
            modelSecretName: 'pactflow-legacy-data-gov-claudecode-glm52', ...resources,
          },
          {
            id: 'codex', harness: 'codex', apiMode: 'openai-responses',
            image: `${registry}@sha256:a7d75d0191e82c243f77429cdd652a61636dd185058f1f8c7babc72bf80288c4`,
            ...openAi, ...resources,
          },
          {
            id: 'opencode', harness: 'opencode', apiMode: 'openai-chat-completions',
            image: `${registry}@sha256:6ac439dc3f8c29165572f4f99da0ecffdfd35b14c46ff51594cfffafeae63707`,
            ...openAi, ...resources,
          },
          {
            id: 'dsh', harness: 'dsh', apiMode: 'openai-chat-completions',
            image: `${registry}@sha256:3342bb490d91ff8e39255e4b0e477967f4ccd9c7fb4380a1ec13cc654debdcea`,
            ...openAi, ...resources,
          },
        ],
      },
    })
  })

  afterAll(async () => { await ctx?.fiber.dispose() })

  it('returns real model output and cleans each short-lived Job', async () => {
    const results = await Promise.all(['claude', 'codex', 'opencode', 'dsh'].map(templateId =>
      ctx.pactflow.probeHarness({ templateId, prompt: 'say hi to me', timeoutMs: 180_000 })))
    for (const result of results) {
      expect(result.success).toBe(true)
      expect(result.output.toLowerCase()).toContain('hi')
      expect(result.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'create-job', state: 'succeeded' }),
        expect.objectContaining({ name: 'model-response', state: 'succeeded' }),
        expect.objectContaining({ name: 'cleanup', state: 'succeeded' }),
      ]))
    }
  })
})
