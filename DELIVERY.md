# ContextGuard 0.3.0-dev.1 本地开发交付

本工作区在已发布 0.2.0 基础上补齐 OpenCode 接入、调用观测和实验准备，尚未发布。执行计划见 [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md)，本地运行时验收见 `reports/integration-local.json`。历史比赛验收见 [ACCEPTANCE.md](ACCEPTANCE.md)；0.2.0 发布收据保持历史状态，不作为本开发版发布证明。

## 可复现流程

从公开仓库克隆后，在仓库根目录执行：

```sh
python3 -B tools/bootstrap.py
export MOON_HOME="$PWD/.toolchain"
node tools/verify.mjs
python3 -B tools/package.py
sh tools/moon run cmd/example --target js
node tools/example.mjs
node demo/server.mjs
```

需要 Node.js 22+、Python 3.9+ 和 curl。bootstrap 支持 macOS arm64/Linux x86_64；固定 moonc 0.10.18+6c83a7f62，官方归档哈希见 `toolchain.lock.json`。网页地址为 http://127.0.0.1:4187/。实际搜索示例额外需要 ripgrep；自动验收使用已捕获夹具，无需安装它。

`verify.mjs` 执行版本门禁、fmt、三个后端的 check/build/test、Node API/进程/HTTP/适配器测试、账本测试、独立评测、768 项删除变异审计、CLI 和示例。`tools/verify-registry.py` 检查实际 Mooncakes ZIP 白名单，在独立目录解压，再在独立消费者中通过三个后端的公共 API 测试和打包示例。

## 分发内容

- Mooncakes：`cjyhjy/contextguard@0.2.0`，根包 API `guard_request(String) -> String`。包含核心源码、测试、最小示例、README 和许可。
- 当前源码：完整 MoonBit 核心、Node CLI、进程包装器、OpenCode 1.19.5 适配器、调用观测、合成实验运行器和本地演示；提交/推送状态另行记录。
- 开发版便携 ZIP：`release/contextguard-0.3.0-dev.1.zip` 和 `.sha256`，由通过当前输入验证的冻结快照生成，在新解包目录复验；哈希见 `reports/package-verification.json`。它不是已发布 0.2.0 的资产。

Mooncakes 实际发布、外部重新下载导入和对应 CI 的状态以 `reports/publication-0.2.0.json` 为准。CI 完整报告在对应 Actions artifact 内；不能用旧提交的绿灯替代新提交验证。

## 使用边界

只支持明确约定的 Node 平面与嵌套 TAP 与 rg JSONL。压缩输出是带原始行索引的证据摘录，不能当作完整 TAP/rg 事件流再次解析。截断、未知格式、证据篡改或预算不足时返回原文。进程包装器保留双流、退出码、范围和 SHA-256 回查；失败示例预期返回 1，超时 124，采集超限/保存失败 125。

夹具工作负载是合成的，stdout/stderr 来自真实本地进程。RTK 可选二进制不随包分发，缺失时明确标记 unrun；HarnessPro 是实际离线对照。真实 OpenCode 会话通过本地脚本化协议服务验收，模型响应、用量和修复步骤是 synthetic。在线模型 token、账单、自主任务成功率尚未验证。OpenCode 官方二进制缓存、实验工作区与原始日志均不随包分发。真实模型、全局配置、推送、发布和参赛提交不由本轮脚本自动执行。
