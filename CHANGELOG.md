# Changelog

## 0.3.0-dev.1 — 未发布

- 固定 OpenCode 1.19.5 的源码与官方二进制，修正项目插件自动发现入口为 `.js`。
- 增加逐调用观测、跳过/回退/异常原因、原生失败事件、基线 observe 模式和有审计的 SHA 回查。
- 增加隔离运行时验收、五类合成配对任务、外部验收、请求级用量去重与完整性检查。
- 保留全部未触发任务；本地协议响应、用量和修复决策均明确标注 synthetic。
- 增加真实 DeepSeek 请求采集、SSE 用量一致性检查、人民币/美元原币种预算预留和离线证据复核。
- 完成五对真实模型先导，任务仍为受控合成故障/对照；原始 API 用量与费用估算分开记录。
- 核心格式契约未扩展；真实项目效果、独立实付账单、远端 CI 和本版本发布未验证或执行。

## 0.2.0 — 2026-10-30

- Support nested Node TAP suites and subtests with recursive identities, plans, parent statuses and test/suite totals.
- Preserve complete root branches containing failures, skips or todos; remove only fully validated ordinary passing branches.
- Bound nested parsing to 32 child levels and reject duplicate timing/type fields.
- Add seven real captured Node outputs, 896 independent deletion cases, depth/tampering tests and public registry-consumer regressions.


## 0.1.2 — 2026-10-30

- Pin MoonBit 0.10.18 and enforce the contest minimum of 0.10.16.
- Publish as `cjyhjy/contextguard` with a root `guard_request` API and standalone example. This replaces the unpublished development import `contextguard/guard/src`; Node API calls are unchanged.
- Add six public API tests on all three supported backends. Test the actual source archive in an independent consumer.
- Restrict the Mooncakes archive to source, tests, example and license. Keep CLI/demo/evaluation in GitHub and the portable ZIP.
- Consolidate reproducible setup and contest acceptance evidence.

## 0.1.1

Strict rg byte ranges and duplicate JSON key validation, process/transport errors, short-output protection, demo request snapshots and immutable delivery packaging. See `docs/OPTIMIZATION.md`.
