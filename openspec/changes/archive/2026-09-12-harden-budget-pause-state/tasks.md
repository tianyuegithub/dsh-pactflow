## 1. 领域与状态机

- [x] 1.1 types.ts `PactFlowNodeState` 增 `paused`；domain `nodeSchema` 枚举同步。验证：build
- [x] 1.2 `retryNode` 预算耗尽 → 追加 node-updated（state=paused）并返回节点；后续 retry/claim 对 paused 指名拒绝「等待人工恢复」。验证：单测
- [x] 1.3 新增 `resumeNode` Remote（paused→ready/pending，非 paused 拒绝，留痕）。验证：单测

## 2. 呈现

- [x] 2.1 `STATE_COPY` 补 paused（已暂停·等待人工恢复）；浮层新增「已暂停节点」区 + 恢复按钮（经新注入函数调 `resumeNode`）。验证：单测 + build
- [x] 2.2 项目面板不新增暂停编辑（暂停无配置面）。验证：review

## 3. 收口

- [x] 3.1 单测全链（耗尽→paused→指名拒绝→resume→ready/pending）+ 既有 run-budgets/准入测试全绿
- [x] 3.2 `pnpm run check` 全绿 + `openspec validate --all --strict` + archive
