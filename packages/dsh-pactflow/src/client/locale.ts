export const NS = 'pactflow'

export type PactFlowLocaleKey =
  | 'open'
  | 'title'
  | 'subtitle'
  | 'close'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'project'
  | 'needs'
  | 'dag'
  | 'runs'
  | 'gitRemote'
  | 'gitBaseline'
  | 'gitBranch'
  | 'gitCommit'
  | 'attempt'
  | 'validations'
  | 'k3sTemplates'
  | 'workerPools'
  | 'apiMode'
  | 'harnessTest'
  | 'apiTest'
  | 'testing'
  | 'settingsTitle'
  | 'settingsDescription'
  | 'settingsRestart'
  | 'settingsSave'
  | 'settingsDisable'
  | 'settingsInvalid'
  | 'settingsSaved'
  | 'verifyGitea'
  | 'giteaProtected'
  | 'giteaUnprotected'
  | 'empty'

export const zh: Record<PactFlowLocaleKey, string> = {
  open: '打开零脉',
  title: '零脉 · PactFlow',
  subtitle: 'DSH 原生项目工作流模式',
  close: '关闭',
  loading: '正在验证 Host 与 Typert Remote…',
  ready: '外部 Bundle、Preset Root 与事件生产者已就绪',
  failed: '连接验证失败',
  project: '项目',
  needs: '需求与阶段',
  dag: 'DAG 节点',
  runs: 'Worker 运行',
  gitRemote: 'Git 远端',
  gitBaseline: '基线分支',
  gitBranch: '任务分支',
  gitCommit: '提交',
  attempt: '尝试',
  validations: '验证命令',
  k3sTemplates: 'K3s Harness 模板',
  workerPools: 'Worker Pool 容量',
  apiMode: 'API 模式',
  harnessTest: 'Harness 镜像测试',
  apiTest: 'API 测试',
  testing: '测试中…',
  settingsTitle: '零脉基础设施',
  settingsDescription: '按顺序配置 K3s、Harbor、Gitea、Harness、模型连接和执行资源池。密码与 API Key 由 DSH Credentials 安全保存。',
  settingsRestart: '保存后重启 Profile 生效。',
  settingsSave: '保存配置',
  settingsDisable: '禁用基础设施',
  settingsInvalid: 'JSON 配置无效',
  settingsSaved: '已保存，等待重启',
  verifyGitea: '验证 Gitea',
  giteaProtected: '默认分支已保护',
  giteaUnprotected: '默认分支未保护',
  empty: '暂无数据',
}

export const en: Record<PactFlowLocaleKey, string> = {
  open: 'Open PactFlow',
  title: 'PactFlow',
  subtitle: 'Native project workflow mode for DSH',
  close: 'Close',
  loading: 'Checking Host and Typert Remote…',
  ready: 'External Bundle, preset root, and event producer are ready',
  failed: 'Connection check failed',
  project: 'Project',
  needs: 'Needs and phases',
  dag: 'DAG nodes',
  runs: 'Worker runs',
  gitRemote: 'Git remote',
  gitBaseline: 'Baseline branch',
  gitBranch: 'Task branch',
  gitCommit: 'Commit',
  attempt: 'Attempt',
  validations: 'Validation commands',
  k3sTemplates: 'K3s Harness templates',
  workerPools: 'Worker Pool capacity',
  apiMode: 'API mode',
  harnessTest: 'Harness image test',
  apiTest: 'API test',
  testing: 'Testing…',
  settingsTitle: 'PactFlow infrastructure',
  settingsDescription: 'Configure K3s, Harbor, Gitea, Harnesses, model connections, and execution pools in order. Passwords and API keys are stored by DSH Credentials.',
  settingsRestart: 'Restart the Profile after saving.',
  settingsSave: 'Save configuration',
  settingsDisable: 'Disable infrastructure',
  settingsInvalid: 'Invalid JSON configuration',
  settingsSaved: 'Saved; restart required',
  verifyGitea: 'Verify Gitea',
  giteaProtected: 'Default branch protected',
  giteaUnprotected: 'Default branch unprotected',
  empty: 'No data',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    pactflow: PactFlowLocaleKey
  }
}
