# 来源与第三方许可

ContextGuard 新写的源码、测试、文档和合成夹具使用根目录 MIT LICENSE。以下对象不因被包含或研究而改变其原许可；未声称对它们拥有原创权。

| 对象 | 用途与许可 | 随包证据 |
|---|---|---|
| MoonBit core | JSON/String/Array 等标准库随 `dist/contextguard.mjs` 编译进入产物；Apache-2.0 与上游 NOTICE 中的归属 | `vendor/moonbit-core/LICENSE`、`NOTICE`；工具版本见 `toolchain.lock.json` |
| HarnessPro / RHO hook | 未修改的固定 TB2 Lite hook 用于真实外部对照；MIT、RHO MIT | `vendor/harnesspro/` 的 LICENSE、RHO-MIT、上游 THIRD-PARTY-NOTICES；SHA 见 `research/peers-lock.json` |
| RTK OSS v1.0.1 | 实际对照用 macOS arm64 可执行文件，Apache-2.0；**可执行文件不放入便携 ZIP** | `vendor/rtk-oss-v1.0.1-darwin-arm64/LICENSE`；显式可选下载脚本、固定 archive/binary 哈希。当前完整 RTK engine/proxy 的 BUSL-1.1 不冒称为 Apache |
| Headroom | 固定原始源码用于只读功能比较；Apache-2.0 + NOTICE | `research/sources/` 与 `source-index.json`，未合并其算法或安装依赖 |
| OpenCode v1.2.0 | 固定上游协议类型与调用片段用于可选适配的离线验收；MIT | `adapters/vendor/` 和适配文档中的 commit/blob 校验（详见实际目录） |
| posoco/ext-llm 0.2.0 | Mooncakes manifest/源码查重；包声明 Apache-2.0，下载包未附独立 LICENSE，此缺口已记录 | `research/peers-lock.json`、`source-index.json`；不合入核心 |
| Across2005/harness-self-evolution 0.3.8 | Mooncakes/GitHub 固定源码查重；MIT | `research/sources/` 及上游 LICENSE；不合入核心 |

所有远端固定源文件的永久链接、Git blob 或归档哈希以 `research/source-index.json`、`research/peers-lock.json` 与 `adapters/` 锁定记录为准。仓库名、公开宣传数字及旧对话快照均不视为本项目实测结果。

Node.js、Python、ripgrep、MoonBit 工具链为外部执行依赖，未随便携包分发。没有复制相邻项目的 URI Template 业务实现，没有下载/保存用户密钥。编译产物 SHA-256 与 MoonBit 源码摘要见 `dist/build-manifest.json`。

## Mooncakes 分发范围

以上清单描述完整 GitHub 仓库与 Node 便携包。Mooncakes 0.1.2 仅分发本项目 MoonBit 源码、测试、示例、README 与许可，不包含 `dist`、`vendor`、`research` 或第三方对照实现；标准库由消费者的 MoonBit 工具链提供。
