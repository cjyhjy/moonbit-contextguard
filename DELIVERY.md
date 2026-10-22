# ContextGuard 0.1.0 本地交付

验收日期：2026-10-22（America/New_York）。状态：本地功能实现、统一验收和便携包干净目录验收均已通过。未公开推送、发布包、修改用户 Agent 全局配置或正式参赛提交。

## 交付内容

- MoonBit 核心：`src/tap.mbt`、`rg.mbt`、`validator.mbt`、`compressor.mbt`、`request.mbt`。Node 平面 TAP 与 rg JSONL 的原文解析、独立候选正文核验、补回和回退均在 MoonBit 中完成。
- JSON CLI 与可直接运行的 `dist/contextguard.mjs`；真实 argv 进程包装器 `tools/run.mjs`；双流、范围、状态、截断标记和 SHA-256 原文回查。
- 固定 OpenCode v1.2.0 的可选 hook；仅离线协议验证，未安装至当前 Agent 或启动完整模型会话。
- 本地演示、6 份真实输出夹具、固定 HarnessPro/RTK 实际对照、独立评测与完整分类账本工具。
- 中文范围/API/使用文档、上游来源/许可、AI 协作记录、CI 配置。项目执行聊天未操作共享 Git；总控已按用户授权记录真实阶段的本地提交。尚未公开推送或运行远程 CI。

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

失败测试示例故意返回 1；包装器保留该状态。搜索命令额外需要 rg。演示地址为 **http://127.0.0.1:4187/**；`CONTEXTGUARD_DEMO_PORT` 可调整端口。实际 HTML 页面调用 MoonBit 核心，截图见 `reports/demo-desktop.png`、`demo-mobile.png`。

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

## 已通过、失败与未测

| 检查 | 本轮实际结果 |
|---|---|
| MoonBit fmt/check/build | 通过 |
| MoonBit 单元测试 | JS、native、wasm-gc 各 15/15 |
| 公共 API、真实进程、OpenCode 协议、HTTP | 35/35；包括故意失败/超时/信号/二进制/篡改等负向路径 |
| 账本测试 | 14/14；示例为明确合成数据 |
| 独立评测 | 6 份夹具，60 项 primary/同预算对照；26/26 对抗检查、2/2 格式回退检查 |
| 独立候选删除审计 | 768/768；不使用产品 evidence/metrics 作为 oracle |
| 浏览器 | 实际桌面及 390px 移动布局、回查、修复、预算/格式/截断回退检查通过 |
| 干净目录解包 | 见 `reports/clean-directory.json` 与外部 `reports/package-verification.json` |
| 未解决的已知测试失败 | 当前统一验收无失败；开发中两个实际缺陷已修复，见 audit 报告 |
| 未测 | 真实模型 token/账单/净省钱、在线任务成功率、完整 OpenCode 运行、远程 CI、Linux/Windows 实机、正式发布/参赛 |

TAP 中段失败夹具：17/17 个独立证据项保留，stdout 为 10,335 → 1,725 UTF-16 单元。rg 长命中：14/14，6,740 → 5,698；预算 4,000 时回退为完整 6,740。以上是限定夹具的字符计量，不是模型 token 或费用。

实际 HarnessPro 默认首屏在上述两例保留 10/17、7/14，其缓存回查恢复原文已验证。RTK OSS 1.0.1 在六份 stdin 上完整透传；真实 rg 包装保持退出码 0/1/2 和 stderr。Headroom、两个 Mooncakes 近邻只做固定源码研究。没有把替代品未支持的接口当作失败，也没有宣称全面领先。

## 便携包

文件：`release/contextguard-0.1.0.zip`；校验和：`release/contextguard-0.1.0.zip.sha256`。

ZIP 包含源码、生成的 JS、完整夹具、必要许可证、中文文档、独立结果与包内 `CHECKSUMS.sha256`。不含平台专用 RTK 二进制、工具链、下载缓存、Git 数据、密钥、用户配置或 `node_modules`。RTK 缺失时显式标注 unavailable/unrun，HarnessPro 对照仍可离线重跑。包内历史 RTK 报告是本轮原机器的已运行证据，不会被伪装成新机器执行结果。

运行 `tools/package.py` 会重新检查已通过的源摘要，创建新 ZIP，在全新目录核对每个文件哈希并运行 portable 验收，再清理临时目录。实际最终 ZIP SHA-256、大小和文件数在外部 `reports/package-verification.json`，避免把归档自身哈希递归写进归档。

最终申报书、本人声明、公开仓库/有效提交、远程 CI 和 Mooncakes 发布仍是单独事项。本包是本地技术交付，不等于赛事资格获批或正式提交成功。
