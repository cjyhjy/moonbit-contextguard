# ContextGuard 离线独立评测

生成时间：2026-10-30T09:34:08.413Z。来源为合成程序/文本的真实进程输出，未运行付费模型或在线任务。

原始 stdout 是独立证据清单来源；评测器不读取 ContextGuard 返回的 evidence 或 metrics。所有原文证据片段必须原样连续保留，另查全输出是否为原文有序行子序列。primary 组 head-tail 预算为 900 个 UTF-16 单位且整行截取，core 主比较预算为 16000。同行使用实际 HarnessPro TB2 Lite 固定版本的公开默认预算，预算不同，不能仅按压缩比例排名。同表另列 same-budget-4000 组：头尾与 ContextGuard 均设 4000，同行保持实际公开 4000 阈值（头2400+尾900）；原文与无预算控制的 RTK 仅作参考。超出必需证据预算时 core 回退，因此不会保证 4000 硬输出上限。

| 夹具 | 方法 | 必需证据项 | UTF-16 单位 | 减少率 | 决策 |
|---|---|---:|---:|---:|---|
| node-tap-all-pass | original | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | head-tail-900 | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | harnesspro-tb2-lite | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | contextguard | 10/10 | 338 → 118 | 65.09% | compressed |
| node-tap-all-pass | original-4000-reference | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | head-tail-4000 | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | harnesspro-tb2-lite-4000-reference | 10/10 | 338 → 338 | 0.00% | — |
| node-tap-all-pass | contextguard-4000 | 10/10 | 338 → 118 | 65.09% | compressed |
| node-tap-zero-tests | original | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | head-tail-900 | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | harnesspro-tb2-lite | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | contextguard | 10/10 | 117 → 117 | 0.00% | compressed |
| node-tap-zero-tests | original-4000-reference | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | head-tail-4000 | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | harnesspro-tb2-lite-4000-reference | 10/10 | 117 → 117 | 0.00% | — |
| node-tap-zero-tests | contextguard-4000 | 10/10 | 117 → 117 | 0.00% | compressed |
| node-tap-middle-failure | original | 17/17 | 10335 → 10335 | 0.00% | — |
| node-tap-middle-failure | head-tail-900 | 10/17 | 10335 → 891 | 91.38% | — |
| node-tap-middle-failure | harnesspro-tb2-lite | 10/17 | 10335 → 3582 | 65.34% | — |
| node-tap-middle-failure | contextguard | 17/17 | 10335 → 1725 | 83.31% | compressed |
| node-tap-middle-failure | original-4000-reference | 17/17 | 10335 → 10335 | 0.00% | — |
| node-tap-middle-failure | head-tail-4000 | 10/17 | 10335 → 3970 | 61.59% | — |
| node-tap-middle-failure | harnesspro-tb2-lite-4000-reference | 10/17 | 10335 → 3582 | 65.34% | — |
| node-tap-middle-failure | contextguard-4000 | 17/17 | 10335 → 1725 | 83.31% | compressed |
| rg-json-multiple-unicode-long | original | 14/14 | 6740 → 6740 | 0.00% | — |
| rg-json-multiple-unicode-long | head-tail-900 | 2/14 | 6740 → 510 | 92.43% | — |
| rg-json-multiple-unicode-long | harnesspro-tb2-lite | 7/14 | 6740 → 3581 | 46.87% | — |
| rg-json-multiple-unicode-long | contextguard | 14/14 | 6740 → 5698 | 15.46% | compressed |
| rg-json-multiple-unicode-long | original-4000-reference | 14/14 | 6740 → 6740 | 0.00% | — |
| rg-json-multiple-unicode-long | head-tail-4000 | 11/14 | 6740 → 3217 | 52.27% | — |
| rg-json-multiple-unicode-long | harnesspro-tb2-lite-4000-reference | 7/14 | 6740 → 3581 | 46.87% | — |
| rg-json-multiple-unicode-long | contextguard-4000 | 14/14 | 6740 → 6740 | 0.00% | fallback |
| rg-json-no-results | original | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | head-tail-900 | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | harnesspro-tb2-lite | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | contextguard | 1/1 | 263 → 263 | 0.00% | compressed |
| rg-json-no-results | original-4000-reference | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | head-tail-4000 | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | harnesspro-tb2-lite-4000-reference | 1/1 | 263 → 263 | 0.00% | — |
| rg-json-no-results | contextguard-4000 | 1/1 | 263 → 263 | 0.00% | compressed |
| rg-json-invalid-path | original | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | head-tail-900 | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | harnesspro-tb2-lite | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | contextguard | 1/1 | 255 → 255 | 0.00% | fallback |
| rg-json-invalid-path | original-4000-reference | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | head-tail-4000 | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | harnesspro-tb2-lite-4000-reference | 1/1 | 255 → 255 | 0.00% | — |
| rg-json-invalid-path | contextguard-4000 | 1/1 | 255 → 255 | 0.00% | fallback |

对抗案例：26/26；格式失效/未知格式回退：2/2。核心原始比较回退 1/6。完整逐案输入、输出、原因、耗时和独立检查在 evaluation.json 与 evaluation/ 目录。

字符计数分别报告 Unicode codepoints、UTF-16 单位和 UTF-8 字节。时间以毫秒单独报告；core 有 5 次预热和 31 次测量，同行含 Python 启动及 hook 子进程，不能据此比较绝对性能。

**未测：**模型 token、真实费用、净省钱、在线任务成功率。合成账本只验证记账逻辑。stderr 被独立保存与校验，stdout API 比较不声称保留 stderr。动态时间、临时工作目录会在重新采集后变化，原文哈希与标注将一同更新。
