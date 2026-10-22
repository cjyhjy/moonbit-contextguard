# 本轮开发记录

日期：2026-10-22。所有步骤在 ContextGuard 所属目录完成，没有修改共享 Git 索引/分支或相邻项目；以下是本地开发记录，不是公开 commit 历史。

1. 检查任务简报与空目标目录，读取相邻项目既有工具链版本；保留原项目。固定主要近邻来源，启动三个 Astra ultra 并行任务。
2. 实现 MoonBit 严格原文 profile、连续证据单元、独立候选正文验证、缺失修复和原文回退。选择 Node 平面 TAP 与 rg JSONL，未知格式不冒险解析。
3. 采集合成源程序产生的真实进程 stdout/stderr；建立不依赖产品元数据的必需证据清单。实现同一输入的 original/head-tail/HarnessPro/RTK/ContextGuard 对照。
4. 实现 JSON CLI、shell:false 真实进程包装器、双流独立保存、SHA-256 回查。测试暴露并修复 Node 启动失败负返回值映射；测试环境的 NODE_TEST_CONTEXT 在测试子进程环境中明确清除，不改变用户环境。
5. 扩展 rg 逐文件计数与二进制输出检查，保证不省略二进制截断标记；添加逐行删除、插入、重排、关联交换及预算断言。MoonBit JS/native/wasm-gc 后端验证。
6. 实现固定 OpenCode v1.2.0 可选 hook、真实核心驱动的本地演示、离线成对账本与边界文档。在线模型评测保持未测。
7. 最终检查、构建来源校验、干净目录解包和 ZIP 校验以 `reports/verification.json`、`reports/package-verification.json` 为准。中间失败不计作最终通过；最终报告记录实际命令和状态。

CI 工作流是准备好的文件，尚未推送或远程执行。`hustcer/setup-moonbit` 参数根据其 [上游说明](https://github.com/hustcer/setup-moonbit) 配置；Actions 平台、Linux 工具链下载和远程运行尚未实测，不能将本地成功写成远程绿色 CI。
