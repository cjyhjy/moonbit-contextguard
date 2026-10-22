# ContextGuard

[![CI](https://github.com/cjyhjy/moonbit-contextguard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cjyhjy/moonbit-contextguard/actions/workflows/ci.yml)

用 MoonBit 校验工具输出压缩后的必要证据。适用于明确约定的 **Node 平面 TAP** 和 **ripgrep JSONL**：检查候选正文，补回缺失的完整证据单元；发现篡改、未知格式、原始截断或预算不足时保留原文。

这是可运行的 0.1.0 源码版本，公开仓库为 [cjyhjy/moonbit-contextguard](https://github.com/cjyhjy/moonbit-contextguard)。GitHub Actions 对每次提交执行 Linux 源码与便携包验收，实际结论以徽章和对应提交的 run 为准。没有调用付费模型 API、安装到当前 Agent、发布 Mooncakes/npm 包或正式参赛提交。它验证限定格式的证据保留，不承诺任意语义无损、模型 token 减少、净费用降低或在线任务成功率提升。

## 直接运行

需要 Node.js 22+（本轮实际使用 26.7.0）。交付包含由 MoonBit 编译的 `dist/contextguard.mjs`，无需 npm 安装或账户。

```sh
node tools/example.mjs
node tools/cli.mjs fixtures/example-request.json
node --test tests/*.test.mjs
node demo/server.mjs
```

浏览器打开 http://127.0.0.1:4187。支持查看原文、候选、修复/回退结果和原始行区间。服务器只监听本机，不执行网页提供的命令。端口可用 `CONTEXTGUARD_DEMO_PORT=4188 node demo/server.mjs` 调整。

## 包装真实进程

```sh
node tools/run.mjs --format node-tap --text -- node --test --test-reporter=tap fixtures/sources/many-tests.test.cjs
node tools/run.mjs --format rg-json --text -- rg --json --no-config -C 1 needle fixtures/sources/search
```

第一个例子故意有一个失败，包装器因此返回退出码 **1**；这是预期演示。stdout 经过核心，stderr 原样单独保留。输出注明退出状态、命令范围、采集是否完整和原文目录。`reports/captures/` 中每次生成独立记录，不覆盖旧结果。

```sh
node tools/recall.mjs CAPTURE_DIR stdout 1 20
```

回查前验证 SHA-256。默认进程超时 30 秒、stdout 与 stderr 合计采集上限 8 MiB；达到限制会终止该次进程并明确标记不完整。非 UTF-8 输出保存原始字节，文本仅作解码显示，不声称字节无损。

## 从 MoonBit 源码构建

使用现有 MoonBit 工具链即可；也可运行下方 bootstrap，把官方固定版本归档下载到本仓库并验证锁文件中的 SHA-256。支持 macOS arm64 与 Linux x86_64，不改变全局环境。版本为 moon 0.1.20261012、moonc v0.10.15+943464bfa。

```sh
# 可选：通过 Python 3 与 curl 下载已锁定的官方工具链，仅写本仓库。
python3 -B tools/bootstrap.py
export MOON_HOME="$PWD/.toolchain"
node tools/verify.mjs

# 或复用已有工具链；moon 已在 PATH 中时，不必设置 MOON_HOME。
export MOON_HOME=/path/to/your/moonbit-toolchain
node tools/build.mjs
sh tools/moon check --target js
sh tools/moon test --target js
sh tools/moon test --target native
sh tools/moon test --target wasm-gc
```

MoonBit 实现位于 `src/`，包括原文格式识别、证据提取、候选正文校验、压缩选择、修复和预算决策。Node 负责 JSON/文件/进程/HTTP 胶水；未把核心算法移到 JavaScript。工具链安装参考 [MoonBit 官方文档](https://docs.moonbitlang.com/en/latest/getting-started.html)。

## 证据和比较

```sh
node evaluation/evaluate.mjs
python3 -B research/run_peer.py --json < fixtures/raw/node-tap-middle-failure.stdout.txt
node evaluation/ledger.mjs evaluation/example-ledger.synthetic.jsonl
node tools/verify.mjs
python3 -B tools/package.py
```

夹具的**测试程序和搜索文本是合成的，stdout/stderr 来自真实本地进程**。历史 macOS 对照执行了固定版本的 HarnessPro hook 和 RTK 二进制。仓库与便携包不携带平台专用 RTK 可执行文件；新运行中缺失或平台不兼容时明确记为 unrun，HarnessPro 仍实际执行。Headroom 和 Mooncakes 近邻只做源码/注册信息调查，不能写成已运行。RTK 在本测试范围内透传成功；HarnessPro 的原文缓存可恢复遗漏内容。各方法预算、初始输出和回查后的完整性分别报告。

- [API 与支持边界](docs/API.md)：严格提取式契约、错误状态、预算单位。
- [架构与信任边界](docs/ARCHITECTURE.md)：候选正文如何独立验证。
- [比较说明](docs/COMPARISON.md)、[独立评测](docs/EVALUATION.md)、[评测结果](reports/evaluation.md)。
- [可选 OpenCode 适配](docs/ADAPTER.md)：固定 v1.2.0，仅离线协议验收，不改全局配置。
- [AI 协作与来源](docs/AI_USAGE.md)、[许可](THIRD_PARTY_NOTICES.md)。
- [交付与准确复现命令](DELIVERY.md)、[历史本地验收结果](reports/verification.json)。
- [独立仓库历史与发布边界](docs/HISTORY.md)：保留九条真实开发提交；最新 Linux 证据从对应 Actions run 的 artifact 获取。

压缩结果是标注来源的**证据摘录**，不能重新当成完整 TAP 或完整 rg 事件流交给下游解析器。原文始终可回查；通过测试的名称和耗时可从原文找回。stdout 字符减少不包含 stderr、进程头、索引、缓存、回查和重试成本。
