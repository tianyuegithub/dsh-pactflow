## Why

GPT 评审 R12（对应 FULL:J9）指出：宿主虽已拆成模块，但仍把**整个 Cordis Context**（乃至更大的宿主对象）传给每个模块，因此「拆文件」并不等于「职责与依赖解耦」——模块仍能触达任意上下文能力，测试也不得不构造整个宿主。

本 change 取其中**可安全验证的切片**：把已经只用到少数能力的两个模块（清理账本、探针对账）从「整个 `ctx`」改为**窄端口**，并用「不含 `ctx` 的宿主替身」证明模块不再依赖整个上下文。

## What Changes

- `CleanupHost`：移除 `ctx: Context`，改为窄端口 `logger`（日志）与 `delivery(session)`（读取交付投影）。
- `ProbeRecoveryHost`：移除 `ctx: Context`，改为窄端口 `logger`。
- `src/host/cleanup.ts` 与 `src/host/probe-recovery.ts` 内的 `host.ctx.*` 调用改为窄端口调用。
- `index.ts` 的两个宿主工厂提供窄端口实现。

## Capabilities

### New Capabilities
- `host-narrow-ports`: 宿主模块必须通过窄端口获取其真正需要的能力，而不是接收整个上下文；模块可在不含上下文对象的宿主替身上被驱动与测试。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/host/cleanup.ts`（接口与调用点）、`src/host/probe-recovery.ts`（接口与调用点）、`src/index.ts`（两个宿主工厂）。
- **测试**：新增 `tests/host-narrow-ports.spec.ts`（用**无 `ctx`** 的宿主替身驱动清理对账，含保留跳过）；更新 `tests/cleanup-retention-guard.spec.ts` 的替身到窄端口。
- **兼容**：纯内部接口收窄，行为不变；`pnpm run check` 全绿。
