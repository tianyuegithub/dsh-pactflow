import type { PactFlowHarnessProfileSettings, PactFlowHarnessTemplateView } from '../types.ts'

export function isHarnessProfile(
  template: PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings,
): template is PactFlowHarnessProfileSettings {
  return 'registryId' in template
}

export function friendlyOption(value: string): string {
  return ({
    claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', dsh: 'DeepSeek Harness',
    'anthropic-messages': 'Anthropic Messages',
    'openai-responses': 'OpenAI Responses',
    'openai-chat-completions': 'OpenAI Chat Completions',
    true: '开启', false: '关闭',
  } as Readonly<Record<string, string>>)[value] ?? value
}
