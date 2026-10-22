# 固定版本同行研究与离线重放

核查日期：2026-10-22。GitHub 和 Mooncakes 均读取当前主来源后再固定版本；版本与下载 SHA256 见 [peers-lock.json](peers-lock.json)，保存的原始源码、Git blob SHA1 与永久链接见 [source-index.json](source-index.json)。已下载 ZIP 的 SHA256 固定包内容，不声称 Mooncakes 包与某个 GitHub commit 完全相同。

## 已运行与未运行

- **HarnessPro：已运行。** 执行未改动的 Terminal-Bench 2 Lite `PostToolUse` 钩子，使用公开默认 `max_chars=4000 / head_chars=2400 / tail_chars=900`。原始钩子文件的 Git blob 在每次运行前校验。这里只运行工具结果处理阶段；没有运行任务分类器、PreToolUse 的 RTK 重写、Codex/Claude 完整代理或任何模型。
- **RTK：已运行。** 官方 `v1.0.1` OSS 版 macOS arm64 二进制执行 `pipe` 自动检测；另运行 `rtk rg --json` 对照原生 `rg --json`。default branch `develop` 的源码核查是另一个版本，不能将它的 SHA 标成已执行二进制版本。
- **Headroom、两个 Mooncakes 包：未运行。** 已核对固定源码/包。Headroom 当前 log/search Python API 强制使用 Rust `_core`；本项目未安装其整套依赖，因此不提供其压缩率、速度或成功率。

## 可复现命令

在项目根目录，Python 3.9+、macOS 或 Linux 可执行 mandatory HarnessPro 对照；上游钩子使用 `fcntl`，不声称支持原生 Windows Python：

```sh
python3 research/run_peer.py --json < fixtures/raw/node-tap-middle-failure.stdout.txt
python3 research/replay_peers.py --harnesspro-only
```

`run_peer.py` 是与夹具无关的 stdin → stdout 包装器；不加 `--json` 时只返回上游候选文本。`--json` 包含 `output`、固定 SHA、UTF-8 字节/Unicode codepoint 数、原文恢复核验、存储路径和含 Python 子进程的耗时。`--max-chars / --head-chars / --tail-chars` 可明确修改阈值，结果将标记 `custom-limits`。默认保留原文于 `research/runs/harnesspro/`；`--run-dir` 只允许项目内部目录。

可选 RTK 二进制不属于可移植核心。macOS arm64 上显式下载固定 OSS release，再离线运行：

```sh
python3 research/fetch_rtk.py
python3 research/run_rtk.py --json < fixtures/raw/rg-json-multiple-unicode-long.stdout.txt
python3 research/replay_peers.py
python3 research/check_rtk_rg.py
```

`fetch_rtk.py` 仅在显式执行时联网，验证 archive 与可执行文件 SHA256 后写入项目内 `vendor/`；不会安装全局钩子。RTK 缺失或平台不符时，`run_rtk.py --json` 返回 `available:false, status:unrun`，`replay_peers.py` 只写 availability 记录，并保留已有历史报告；不会生成伪造对照。下载脚本网络失败不影响核心或 HarnessPro 离线验收。

| 固定对象 | SHA256 |
|---|---|
| `rtk-oss-aarch64-apple-darwin.tar.gz` | `4a4d9d09656ff29423336aa506e680afc3f7b6dafe84f0194a1c9a523a3c80e1` |
| archive 内 `rtk` 可执行文件 | `897581cccf1d2b2d0886063133eadcf4377d71354c1ed4b8b3b7691f3e7633d2` |

## 输出与证据边界

`reports/peers-harnesspro.json`、`reports/peers-rtk.json` 记录冻结夹具 manifest 的哈希；逐案 stdout、完整钩子回包和 HarnessPro raw store 保存在 `reports/peers/`。重放比较使用同一份捕获 stdout。fixture 的必要证据清单来自外部注释器，peer runner 不借用 ContextGuard 的判定。

`reports/peers-rtk-native-rg.json` 是另一个实际 CLI 检查：重新运行真实 `rg` 与 `rtk rg`，保存两份原始 stdout/stderr，删除 JSON 的 `elapsed`/`elapsed_total` 后比较事件多重集，以隔离时间和文件遍历顺序差异。其他字段不删除，退出码和 stderr 单独比较。这些新输出不伪装成冻结重放输入。

stdout 管道没有原始命令退出码信息。原始 `process.exit_code/scope/truncated` 由调用方/fixture 持有；RTK pipe 的退出码不等于原命令退出码。stderr 独立保存，不计入 stdout 保留率。字符、UTF-16 单位、UTF-8 字节、token、价格与任务成功率是不同量；只有前三项按报告实测，其余未测。同行耗时包含启动进程，不能与热身后的 MoonBit 函数绝对速度排名。

## 许可证和来源

`vendor/harnesspro/hook.py`、`policy.json` 保持原始字节；附上 HarnessPro MIT、RHO MIT 和上游第三方说明。`research/sources/` 中 RTK CLI 源码与 Headroom 源码保留各自 Apache-2.0；Headroom `NOTICE` 一并保存。RTK 当前完整 engine/proxy 为 BUSL-1.1，本文仅执行 OSS release，不把完整 RTK 称为单一 Apache 项目。

Mooncakes `posoco/ext-llm@0.2.0` 的 manifest/registry 声明 Apache-2.0，但下载包无独立 LICENSE；此处明确记录该缺口，不改写作者的许可证声明。`Across2005/harness-self-evolution@0.3.8` 自带 MIT LICENSE。下载包和源文件仅用于查重/证据，未合入 ContextGuard MoonBit 核心。具体能力和范围见 [比较说明](../docs/COMPARISON.md)。
