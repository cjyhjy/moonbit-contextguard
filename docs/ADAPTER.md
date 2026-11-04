# OpenCode 1.19.5 项目级适配

当前开发版为 0.3.0-dev.1，未发布。固定 OpenCode **1.19.5**，官方源码提交 `810c0eba1a7348036f8bdf61e6632d0c36c6876c`。版本、Git blob 与二进制归档 SHA-256 见 `adapters/opencode-pin.json`，官方类型和必要调用片段保存在 `adapters/vendor/`，附 MIT 许可证。1.2.0 的历史协议重放仍保留为回归测试，不能混称本轮运行时证据。

## 项目入口

OpenCode 的自动发现规则只扫描 `{plugin,plugins}/*.{ts,js}`。在目标项目的 `.opencode/plugins/contextguard.js` 创建入口，内部可以导入本项目的 `.mjs`：

```js
import { createContextGuardPlugin } from '/ABSOLUTE/PATH/TO/contextguard/adapters/opencode.mjs';
export const ContextGuard = createContextGuardPlugin({
  runId: 'unique-experiment-run-id',
  mode: 'guard',
  maxOutputChars: 12000,
  allowCommands: [{
    command: 'node --test --test-reporter=tap test/task.test.cjs',
    workdir: '.',
    scope: ['test/task.test.cjs'],
  }],
});
```

同一仓库内也可从这个 `.js` 入口导出 `../../adapters/opencode.example.mjs` 的 ContextGuard。示例仅允许两条夹具命令。默认允许列表为空，默认不会压缩任何命令，但会写调用观测日志。用于其他项目时调整模块路径、命令、工作目录和范围。

工厂选项 `mode: 'observe'` 用于对照：相同日志采集，完整保留 OpenCode 原生正文。两个条件使用相同任务说明、reporter、权限、工具和原生输出限制。生产使用、在线模型或全局配置不会由这些脚本自动启用。

## 接口与保留条件

固定版的 hook 仍为 `tool.execute.after(input, output)`，原生 shell 对外工具 ID 保持 `bash`，结果可修改 `output.output`。

仅处理原生 bash、允许列表中的完整命令、匹配的工作目录、整数退出码和明确的布尔截断状态。只推断简单的 `rg --json` 与显式 TAP reporter 命令；组合 shell、引号和展开、npm test、内置搜索等不自动接管。退出码与命令范围来自宿主/调用者，不从输出正文推断。

`title`、`metadata`、`attachments` 保留原值及对象引用。原文先保存，核心独立校验通过且连同说明、回查命令后的完整可见正文严格更短时才替换。未知格式、篡改、预算不足、采集不完整或进程字段变化回退原文。磁盘、核心、审计异常保留原输出；审计不可写时不允许压缩。

**hook 可见正文并非完整 stdout。** 固定版上游 shell 合并输出并在 hook 前截断。已经截断的文本保持原样；本适配器不把上游输出文件自动重新解释为可信完整采集。需要完整双流时，可另行集成已有 `tools/run.mjs`，并单独验收及增加同包装器关闭压缩的对照。

## 调用记录与回查

默认记录目录 `.contextguard/evidence/`，目录 0700、文件 0600，不上传，且不进入分发包：

- `events.jsonl`：插件加载、调用开始、hook 决策、原生完成/错误事件、重试事件和回查；具有 run/session/call 标识、唯一 event ID 和时间戳。未匹配调用也记录原因，不保存其完整正文或参数。
- `raw-<sha256>.txt`：准确保存 hook 可见正文。
- `receipt-<sha256>.json`：输入参数、进程字段、原始 metadata/附件、原文哈希、run ID 和预算。
- `decision-<sha256>.json`：核心决策、证据行号和最终可见 UTF-16 长度，包括说明开销。

替换正文包含 `recall_command` 与原始总行数。按命令填入 START/END 后，回查同时验证 receipt 文件名哈希和原文 SHA，返回指定行，并记录成功/失败事件。CLI 工具调用的退出码单独计数，能够观察 receipt 本身损坏等回查前失败。

```sh
node adapters/recall.mjs RECEIPT.json 1 20
node evaluation/telemetry.mjs .contextguard/evidence/events.jsonl
```

汇总报告区分 total_calls、contract_eligible、applied、fallback、skip、error、runtime_failed、unfinished、回查和重试。原生工具失败可能不经过 after hook，因此另采集 `message.part.updated`；运行器还用独立的 OpenCode 工具事件清单核对覆盖率。日志写入失败无法保证持久观测完整，错误会送往宿主日志，并回退原文。日志中有未完成调用、缺失开始或交付正文不一致时，不能标为完整采集。

字符统一为 UTF-16，`tool_output_tokens` 默认为 null，不能从字符减少推算实付节省。

## 本地验收

```sh
python3 -B tools/setup-opencode.py
node --test tests/adapter-opencode.test.mjs tests/adapter-telemetry.test.mjs tests/experiment.test.mjs
node evaluation/local-acceptance.mjs
```

下载器只将固定官方二进制写入项目缓存，支持 macOS arm64/Linux x86_64。实际本轮运行平台见报告。运行时验收需要本地回环端口、Node 和 rg；使用独立配置/数据/缓存目录、唯一工作目录和新会话，不继承提供方密钥。配置只启用本地协议模拟 provider。

`reports/integration-local.json` 是验收结果；每次尝试的原始请求、OpenCode 事件、调用日志和报告保存在 `.contextguard/acceptance/`。它启动真实 OpenCode 和本地工具，通过下一次协议请求逐字核对工具正文，覆盖 TAP 压缩、失败退出码、SHA 回查、rg 回退、未支持命令、短输出、超预算、上游截断和未知格式。

响应、修复步骤和用量均由确定性脚本提供，不涉及真实模型推理。不能据此声称真实任务成功率、模型自主回查能力、token 节省或账单改善。完整实验边界见 [EXPERIMENTS.md](EXPERIMENTS.md)。
