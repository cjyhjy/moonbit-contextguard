# ContextGuard 0.1.1 本地交付

2026-10-30 发布同步：用户授权将此优化版提交并推送到独立仓库。以下 2026-10-22 结果为优化开发时的本地证据，归档在 `reports/history/0.1.1-local/`；本次提交的远程验收以对应 [Actions](https://github.com/cjyhjy/moonbit-contextguard/actions/workflows/ci.yml) 及其 artifact 为准。

验收日期：2026-10-22（America/New_York）。本次为 0.1.1 本地优化，最终状态以 `reports/verification.json` 和 `reports/package-verification.json` 为准。原 0.1.0 ZIP 与关键验收报告保留。本轮未修改独立发布仓库、用户 Agent 全局配置或提交参赛表单。

## 交付内容

- MoonBit 核心：`src/tap.mbt`、`rg.mbt`、`validator.mbt`、`compressor.mbt`、`request.mbt`。Node 平面 TAP 与 rg JSONL 的原文解析、独立候选正文核验、补回和回退均在 MoonBit 中完成。
- JSON CLI 与可直接运行的 `dist/contextguard.mjs`；真实 argv 进程包装器 `tools/run.mjs`；双流、范围、状态、截断标记和 SHA-256 原文回查。
- 固定 OpenCode v1.2.0 的可选 hook；仅离线协议验证，未安装至当前 Agent 或启动完整模型会话。
- 本地演示、6 份真实输出夹具、固定 HarnessPro/RTK 实际对照、独立评测与完整分类账本工具。
- 中文范围/API/使用文档、上游来源/许可、AI 协作记录、CI 配置与[优化记录](docs/OPTIMIZATION.md)。优化开发保留组合工作区，由独立仓库承接授权的提交与推送；历史记录见 `docs/HISTORY.md`。

## 准确复现命令

以下命令在项目根目录运行。发行包无需 npm 安装；已有 Node.js 22+、Python 3.9+ 即可运行编译产物和必需 HarnessPro 对照。HarnessPro 使用 fcntl，本轮可移植验收为 macOS，Linux 尚未在实际机器运行，原生 Windows 不在当前验收范围。

```sh
node tools/example.mjs
node tools/cli.mjs fixtures/example-request.json
node tools/run.mjs --format node-tap --text -- node --test --test-reporter=tap fixtures/sources/many-tests.test.cjs
node tools/run.mjs --format rg-json --text -- rg --json --no-config -C 1 needle fixtures/sources/search
node tools/recall.mjs CAPTURE_DIR stdout 1 20
node demo/server.mjs
node tools/verify.mjs --portable
```

失败测试示例故意返回 1；包装器保留该状态。超时返回 124，采集超限/保存失败返回 125，实际子进程状态另存于 `process.exit_code`。搜索命令额外需要 rg。演示默认地址为 **http://127.0.0.1:4187/**；本轮优化 QA 使用 **http://127.0.0.1:4188/**，`CONTEXTGUARD_DEMO_PORT` 可调整端口。实际 HTML 页面调用 MoonBit 核心，新截图见 `reports/demo-optimization-desktop.png`、`demo-optimization-mobile.png`。

源码验收使用本机**既有**工具链，未复制工具链、未读凭据、未改全局设置：

```sh
MOON_HOME=/path/to/existing/moonbit-toolchain node tools/verify.mjs
python3 -B tools/package.py
node evaluation/evaluate.mjs
node evaluation/audit.mjs
node --test evaluation/ledger.test.mjs
node evaluation/ledger.mjs evaluation/example-ledger.synthetic.jsonl
python3 -B research/replay_peers.py --harnesspro-only
```

本轮实际 MOON_HOME 为相邻 URI Template 项目的 `.toolchain`；版本为 moon 0.1.20261012 / moonc 0.10.15+943464bfa。`tools/moon` 也支持 PATH 中已有 moon。精确命令数组、版本、状态和源摘要在 `reports/verification.json`；原始命令输出在本地 `reports/logs/`，其内容不作为便携运行依赖。

没有既有工具链时，支持 macOS arm64/Linux x86_64 的 `python3 -B tools/bootstrap.py` 会下载 `toolchain.lock.json` 锁定的官方编译器及 core 归档，检查 SHA-256 后安装到本项目 `.toolchain`；使用有限 curl 重试和 TLS 校验，不覆盖已有未标记的非空工具链。然后运行 `MOON_HOME="$PWD/.toolchain" node tools/verify.mjs`。本轮使用既有工具链，bootstrap 下载流程在参考发布提交的 Linux CI 中运行；新增本地 bootstrap 回归使用合成缓存归档，不冒充新机器下载。

## 已通过、失败与未测

| 检查 | 本轮实际结果 |
|---|---|
| MoonBit fmt/check/build | 通过 |
| MoonBit 单元测试 | JS、native、wasm-gc 各 24/24；每后端各执行 check/build/test |
| 公共 API、真实进程、OpenCode 协议、HTTP、交付回归 | 72/72；包括格式歧义、坏编码、进程/存储异常、请求过期、打包篡改及中断 |
| 账本测试 | 14/14；示例为明确合成数据 |
| 独立评测 | 6 份夹具，60 项 primary/同预算对照；26/26 对抗检查、2/2 格式回退检查 |
| 独立候选删除审计 | 768/768；不使用产品 evidence/metrics 作为 oracle |
| 浏览器 | 实际桌面及 390px 移动布局、延迟响应竞态、回查、修复、预算/格式/截断回退与异常恢复；见 `reports/demo-optimization.json` |
| 干净目录解包 | 见 `reports/clean-directory.json` 与外部 `reports/package-verification.json` |
| 未解决的已知测试失败 | 以本轮统一验收最终状态为准；开发中发现的问题及修复见优化报告 |
| 本优化版未测 | 真实模型 token/账单/净省钱、在线任务成功率、完整 OpenCode 运行、远程 CI、Linux/Windows 实机、正式包发布/参赛 |

TAP 中段失败夹具：17/17 个独立证据项保留，stdout 为 10,335 → 1,725 UTF-16 单元。rg 长命中：14/14，6,740 → 5,698；预算 4,000 时回退为完整 6,740。以上是限定夹具的字符计量，不是模型 token 或费用。

实际 HarnessPro 默认首屏在上述两例保留 10/17、7/14，其缓存回查恢复原文已验证。RTK OSS 1.0.1 在六份 stdin 上完整透传；真实 rg 包装保持退出码 0/1/2 和 stderr。Headroom、两个 Mooncakes 近邻只做固定源码研究。没有把替代品未支持的接口当作失败，也没有宣称全面领先。

## 便携包

文件：`release/contextguard-0.1.1.zip`；校验和：`release/contextguard-0.1.1.zip.sha256`。原 0.1.0 包保持不变，历史报告位于 `reports/history/0.1.0/`。

ZIP 包含源码、生成的 JS、完整夹具、必要许可证、中文文档、独立结果与包内 `CHECKSUMS.sha256`。不含平台专用 RTK 二进制、工具链、下载缓存、Git 数据、密钥、用户配置或 `node_modules`。RTK 缺失时显式标注 unavailable/unrun，HarnessPro 对照仍可离线重跑。包内历史 RTK 报告是本轮原机器的已运行证据，不会被伪装成新机器执行结果。

运行 `tools/package.py` 会读取一次完整分发文件快照，核对 v2 已通过验收的输入清单及编译产物，在全新目录核对哈希并运行 portable 验收，最终 ZIP 仍只使用该冻结快照。失败保留旧归档，成功后清理临时目录。实际最终 ZIP SHA-256、大小和文件数在外部 `reports/package-verification.json`，避免把归档自身哈希递归写进归档。

独立仓库 [cjyhjy/moonbit-contextguard](https://github.com/cjyhjy/moonbit-contextguard) 已由总控发布；提交 `18d5fcc` 的 [Linux CI](https://github.com/cjyhjy/moonbit-contextguard/actions/runs/39812762490) 已通过，历史核验摘要见 `reports/publication-reference.json`。0.1.1 优化于 2026-10-30 按授权同步，不能复用旧提交的 CI 成功结论。最终申报书、本人声明、Mooncakes 发布和赛事提交另行记录。
