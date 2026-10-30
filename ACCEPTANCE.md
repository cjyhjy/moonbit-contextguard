# 比赛验收对照

依据用户于 2026-10-30 提供的九条要求，记录技术交付证据；最终审核由主办方决定。[公开仓库](https://github.com/cjyhjy/moonbit-contextguard)。

| 要求 | 实现与复验入口 |
|---|---|
| 1. MoonBit 为主，moonc ≥ 0.10.16 | `src/*.mbt` 实现解析、证据提取、候选验证、压缩、修复和预算判断；根包导出纯 MoonBit API。固定 0.10.18；`node tools/check-toolchain.mjs` 强制检查。Node 承担文件、进程、HTTP 胶水。 |
| 2. GitHub 公开、提交清晰 | 保留实际逐步实现历史，未 squash/伪造提交；见 `docs/HISTORY.md`。最新提交与 CI 以 `reports/publication-0.1.2.json` 为准。 |
| 3. 源码清晰、核心功能可用 | `src/tap.mbt`、`rg.mbt` 解析，`validator.mbt` 验证，`compressor.mbt` 提取，`request.mbt` 编排；`docs/ARCHITECTURE.md` 说明边界。 |
| 4. README 可复现 | `README.md` 覆盖目标、环境安装、Node 工具、源码验证；`README.mbt.md` 覆盖 Mooncakes 安装和库调用。 |
| 5. CI 检查、构建、测试 | `.github/workflows/ci.yml` 对 push/PR/手动运行；执行 fmt 与三个后端的 check/build/test、打包消费、便携包验证，保留 artifact。 |
| 6. 可运行示例 | `sh tools/moon run cmd/example --target js`；另有 `node tools/example.mjs`、进程包装器和网页。 |
| 7. 核心路径测试 | 核心 24 项 + 公共 API 6 项，在三个后端运行；Node 集成回归、账本 14 项、独立反例评测、768 项变异审计。包消费检查用真实 ZIP 的公开 API 跑六项测试。 |
| 8. Mooncakes 发布 | `cjyhjy/contextguard@0.1.2`。离线包验收见 `reports/registry-package.json`；实际发布与重新下载验收见 `reports/publication-0.1.2.json`。离线通过不等于已发布。 |
| 9. OSI 许可证与第三方合规 | 项目 MIT (`LICENSE`)；`THIRD_PARTY_NOTICES.md` 区分本项目与上游。注册表包不包含第三方对照实现；完整仓库保留其许可证、NOTICE 和固定来源。 |

## 评审复验

```sh
python3 -B tools/bootstrap.py
export MOON_HOME="$PWD/.toolchain"
node tools/verify.mjs
python3 -B tools/package.py
```

结果写入 `reports/verification.json`、`reports/registry-package.json` 和 `reports/package-verification.json`。CI 必须按提交 SHA 核对；浏览器及 RTK 历史证据不表示每次 CI 都重新做过这些检查。

## 后续优化方向

优先增加真实项目输出语料与格式兼容测试，如嵌套 TAP、编译诊断；每种新格式先定义证据单元和回退条件。其次验证更新版本的 Agent 适配协议。在线模型 token/成本/任务成功率需要独立成对实验，目前不作为已完成能力。无需为这九条要求新增表格提交或无关的大型功能。
