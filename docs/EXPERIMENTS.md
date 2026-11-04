# 成对实验准备与本地验收

已准备合成先导任务与采集链路，并在明确授权后完成官方 DeepSeek 的五对真实模型实验。下文的本地模拟验收保持独立；真实调用流程见 [ONLINE_PILOT.md](ONLINE_PILOT.md)，实测结果见 [online-pilot-result.txt](../reports/online-pilot-result.txt)。任务仍是合成问题，独立实付账单和真实项目收益尚未验证。

## 已准备的任务

`evaluation/tasks.mjs` 定义五类任务，材料生成到新的工作目录，不复制预设修复答案：

| 任务 | 来源 | 验收目的 |
|---|---|---|
| flat-failure | synthetic_fault | 定位平面 TAP 失败、保留退出码、压缩后回查 |
| nested-failure | synthetic_fault | 嵌套失败分支证据、回查后修复 |
| rg-repair | synthetic_fault | rg JSON 搜索后修改；必要证据超预算时保留回退样本 |
| unsupported-control | synthetic_control | 不支持的普通命令保持原样，记录 skip |
| short-control | synthetic_control | 说明开销抵消压缩时保持短输出 |

当前 rg 契约把请求的 context 事件列为必要证据。此任务会出现 output_budget_exceeded，必须纳入全部任务统计，不能删除样本或放松契约以提高 applied 数。

```sh
mkdir -p .contextguard/experiments
node evaluation/prepare.mjs .contextguard/experiments/pilot-001
```

输出包括 plan.json 与 10 个独立工作目录。A/B 顺序在任务之间交替；重复实验使用新的 pair/run ID。两条件共享任务、初始输入哈希和设置；工作目录和会话分别独立。已有目标目录会拒绝覆盖。计划明确列出缺失配置，`online_execution_ready` 保持 false，本脚本不启动模型。

A 是原生 OpenCode 正文加同一观察器；B 启用 ContextGuard。两个条件均保留原生截断/压缩，不只为 B 指定有利的 reporter/提示。工作区内的测试可用于诊断；最终断言由外部运行器执行，并拒绝任何受保护测试的修改或删除。

## 可复现运行器

`evaluation/opencode-runtime.mjs` 与 `evaluation/local-acceptance.mjs` 启动固定 OpenCode、新会话、隔离配置和本地脚本化协议服务，设置单次 60 秒上限。它只运行本地测试 provider，不是在线模型启动器。验证的是插件及采集链路，预设修复步骤通过不能算作 Agent 的任务质量。

```sh
python3 -B tools/setup-opencode.py
node evaluation/local-acceptance.mjs
node evaluation/ledger.mjs reports/integration-ledger.synthetic.jsonl
```

本地运行器执行五个配对任务和四个独立边界会话（超预算、原生截断、未知格式、工具抛错不经过 after hook）。报告全部任务和决策；下一次请求的工具正文 SHA 必须与适配器交付 SHA 相同。运行时工具清单必须与调用日志一致。真实日志留在 .contextguard，分发仅包含带 synthetic 标注的汇总/示例账本。

## 用量与费用导入

`evaluation/usage.mjs` 提供 `readUsage(path, options)` / `importUsage(records, options)`，当前支持明确的 chat-completions usage 字段：`prompt_tokens`、`prompt_tokens_details.cached_tokens`、`completion_tokens`。未缓存输入为前两者之差；输出包含提供方报告的 reasoning 计费部分。缺失 usage 或缓存计数直接拒绝，不填零。

每条采集记录必须包含：

- `request_id`：整个实验中唯一的提供方请求标识。
- `evidence_kind`：synthetic 或 measured_online；`model`：固定的请求模型。
- `response`：保存提供方原始 response（包含 model 与 usage）。
- `category`：primary、summary、retrieval 或 retry 中的一个。同一请求只能归入一个类别。
- `cost: { usd, source, evidence_ref }`：synthetic、provider_billed 或 rate_card_estimate。真实数据须附账单/价格依据，估算不能写成实付。

调用选项必须带 `expectedRequests` 独立请求清单、`expectedModel` 和 `evidenceKind`；measured_online 还必须提供 `expectedResponseModel`，检查实际响应的模型。重复的相同记录去重，冲突记录、漏记请求、跨运行重复计费均拒绝。导入结果带原始 response 哈希；文件读取接口另附源文件 SHA。此工具校验所提供数据的结构和一致性，不独立证明提供方账单真实性。

**不能仅用 OpenCode 的 step_finish 计算完整费用。** 本地实测存在标题等辅助请求不出现在该流中。`inspectOpenCodeSteps` 只作为部分证据：input 加 cache.write 归入非缓存输入，cache.read 单列，output 加 reasoning 计入输出；原始细分值也保留。OpenCode 自身 cost 是估算，不是发票。完整总账要从 provider 请求清单和响应/账单采集，包含辅助调用和重试，不能把同一请求另算一次回查费用。

工具正文 token 的 tokenizer 必须随未来模型单独固定；当前为 null。总耗时、调用/回查/重试次数和字符长度可直接采集，但不替代模型 token。真实运行应保存失败、超时、未完成和未触发任务。

## 后续在线执行门槛

本次已明确提供方、模型与参数、预算、时间/请求次数上限，并取得现有密钥在本项目的复用授权。新增运行器采集完整 provider 请求，按官方上下文/输出上界预留费用。后续换模型或扩大实验时需重新明确相应参数和预算；不能把其他项目的 API 授权自动视为本项目授权。五对任务的自然回查次数为零，单独要求回查的探针通过，不能把两者混为一项能力证据。后续可按预算扩展真实项目任务与必要重复。

应增加真实项目问题并与 synthetic_fault 分开报告；同时报告全部任务和实际 applied 的任务。若低触发率、回查、重试或缓存变化抵消收益，应据实报告。小样本不支持普遍不降低成功率的结论。若改用完整进程包装器，另列同包装器关闭压缩的机制对照。
