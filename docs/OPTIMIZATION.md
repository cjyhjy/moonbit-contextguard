# ContextGuard 0.1.1 优化记录

日期：2026-10-22。本轮从原有 0.1.0 交付出发检查实际行为并修复，原包与关键历史报告保留；没有扩大为任意格式的语义压缩器。

## 实际问题与修复

| 问题 | 原行为及复现 | 0.1.1 行为 |
|---|---|---|
| rg 错误字段、重复键与错误区间 | 7 类变异在旧版被接受并压缩，见核心报告 | 未知字段/重复键、缺失 binary_offset、越界或正文不一致、位置倒退均返回完整原文 |
| UTF-8、base64 和文件边界 | 文本标签可能含糊，零正文文件的唯一路径可被省略 | 精确解码字节并核对匹配；无正文文件的 begin/end 成为必要证据 |
| 超多空行/候选 | 先拆分大量行，再做行数检查 | 原文和候选在分配行数组前限制为 50,000 行；CLI 流式限量并拒绝坏 UTF-8 |
| 无效进程预算 | `maxOutputChars=-1` 仍启动真实子进程 | 预算与参数在任何采集目录创建和启动前拒绝 |
| 采集后证据目录丢失 | API 抛出 ENOENT，调用者拿不到已采集的结果 | 返回 stdout/stderr，标注证据不可用，runner 返回 125，实际子进程状态保留 |
| 脱离进程组的后代持有管道 | 实际 250ms 超时等到约 1,569ms 才返回；无限后代可永久阻塞 | 超时终止原进程组并关闭本地读取；500ms 截止回归约 503ms 返回，直接父进程状态仍为 0 |
| 短输出被说明放大 | 无结果 rg 样本原为 263，旧版交付 962 UTF-16 单元 | 实际交付仍为原文 263；只有完整可见结果严格更短才替换 |
| 页面异步结果串用 | 编辑输入后，较慢旧请求可能覆盖当前状态 | 结果、比较、复制与原文回查绑定输入快照；过期响应不能提交 |
| 旧验收被误复用 | 新增文件或验收中断可能漏过原检查 | 完整文件清单、原子 running 状态、前后输入与产物核对 |
| 打包与验收不是同一份字节 | 活动工作区变化可能进入最终归档 | 一次读取冻结快照，解包验收后只发布同一快照；失败不替换旧包 |

这些问题的证据强度分别标注在报告中：7 个核心问题及四个运行层问题有修复前实际复现；零正文路径丢失来自代码检查并由新版回归覆盖；交付测试使用隔离的合成小项目，不冒充实际编译器测试。超时修复不能保证杀死自行脱离进程组的后代，只保证不继续等待其输出管道。

## 保持的行为与测量边界

6 份原有真实 stdout/stderr 夹具结果保持一致。中段失败 TAP 的核心输出仍为 10,335 → 1,725 UTF-16 单元，17/17 独立证据项保留；rg 长命中仍为 6,740 → 5,698，14/14 保留。4,000 预算放不下 rg 必需证据时完整回退。

适配器真实重放的 TAP 样本连同本地证据路径说明为 2,464 单元，净减少 7,871；此数受实际路径长度影响。进程包装器 `delivery_metrics` 计入 stdout、stderr 和说明，负收益如实显示。以上均为字符度量，不是模型 token、API 费用、任务成功率或端到端性能结论。

原文仍是信任边界：本工具检查限定格式及证据单元，不能证明搜索完备、工具诚实或测试断言正确。新增严格校验可能使非标准扩展格式回退；原文保留是预期行为。

## 回归与证据入口

```sh
node --test tests/*.test.mjs
node evaluation/evaluate.mjs
node evaluation/audit.mjs
MOON_HOME=/path/to/existing/moonbit-toolchain node tools/verify.mjs
python3 -B tools/package.py
```

- `reports/core-optimization-review.json`：7 个前后复现、6 样本相容性、MoonBit 三目标及公共入口。
- `reports/runtime-optimization-before.json`、`runtime-optimization-review.json`：实际子进程和适配器前后行为。
- `reports/demo-optimization.json`、`demo-optimization-browser-receipt.json`：真实浏览器竞态、异常恢复与布局检查；截图同目录。
- `reports/delivery-optimization-review.json`：验收与冻结包的隔离破坏性回归。
- `reports/verification.json`：本版本统一验收；`reports/package-verification.json`：新目录解包与最终归档哈希。
- `reports/history/0.1.0/` 与 `release/contextguard-0.1.0.zip`：保留的历史基线。

## 发布修复同步

只读参考独立仓库提交 `18d5fcc7ac060eb320fdfb4e4dc4dfb8ba065b6d`，移植官方固定版本编译器/core 归档、SHA-256 校验、有限 curl 重试与 CI 配置；TLS 校验保留，工具链只写项目内部。保留本轮 v2 验收和冻结打包机制，补齐 JS/native/wasm-gc 各 check/build/test。

该旧提交的 [Linux CI](https://github.com/cjyhjy/moonbit-contextguard/actions/runs/39812762490) 已通过，优化开发时已只读复核；0.1.1 原始通过证据来自本机 macOS 与干净目录，保存于 `reports/history/0.1.1-local/`。2026-10-30 用户授权同步优化至独立仓库，本次远程 CI 按对应提交另行核验。包注册表与正式参赛提交仍分别记录。

## 0.1.2：比赛验收与包可用性（2026-10-30）

- 从 0.10.15 升级到固定 0.10.18，增加最低版本及精确版本门禁。
- 模块名改为 `cjyhjy/contextguard`，根包导出 `guard_request`；Node JSON API 保持不变。
- 新增 6 个纯 MoonBit 公共 API 黑盒测试和 `cmd/example`，覆盖压缩、接受、修复、篡改/预算回退、未知格式与非法 JSON。
- Mooncakes 使用白名单发布源码、测试、最小示例和许可。验收从实际 ZIP 解压，在独立消费者中通过三个后端的公共 API 测试与示例。
- 更新可复现安装与逐条验收表，区分历史证据和新提交验证。

## 0.2.0：嵌套 Node TAP 与项目语料

0.1.2 对真实 `describe/it` 与 `t.test()` 输出整段回退，固定旧编译产物的实际对照见 `reports/nested-tap-before-after.json`。新解析器逐层核对编号、计划和类型统计；含必要证据的顶层分支整体保留。源深度上限 32，父级状态矛盾、取消、自定义日志和未知语法仍回退。

新增六份控制程序和一次项目回归命令的真实 stdout/stderr，来源、哈希与独立证据标注见 `fixtures/nested-tap/manifest.json`。896 次候选删行审计以原始标注为 oracle，不依赖核心返回的 evidence/metrics。复现命令、范围和字符测量见 `docs/NESTED_TAP.md`。
