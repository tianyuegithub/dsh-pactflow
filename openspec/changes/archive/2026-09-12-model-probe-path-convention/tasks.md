# Tasks: model-probe-path-convention

- [ ] 1.1 `probeModelConnection` anthropic suffix 自动补 `v1/`（不以 /v1 结尾时），不重复。验证：build + 单测
- [ ] 1.2 `model-probe-path.spec.ts` 3 场景先红后绿；`pnpm run check` 全绿。验证：check
- [ ] 1.3 `openspec validate --all --strict` + archive + 打包重装重启实机验证（Ark 探针转绿）。
