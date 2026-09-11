## 1. 缺陷修复（A03-d 前置）

- [x] 1.1 `src/domain.ts` 的 `gitResultSchema` 增加 `validationSensitiveChanges: z.array(z.string().min(1)).optional()`；以新增投影存活测试先红（现状 `undefined`）后绿验证

## 2. A03-d 评审可见面

- [x] 2.1 `src/agent/index.ts` `pactflow_record_review` 审批理由恒含「验证敏感文件改动：清单/无」（Need 全部运行去重并集、排序、截断 6 条 + 等N项）；以 review 单测两项（有清单含路径 / 无清单显式「无」）验证
- [x] 2.2 `pnpm run build` 刷新 preset 产物并确认产物含新理由行

## 3. 客户端只读入口

- [x] 3.1 `client/index.tsx` 注入 `exportHandover`（一次性调 `pactflow/projectHandover`）；`loadRuntime` 增 `pactflow/retentionStatus`；以类型检查通过验证
- [x] 3.2 `overlay.tsx` 新增「保留现场」只读区（总数/体积/度量/超预算/逾期）与「导出移交摘要」入口（只读 JSON + 复制）；`locale.ts` 增中英键；以单测可导入 + e2e 验证
- [x] 3.3 e2e：seed 含保留清理责任的会话 → 浮层呈现保留现场区；点导出 → 呈现含 `packageVersion` 与 `validationsExecuted` 的摘要并可复制（剪贴板断言）

## 4. 收口

- [x] 4.1 `pnpm run check` 全绿 + `test:web` 通过（含既有 overlay 用例不回归）
- [x] 4.2 `openspec validate --strict` + `--all --strict` 通过，archive 归并
