# 独立仓库历史与证据边界

源码仓库：[cjyhjy/moonbit-contextguard](https://github.com/cjyhjy/moonbit-contextguard)。默认分支为 `main`。CI 配置为 `.github/workflows/ci.yml`，最新结果请按提交 SHA 查阅 [Actions](https://github.com/cjyhjy/moonbit-contextguard/actions/workflows/ci.yml)，并下载该 run 的 `contextguard-verification-<SHA>` artifact。

## 真实开发历史

独立仓库从组合工作区的 `projects/contextguard` 子目录使用 `git subtree split` 提取，没有 squash、修改提交说明/作者时间或制造占位提交。原提交与提取提交的 SHA 不同是路径变为仓库根目录、父链发生变化的结果。九条提取提交的元数据与每次目录 tree 均已核对；独立发布修复追加在这九条历史之后。

| 原组合提交 | 独立提取提交 | 对应目录 tree |
|---|---|---|
| `86d71cedbe967f21f8e155b04155acc5beff8d61` | `14e62074cda12837d104e2bdd2ce1c44c08c31f6` | `6a0815485130d7ed75b205661355cde6f002c738` |
| `40b3247e6d01adb6fff70ac452ab292bdae43271` | `54080133267c49fc99a93f451b2f4018f4dced12` | `63223f6ed9c8f8492f87b4e6148a0c52b46cd450` |
| `55f0fc7a8d992afd7852166c577c8bf2bccec698` | `59d4b802f9eecec81a706fa83bf1fa7e0721a8b5` | `905a8edda4d75b4335d93a46736aed957822f6f9` |
| `6612aaa9e31d2ddf980147402133e5f7352227eb` | `a4393e67b0c503738b2d95c39e391958a0b421e0` | `ffc4b96aac1e3fcde0e6a02ff7a00a71282d742b` |
| `b19c1cf0e2f77206c6c0a910199e1d39d1302141` | `26a8632852997cb0f1a7ff8efd85799e2fde7dff` | `315f8db6698fd7bfc7ffd09a853d4397d34ac0be` |
| `0d1f8647292e90b1609a878ad0d914c792f979db` | `3946d80f1068cc95656eefe557fdf5669b16cb02` | `626bb7d6d98b963aa7185ee04980088c2c7d2aad` |
| `d098c231025210379b1aade67926f35f95ca1a10` | `5c935fae03569bbf6d6d08ed355e69ba6190b303` | `97e8e648619965b9c71ad075480abed2ea5c34bf` |
| `7251284551403b48d82751a7026dad2bc76614a2` | `f1a97e57fa12033ab014c333a79a558368cfdc16` | `2d7a66e74dedec6487b369e6f876adff347c6eb2` |
| `d36c55fe248fbd4eb65f5ee9c2682a91b852831d` | `981cb3b877e9b65e37d10c74a13a9c5a5ddb57b1` | `859ed88c3135c989fb570c2bfb3e23503d043ec0` |

## CI 与历史报告

- 仓库中已有 `reports/verification.json`、评测、浏览器和 RTK 报告保留原本地执行环境、日期与结果。它们是历史证据。
- 新 CI 使用 Ubuntu 24.04、Node 26.7.0 和锁定的 MoonBit 官方归档。编译器及 core 均在解压前验证 SHA-256；安装仅写本仓库。
- CI 实际执行三个受支持后端的 check/build/test、完整公共 API/真实进程/适配器/HTTP 测试、账本测试、独立评测和 768 项变异审计；再构建独立项目便携 ZIP，在新解包目录核对哈希并重跑 portable 验收。
- CI artifact 中的新 `verification.json` 及 `package-verification.json` 标注执行环境、提交和 run ID。Actions 成功只证明这组离线技术验收，不证明人工审核、线上模型效果或赛事提交。
- 仓库不分发 RTK 平台二进制。Linux 或缺少该二进制时，评测明确将 RTK 记为 `unrun`，仍实际执行固定 HarnessPro hook。保留的 macOS RTK 历史结果不代表新机器运行过它。

## 发布范围

只公开源码、真实提交历史与技术证据；不发布 Mooncakes/npm 包或网站，不填写参赛表单，不改变用户 Agent 配置，不调用付费模型。合成工作负载、真实子进程输出、离线协议测试与在线模型 token/费用/成功率保持区分。

发布前检查了九条历史中的 194 个可达 blob：未发现所检查的常见私钥、GitHub/API 密钥形态或敏感配置文件名。历史审计日志、RTK 数据库和上游示例含本地路径；它们不属于凭据，按保留真实历史的要求未重写提交。该模式扫描不是对任意秘密的完备证明。新忽略规则排除凭据文件、原文采集目录、工具链、下载缓存与 RTK 二进制；旧有受版本控制的历史报告继续保留。
