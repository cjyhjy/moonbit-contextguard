# OpenCode 可选适配器

本适配器面向 **OpenCode 1.2.0 / `@opencode-ai/plugin` 1.2.0**，固定源码提交为 `ffc000de8e446c63d41a2e352d119d9ff43530d0`。这是已核查的历史版本，不表示支持当前全部 OpenCode 版本。实现和离线测试不需要安装 OpenCode、不调用模型，也没有修改用户的 Agent 配置。

## 接口证据

以下均为 OpenCode 官方仓库的固定提交：

- [插件类型](https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/plugin/src/index.ts#L189-L196)：`tool.execute.after(input, output)` 包含 `input.args`，结果具有 `title`、`output`、`metadata`。
- [原生工具调用点](https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/opencode/src/session/prompt.ts#L799-L810)：执行工具后等待钩子，随后返回同一结果对象。
- [钩子分发函数](https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/opencode/src/plugin/index.ts#L101-L115)：把结果对象直接传入每个钩子。
- [bash 结果](https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/opencode/src/tool/bash.ts#L258-L266)：`metadata.exit` 来自真实进程退出码。
- [工具截断包装层](https://github.com/anomalyco/opencode/blob/ffc000de8e446c63d41a2e352d119d9ff43530d0/packages/opencode/src/tool/tool.ts#L66-L84)：在钩子前生成 `metadata.truncated`，因此钩子接收到的文本可能已截断。

版本、Git blob SHA 与来源存于 `adapters/opencode-pin.json`。官方完整插件类型与必要调用片段保存在 `adapters/vendor/`，附带上游 MIT 许可证。测试对类型文件计算 Git blob SHA，执行保存的真实上游分发函数体，并以真实 MoonBit 核心检查结果。

## 保守处理边界

仅处理原生 `bash` 且满足以下条件的结果：命令字符串与允许列表逐字相同，工作目录与规则一致，显式提供非空范围，退出码是整数，截断状态是布尔值。只推断简单的 `rg --json` 和 `node --test --test-reporter=tap` 命令。带 shell 管道、组合、展开、引号等语法的命令不启用；也不推断默认测试 reporter。

允许列表是调用者确认的进程范围，不从候选文本读取。未知工具、MCP 结果、缺少退出码、缺少截断信息、工作目录变化均保持原对象不变。已截断输入或混合诊断导致格式不被核心识别时，核心回退原文。磁盘写入失败、核心异常或返回的进程上下文变化也保持原文。

`output.metadata`、`title`、`attachments` 保持原值和对象引用。唯一修改字段是 `output.output`，其中包含一行可信进程信封，再跟校验后的输出。信封明确写出退出码、范围、截断状态、决策、输出类型以及本地证据路径。`evidence_projection` 是保留必要证据的文本投影，不能当作完整可重新解析的 TAP 或 rg JSON 数据流。

## 选择启用

先在项目根目录构建：

```sh
node tools/build.mjs
node --test tests/adapter-opencode.test.mjs
```

`adapters/opencode.example.mjs` 是可阅读的本地样例，允许列表只包含本项目两条夹具命令。它尚未安装。若用户之后决定在 **固定版本 OpenCode** 中启用，可自行在本项目的 `.opencode/plugins/contextguard.mjs` 写入：

```js
export { ContextGuard } from '../../adapters/opencode.example.mjs';
```

该路径使用本项目布局。用于其他项目时，应明确调整模块路径、允许命令、工作目录与范围。默认工厂的允许列表为空，所以直接创建默认工厂不会接管任何输出。项目级插件加载方式见 [OpenCode 官方插件文档](https://opencode.ai/docs/plugins/)；新版接口变化需重新核查，不能以本次测试推断兼容。

## 证据保存与回查

每次适配前，先把**钩子实际可见的原始文本**保存到 `.contextguard/evidence/raw-<sha256>.txt`，并保存原始 metadata、附件、调用参数、格式、预算和可信进程字段到 `receipt-<sha256>.json`。目录创建模式为 `0700`，文件为 `0600`。数据仅保存在项目本地，没有上传。工具输出可能包含项目私有信息，交付或公开前应按项目要求处理这些原始记录。

OpenCode 原生 bash 可能将 stdout 和 stderr 合并；上游也可能已截断。这里不能恢复钩子之前的数据，更不能称其为完整原始进程字节。需要两条流的字节证据时，应使用项目的 `tools/run.mjs` 进程包装器。

`decision-<sha256>.json` 保存核心完整结果、证据行号与适配器可见长度。`metrics.output_chars` 仅统计核心输出；`adapter_metrics.agent_visible_chars` 包含信封，`envelope_chars` 单独报告信封开销，全部采用 UTF-16 单位。

```sh
node adapters/recall.mjs .contextguard/evidence/receipt-REPLACE_WITH_HASH.json 218 256
```

回查会先校验保存原文的 SHA-256，再返回指定行、范围与退出状态；哈希不符则报错。未提供自动清理或无限审计存储承诺，应根据实际项目保留策略管理目录。

## 已验证与未验证

`tests/adapter-opencode.test.mjs` 覆盖固定来源、实际分发函数体、同一结果对象、metadata/附件保留、SHA 回查、篡改拒绝、真实核心压缩与回退、允许列表、工作目录、缺失状态、磁盘/核心错误和信封开销。

这属于**真实接口源码约束下的离线协议重放**。没有启动完整 OpenCode Agent、没有使用模型、没有在线任务成对实验，不据此宣称线上任务成功率、延迟或费用改善。
