# 真实模型先导实验

2026-11-03 在项目授权和余额限制内完成官方 DeepSeek `deepseek-flash` 五对实验。模型实际生成工具调用和修复动作；五个任务仍来自合成故障/对照。结果见 [报告](../reports/online-pilot-result.txt)、[机器记录](../reports/online-pilot.json)和[复核摘要](../reports/online-pilot-analysis.json)。不把五个小任务的结果外推到真实项目。

## 执行与采集

`evaluation/online-pilot.mjs` 使用明确指定的已授权 env 文件。它只提取 `DEEPSEEK_API_KEY`，不复制凭据文件，不把密钥传给 OpenCode。执行会调用真实 API；普通测试、`verify.mjs` 和打包不会启动在线实验。

```sh
node evaluation/online-pilot.mjs /ABSOLUTE/PATH/TO/AUTHORIZED.env
```

固定 OpenCode 1.19.5 的官方归档和二进制；每会话配置、目录及状态隔离，关闭全局技能发现。主调用和辅助调用均使用同一模型，禁用思考、温度 0.2、每请求最多输出 4096 token。运行前给 A/B 两条件相同的明确诊断命令、任务提示和文件快照；顺序交替，核心输出上限均为 12000 UTF-16 单元。模型自行读取、编辑和验证，运行器不提供预设修复答案。

本地采集代理只转发到官方端点。每次请求先持久化独立 attempt ID 和预算预留，再发往 provider；原始 SSE、请求正文、响应 ID、模型名、后台指纹、缓存分项和输出用量均保存。DeepSeek 最后一个内容 chunk 中的 usage 也必须被读取；缺失、冲突或中断不能填零。通过下一次请求逐字核对工具正文，并用 OpenCode 事件清单检查工具记录覆盖。

`evaluation/deepseek-usage.mjs` / `online-budget.mjs` 维护原币种记录。原有 `evaluation/ledger.mjs` 仍是 USD 格式，不将人民币伪装成美元。费用使用固定官方高峰价估算，实际 usage 中的缓存命中单独计价；不是独立实付账单。

## 预算和中断

授权默认上限为 CNY 20 或 USD 3，实际取账户可用余额与上限的较小值；每会话上限 CNY 3 或 USD 0.50，最多 12 次模型请求、8 分钟。辅助调用、调试和回查探针均计入总额。所有付费请求串行进入同一本预算记录。

本地 tokenizer 尚未校验，因此按官方完整上下文上界加 4096 输出 token 做保守预留，人民币约 2.13 元/请求。预留后额度不足则拒绝下一请求；已完成的请求按完整 usage 结算。流中断或用量缺失会保留预留并停止。不会自动充值、换模型、重置预算或静默恢复旧预算文件。余额充足不表示已经获准扩大任务数量。

## 证据与复核

原始材料位于 `.contextguard/online/pilot-*/`，权限收紧且不进入分发包：

- `pairs/plan.json` 与各工作目录：输入哈希、条件、提示、独立验收。
- `requests/inventory.jsonl` 与每个 attempt 目录：完整转发清单、实际请求和原始 SSE。
- `budget.json` / `ledger-native.json`：预算状态与原币种用量。
- `state/`：OpenCode 输出及逐会话复核。
- `balance-*.json`：余额观察；未排除其他账户活动时不能归因成实付账单。

```sh
node tools/audit-online-pilot.mjs
```

该离线复核检查原始请求/响应哈希、独立转发清单、重复请求、实际 usage、费用公式、最终文件、工具正文和源码身份。需要当前机器的私有原始材料。`verify.mjs` 只检查保存的报告与源码对应，不重跑付费模型，也不认证提供方账单。

## 本次结果的限制

五对只重复一次，并使用明确测试命令，不能代表自然命令分布或真实项目。缓存会跨会话共享；即使未压缩的对照任务也可能产生费用差异。自然任务没有回查；显式要求回查的单独探针仅证明命令可用。工具正文自己的 tokenizer 尚未核验，字符减少不等于 provider token 减少。模型别名和后台指纹可以记录，但不等于冻结模型权重。

当前 hook 仍受上游合并/截断约束。rg context 是必要证据，超预算时回退是契约行为；不能靠删除这类任务提高压缩率。后续需要真实项目任务、重复测量、自然回查需求和实际账单核对。
