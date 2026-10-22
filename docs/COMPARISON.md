# ContextGuard 与已知替代品

ContextGuard 的窄目标是：将 **Node TAP / rg JSON 的原始 stdout、独立候选文本和进程元数据** 放在一起校验；候选必须由原文中按顺序出现的完整行组成，必须保留本项目格式合同规定的证据。缺证据时补回原始单元；篡改、格式不支持、预算不足或原始记录不完整时返回原文。它不承诺任意语义无损，也不声称发明了输出压缩、日志过滤、原文缓存或失败回退。

## 已查证来源

以下版本在 2026-10-22 重新核查并固定。[版本清单](../research/peers-lock.json) 与 [原始文件索引](../research/source-index.json) 包含全长 SHA、许可证、下载哈希和源文件。

| 已知替代品 | 固定来源与许可证 | 与本项目的关系 | 本轮证据 |
|---|---|---|---|
| HarnessPro | [8ae622eb4a49](https://github.com/pzs19/HarnessPro/tree/8ae622eb4a4923dbb4b515be7ded614f88fd4f38)，MIT + RHO MIT 归属 | 更广的 harness 进化/路由/预算政策；发布的 TB2 Lite 钩子把重复行折叠并做字符头尾截取，保存 raw 文件供恢复 | 未修改的 [hook.py](https://github.com/pzs19/HarnessPro/blob/8ae622eb4a4923dbb4b515be7ded614f88fd4f38/harnesses/terminal-bench-2/lite/runtime/hook.py#L117-L208) 已在相同 stdout 上运行；不是完整模型实验 |
| RTK | 源码 `develop` [5ab6291365e9](https://github.com/rtk-ai/rtk/tree/5ab6291365e9d14f486a89d04af6b7da6710105c)；另执行 [OSS v1.0.1](https://github.com/rtk-ai/rtk/releases/tag/v1.0.1)，release commit `4ef8730cf3a0dea11c8d64a9b90bc0616fe52100` | 广泛命令过滤、管道、输出恢复；`rg --json` 原生路径透传，`pipe` 未识别格式也透传，已有安全替代行为 | OSS CLI Apache-2.0；完整 engine/proxy BUSL-1.1。已运行 `pipe` 和原生 `rtk rg --json`，不混用 source/release 版本 |
| Headroom | [e995eb9f1dac](https://github.com/headroomlabs-ai/headroom/tree/e995eb9f1dacac7ed548758406de6c1508caef95)，根许可证 Apache-2.0，附 NOTICE | 日志/搜索/代码等多种压缩；CCR 保存原文并可在后续查询时恢复，覆盖面远超本项目两种格式 | 仅源码核查；当前 [log shim](https://github.com/headroomlabs-ai/headroom/blob/e995eb9f1dacac7ed548758406de6c1508caef95/headroom/transforms/log_compressor.py) 依赖 Rust `_core`，未运行压缩性能比较 |
| posoco/ext-llm | [Mooncakes 0.2.0](https://mooncakes.io/docs/posoco/ext-llm@0.2.0)，声明 Apache-2.0 | Provider/model slot 路由；其 `compact` 委托选中 slot 的实现，不是本项目的工具输出证据合同校验器 | 下载固定包、检查 manifest 和 `src/router.mbt:533-540`；未调用 provider。包未附独立 LICENSE，已记录 |
| Across2005/harness-self-evolution | [Mooncakes 0.3.8](https://mooncakes.io/docs/Across2005/harness-self-evolution@0.3.8)，MIT；[GitHub 来源](https://github.com/Across2005/harness-self-evolution-plugin/tree/167d15d6dbcc80ff1cd5571c632add1bd1fac6af) | DeepSeek Harness 插件的监测、提案、人工审批与执行状态控制，当前包公开说明真实子进程执行尚需事务适配器 | 下载固定包并检查 `src/executor/runner.mbt:122-142`；未运行 DSH，不声称与 GitHub SHA 字节等同 |

RTK 的 [never_worse](https://github.com/rtk-ai/rtk/blob/5ab6291365e9d14f486a89d04af6b7da6710105c/src/core/guard.rs#L24-L33) 比较的是估算 token 数，并不能据函数名解释成任意事实保真证明。与此同时，其 [search 路径](https://github.com/rtk-ai/rtk/blob/5ab6291365e9d14f486a89d04af6b7da6710105c/src/cmds/system/search.rs#L750-L754) 明确保护用户选择的结构化格式；本项目必须承认这一已有做法。

## 三个具体差异用例

### 1. 中段 TAP 失败必须在当前结果中可见

`node-tap-middle-failure` 是合成 Node 测试程序的真实进程输出，75 个结果中间有一项失败。必要证据来自原始 stdout 的外部标注，包含失败名称、完整 YAML 诊断、actual/expected、位置、skip/todo、计划和汇总。

固定 HarnessPro Lite 默认策略首次展示 **10/17** 个证据项：末尾 `# fail 1` 仍在，但中间断言块不在。它自己的 raw store **确实完整恢复了原文**；不能写成永久丢数据。ContextGuard 在当前离线比较中保留 **17/17**，通过原文提取与候选验证让该块在当前结果中可见；在线回查次数并未测量。RTK `pipe` 同样保留 **17/17**，其代价是在本输入上直接透传，没有字符减少。完整逐案结果见 [独立评测](../reports/evaluation.json) 和 [同行重放](../reports/peers-harnesspro.json)。

### 2. 长 rg JSON 命中不能按字符切成半条记录

`rg-json-multiple-unicode-long` 有 Unicode 路径、多文件命中、上下文和一条长中段命中。HarnessPro 实际头尾视图首次保留 **7/14** 个必需证据项；字符切割可能位于 JSON 行内。ContextGuard 要求命中/上下文/汇总使用原文完整行；若预算放不下这些必要单元，则原文回退优先于强行达到长度目标。这意味着小预算可以产生 **0% 节省**。

RTK `pipe` 在相同 stdin 上返回字节相同的完整输出；另一次真正运行 `rtk rg --json` 的三个检查保留原生退出码 **0 / 1 / 2**、stderr，并在只忽略时间字段与文件遍历顺序后得到同一 JSON 事件多重集。[实际 CLI 记录](../reports/peers-rtk-native-rg.json) 保存了原始流。这是成功的已知替代品，不是本项目要宣称击败的反例。

### 3. 外部候选篡改必须由原始输出独立否决

`fixtures/candidates/` 提供把 TAP `not ok` 改成 `ok`、改中段 actual、交换 rg 路径、修改 summary 计数、重排原文行、截断 JSON 等候选。ContextGuard 将候选对齐到原文有序行，并检查原始格式证据，拒绝新增/改写/重排后的候选；单纯漏掉合法原文单元时补回。评测器再次从原文和独立 fixture 标注检查最终结果，不信任压缩器自报的“保留成功”。

这组测试验证的是本项目明确合同与对抗候选输入；**没有**把这些伪造候选喂给未公开同类验证 API 的其他产品，也不据此声称那些产品不存在安全机制。HarnessPro raw cache、Headroom CCR、RTK recall/透传都是应当考虑的恢复或保护路径；ContextGuard 可作为受限格式的前置检查层。

## 公平比较与限制

公开默认策略与同一输出预算分别记录，不把不同预算下的压缩率作全局排名。完整字符定义、预算设置、热身和计时边界，以 [evaluation.md](../reports/evaluation.md) 为准；HarnessPro 的包络/提示文字也计入实际候选长度。必需证据项有重叠，例如完整失败块和其中的字段，不是独立随机样本；14/14、17/17 是可复现合同检查，不是统计显著性。

所有输入来自合成程序/文本的真实本地进程，而非生产 Agent 轨迹；无付费模型调用。当前合同不是 TAP/rg 的所有方言实现，不保留所有普通成功测试细节，也不验证 stdout 本身是否诚实。进程 scope/exit/truncation 由可信捕获端提供，候选不能自报替代它。原始输入已截断时，回退只表示返回收到的原文，不能找回从未捕获的字节。未知格式返回原文。

未测项目包括模型 token、完整任务成功率、缓存计费、后续回查量、重试、优化摊销与真实净成本。本文不把字符减少称为省钱，不把保存 raw 路径称为模型已成功回查，也不把 Mooncakes 查重描述等同于参赛资格保证。可复现调用、平台和许可证见 [research/README.md](../research/README.md)。
