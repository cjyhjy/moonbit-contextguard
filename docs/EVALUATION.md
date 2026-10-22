# 评测、真实夹具与成本账本

本目录的完成证据是本地离线重放。测试程序和搜索文本是明确标注的合成输入；stdout、stderr、退出码来自实际 `node` / `rg` 子进程。未调用模型，没有在线任务成功率、真实 token 或费用结论。

## 可复现命令

从项目根目录运行，先保留已有报告；重新采集会改变动态耗时、临时目录路径、原文哈希及后续报告。

```sh
node evaluation/capture-fixtures.mjs
node evaluation/evaluate.mjs
node evaluation/audit.mjs
node --test evaluation/ledger.test.mjs
node evaluation/ledger.mjs evaluation/example-ledger.synthetic.jsonl --output reports/evaluation-ledger.synthetic.json
```

采集依赖 `node` 与 `rg`。本次实际版本和精确 argv、cwd、退出码见 `fixtures/manifest.json`。脚本把合成源文件复制到 `/tmp/contextguard-fixture-capture-*`，在该目录真实执行，随后删除临时副本；避免输出包含用户主目录。保存的原文未经改写。`--append-missing` 只补新清单项，保留已有捕获。Node 的空测试文件会产生一个文件级测试，因此零测试夹具通过空目录中的 `node --test --test-reporter=tap` 捕获，确实输出 `1..0` 和 `# tests 0`。

夹具包括全通过、零测试、中间失败（前后各 36 个通过，另有 skip/todo）、多文件 Unicode 与长中段 rg 命中、无结果、无效路径。每份单独保存 stdout 和 stderr。清单中的进程元数据为 `{exit_code: integer, scope: string[], truncated: boolean}`；scope 描述执行范围，不以候选输出推断。

## 独立证据与比较

`evaluation/capture-fixtures.mjs` 中的外部标注器从原始 stdout 生成必要行区间，依据公开的本项目支持范围写规则，并已人工查看原始失败断言、skip/todo、零测试计划、rg 事件和无效路径。它不导入核心、不使用核心 evidence 或 metrics 作为真值。`evaluation/evaluate.mjs` 再验证原文哈希与清单行区间；每个证据片段必须在候选中完整连续出现，并独立检查全输出是不是原文的有序行子序列。失败整块和部分字段标签存在重叠，证据项数不等于相互独立的语义事实数。该度量是指定格式字段/证据保留，不是任意语义无损证明。另有固定种子的 768 个候选行删除样本，逐个检查必要原文片段与行来源。

原文、整行头尾截断、固定版本 HarnessPro TB2 Lite 的实际 hook、可得平台上的 RTK OSS 1.0.1 `pipe`、MoonBit ContextGuard 运行同一批 stdout。同行的完整系统、模型策略或其他专用过滤器没有在此被评价。HarnessPro 的原文回查是否成功保留在同行元数据里；回查可用性不等于压缩输出已经包含证据。

报告含两个预算组：

- `primary`：整行 head-tail 900、ContextGuard 16000，同行保留公开默认设置，用来观察行为边界，不按压缩比例排名。
- `same-budget-4000`：head-tail 与 ContextGuard 都用 4000；HarnessPro 保持实际公开的 4000 阈值与 2400 头部 + 900 尾部配置。原文与无相应预算旋钮的 RTK 只是参考。同行同一输出复用并标记 `same_output_as_primary`，没有把复用记录称为另一次运行。核心必要证据超预算时回退原文，输出可能大于预算。

Core 返回的是必要证据投影，不保证是可重新执行或完整可解析的 TAP/rg 原始流。保存进程元数据并不能弥补未提供的 stderr，因此本 stdout 评测只单独保存/校验 stderr，不声称压缩输出保留 stderr。

对抗候选存放在 `fixtures/candidates/`，包括整个失败块删除、actual 值篡改、成功状态篡改、顺序交换、长中段命中删除、路径替换、JSON 截断、summary 计数篡改、极小预算与 `truncated:true`。另有未知格式和损坏原文的合成健壮性输入，它们不冒充真实进程输出。

`reports/evaluation.json` 保存全部结果；`reports/evaluation.md` 是阅读版。计数分别记录 Unicode codepoints、UTF-16 units 和 UTF-8 bytes，均不是模型 token。耗时单独测量：核心 5 次预热 + 31 次同步调用；同行包含 Python 启动及 hook/RTK 子进程，不据此进行速度排名。RTK 自带平台与校验和检查，不支持的系统明确记为 `unrun`。

## 成对账本

`evaluation/ledger.mjs` 是无需 API、无网络的 JSONL 校验器和记账器。示例文件名和每行 `evidence_kind: "synthetic"` 都明确说明数值是教学样例。样例特意展示辅助调用/重试/摊销可能抵消主调用的减少，结果不能当作在线节省。

每行 `schema_version: 1`，有两种记录：

1. `record_type: "run"`：`pair_id`、唯一 `run_id`、`task_id`、`input_sha256`、`model`、`settings`、`condition: "original"|"guard"`、`status: "completed"|"failed"`、`task_success: boolean|null`、`duration_ms`、`charges`、`offline_optimization_ids`。
2. `record_type: "offline_cost"`：唯一 `optimization_id`、正整数 `amortization_runs`、费用与用量字段。一次优化只录一条费用记录；运行按 ID 引用分摊，不能超额分摊，不把同一笔费用重复当成实际支出。

两种记录均有 `evidence_kind: "synthetic"|"measured_online"|"offline_replay"`。每个 pair 恰好两次运行且任务、输入哈希、模型、设置和证据类型一致；任一不匹配即拒绝。设置中应记录模型参数、随机种子、工具版本和任务条件，由采集者保证准确。工具只校验提供的数据，无法独立验证是否实际执行过或账单是否真实。

`charges` 至少一项 `primary`，其他类别为 `summary`、`retrieval`、`retry`。每项费用包含：

| 字段 | 含义 |
|---|---|
| `cost_usd` | 该项费用；不会从字符数推算 |
| `cost_source` | `synthetic`、`provider_billed` 或 `rate_card_estimate` |
| `input_uncached_tokens` | 记录的未缓存输入 token，非负整数 |
| `input_cached_tokens` | 记录的缓存输入 token，与上一项互斥 |
| `output_tokens` | 记录的输出 token，非负整数 |

离线优化记录采用同样费用/用量字段，另有 `amortization_runs`。合成记录必须使用 synthetic 费用；offline_replay 必须用 rate_card_estimate；measured_online 不允许 synthetic。计费 token 必须从提供方用量记录取得，不能用字符数冒充。当前示例没有任何真实在线记录，报告 `online_model_evaluation` 与 `real_cost_evaluation` 均为 `not_run`。

输出分别报告每次运行主调用/摘要/回查/重试直接费用、离线分摊费用、原始离线发生费用与未分摊余额，以及各 pair 的 guard-minus-original 差额和已记录任务结果。小数以 12 位精度输出；这是实验记账而非财务结算系统。`task_success:null` 是未测，失败运行不能标成成功。未来只有取得用户授权后才运行真实在线成对任务；本工具不发起任何模型请求。
