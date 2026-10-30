# ContextGuard

用 MoonBit 校验工具输出压缩后的必要证据。适用于明确约定的 **Node 平面与嵌套 TAP** 和 **ripgrep JSONL**：检查候选正文，补回缺失的完整证据单元；发现篡改、未知格式、原始截断或预算不足时保留原文。

当前版本 **0.2.0**。核心支持 JS、native、wasm-gc，固定 `moonc 0.10.18+6c83a7f62`，满足比赛不低于 0.10.16 的要求。公开仓库：[cjyhjy/moonbit-contextguard](https://github.com/cjyhjy/moonbit-contextguard)；逐条验收见 [ACCEPTANCE.md](ACCEPTANCE.md)，发布核验见 [reports/publication-0.2.0.json](reports/publication-0.2.0.json)。

它验证限定格式的证据保留，不承诺任意语义无损、模型 token 减少、净费用降低或在线任务成功率提升。

## 安装 MoonBit 库

```sh
moon add cjyhjy/contextguard@0.2.0
```

在 `moon.pkg` 中添加 `import { "cjyhjy/contextguard" @guard }`，调用 `@guard.guard_request(request_json)`。完整用法见 [README.mbt.md](README.mbt.md)。仓库附带纯 MoonBit 示例：

```sh
python3 -B tools/bootstrap.py
export MOON_HOME="$PWD/.toolchain"
sh tools/moon run cmd/example --target js
```

示例输出的 `decision` 应为 `compressed`，`assurance` 为 `required_source_units_verified`；也支持 `--target native` 和 `--target wasm-gc`。

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

嵌套套件还可用 `node tools/run.mjs --format node-tap --text -- node --test --test-reporter=tap fixtures/nested-tap/sources/suites.cjs` 验证（预期退出码 1）。新增格式契约、语料来源和对比数据见 [嵌套 TAP 说明](docs/NESTED_TAP.md)。

第一个例子故意有一个失败，包装器因此返回退出码 **1**；这是预期演示。stdout 经过核心，stderr 原样单独保留。输出注明退出状态、命令范围、采集是否完整和原文目录。`reports/captures/` 中每次生成独立记录，不覆盖旧结果。

```sh
node tools/recall.mjs CAPTURE_DIR stdout 1 20
```

回查前验证 SHA-256。默认进程超时 30 秒、stdout 与 stderr 合计采集上限 8 MiB；达到限制会终止该次进程并明确标记不完整。非 UTF-8 输出保存原始字节，文本仅作解码显示，不声称字节无损。

命令启动前校验所有预算；超时的包装器退出码为 124，采集超限或证据保存失败为 125，实际子进程状态仍在 `process.exit_code`。保存失败时返回已采集的两条流并标记 `capture.available=false`。`delivery_metrics` 计入进程说明和 stderr，因此小输出的净字符减少量可以是负数；OpenCode 适配器则只在完整可见结果更短时替换正文。

## 从 MoonBit 源码构建

使用仓库锁定的官方工具链。bootstrap 核对归档 SHA-256，仅安装到本仓库 `.toolchain`，支持 macOS arm64/Linux x86_64。需要 Python 3.9+、curl、Node.js 22+；CI 使用 Node 26.7.0。

```sh
python3 -B tools/bootstrap.py
export MOON_HOME="$PWD/.toolchain"
node tools/check-toolchain.mjs
node tools/verify.mjs
python3 -B tools/package.py
```

`verify.mjs` 包含格式检查、三个后端的 check/build/test、Node 集成回归、独立评测、变异审计，以及 Mooncakes 源码包在独立消费项目中的导入和运行检查。已有相同版本时可将 `MOON_HOME` 指向该工具链；版本门禁拒绝旧版本和与锁定版本不一致的编译器。

MoonBit 实现位于 `src/`，包括原文格式识别、证据提取、候选正文校验、压缩选择、修复和预算决策。Node 负责 JSON/文件/进程/HTTP 胶水；未把核心算法移到 JavaScript。工具链安装参考 [MoonBit 官方文档](https://docs.moonbitlang.com/en/latest/getting-started.html)。

## 证据和比较

```sh
node evaluation/evaluate.mjs
python3 -B research/run_peer.py --json < fixtures/raw/node-tap-middle-failure.stdout.txt
node evaluation/ledger.mjs evaluation/example-ledger.synthetic.jsonl
node tools/verify.mjs
python3 -B tools/package.py
```

夹具的**测试程序和搜索文本是合成的，stdout/stderr 来自真实本地进程**。对照执行了固定版本的 HarnessPro hook，以及当前机器可用的 RTK 二进制。Headroom 和 Mooncakes 近邻只做源码/注册信息调查，不能写成已运行。RTK 在本测试范围内透传成功；HarnessPro 的原文缓存可恢复遗漏内容。各方法预算、初始输出和回查后的完整性分别报告。

- [API 与支持边界](docs/API.md)：严格提取式契约、错误状态、预算单位。
- [架构与信任边界](docs/ARCHITECTURE.md)：候选正文如何独立验证。
- [比较说明](docs/COMPARISON.md)、[独立评测](docs/EVALUATION.md)、[评测结果](reports/evaluation.md)。
- [可选 OpenCode 适配](docs/ADAPTER.md)：固定 v1.2.0，仅离线协议验收，不改全局配置。
- [AI 协作与来源](docs/AI_USAGE.md)、[许可](THIRD_PARTY_NOTICES.md)。
- [交付与准确复现命令](DELIVERY.md)、[机器验收结果](reports/verification.json)。

压缩结果是标注来源的**证据摘录**，不能重新当成完整 TAP 或完整 rg 事件流交给下游解析器。原文始终可回查；通过测试的名称和耗时可从原文找回。stdout 字符减少不包含 stderr、进程头、索引、缓存、回查和重试成本。
