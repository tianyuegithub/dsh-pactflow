# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 闸门失败测试 | ✅ | `tests/client-request-ordering.spec.ts` 先因模块不存在失败 |
| 1.2 实现 `request-gate.ts` | ✅ | 纯模块 `createRequestGate`（`next`/`isLatest`/`invalidate`）；5 项语义测试 |
| 2.1/2.2 overlay 运行时刷新接入 | ✅ | 签发新刷新前 `invalidate()` 使旧请求失效，应用前双重判定 `isCurrent && isLatest(token)`；会话/代际切换副作用中 `invalidate()` |
| 3.1 project-panel `refresh()` 接入 | ✅ | 工作区切换使旧令牌失效，响应经 `isLatest` 守卫后才 `setRows/setCatalog` |
| 3.2 project-panel `gitSecrets` 接入 | ✅ | 集群切换使旧令牌失效，响应经守卫后才 `setGitSecrets` |
| 4.x 收口 | ✅ | `pnpm run check` 43 文件 / 434 测试 / 13 包产物；`typecheck` 通过；`git diff --check` 通过 |

## 过程中发现并处理

- 新增 client 源文件后 build 报 `TS6307`：`src/client/request-gate.ts` 必须登记进 `tsconfig.client.json` 的 `files`（与 host 侧同一类坑；已记入记忆）。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 旧响应晚于新响应到达时被丢弃 | `discards an older response that arrives after a newer one` |
| 最新响应正常应用 | `applies the only issued request` / `keeps an outstanding token authoritative…` |
| 并发多请求只有最后一次生效 | `keeps only the last of several concurrent requests authoritative` |
| 新请求签发后旧请求即使成功也被忽略 | 同上（`isLatest(first) === false`） |
| 上下文切换使全部在途请求失效 | `invalidates every outstanding token on a context change` |
| 接线未被移除（回归守卫） | `routes the overlay runtime refresh and the panel refresh/secret loads through the gate` |

## 已知边界

- 纯闸门语义已充分单测；**组件接线**由源码级守卫测试防回归。真正的「反序响应」端到端证明需要浏览器脚手架注入可控慢响应，本 change 未做（属真实浏览器验收）。
- 配置变更**自身版本驱动刷新 + stale 标记**（附录 R11）不在本 change 范围，作为后续 change：本 change 只保证「同一刷新触发源内的乱序安全」，未改变刷新触发依据。

## 验证

`pnpm run check` 通过：43 个测试文件、434 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
