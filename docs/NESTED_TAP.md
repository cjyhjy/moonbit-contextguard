# Node 嵌套 TAP

0.2.0 在原平面 profile 上增加 Node `describe/it` 套件与 `t.test()` 子测试。协议来自实际 Node 26.7.0 reporter 输出；参考 [Node 26.7.0 测试文档](https://nodejs.org/download/release/v26.7.0/docs/api/test.html)。这不是通用 TAP/YAML 解析器。

## 可复验行为

```sh
node tools/run.mjs --format node-tap --text -- node --test --test-reporter=tap fixtures/nested-tap/sources/suites.cjs
node --test tests/nested-tap.test.mjs
node evaluation/evaluate-nested-tap.mjs
```

第一条命令的失败是预期结果，退出码 1。子失败与父套件名称、各层编号和诊断保留在一个完整顶层分支中。仅含普通通过测试的顶层分支可以省略。删除部分子诊断时重新从原文恢复整个必要分支，篡改状态、重排或预算不足时返回原文。

每级子测试必须按顺序编号，并有匹配的子计划。全局 tests 统计包括普通父测试，suites 单独计数；skip/todo 套件不被误计成叶测试。重复 duration/type、父级成功而子测试失败、错误缩进或计数均不获认证。根层以下最多 32 层。取消、额外日志、bailout 与其他语法继续回退。

## 语料和测量

`fixtures/nested-tap/manifest.json` 记录七份来源、命令、源码与双流哈希、独立必要证据行区间。六份是明确受控的合成测试程序；`project-regression` 是本项目 `tests/core.test.mjs` 与 `tests/core-optimization.test.mjs` 的实际测试运行。它们均不是生产任务或模型会话记录。

```sh
node evaluation/capture-nested-tap.mjs
```

上述命令会有意重新采集输出，时间、堆栈与哈希可能变化，随后应重跑统一验收。采集在所有子进程成功且符合预期退出码后才写入新输出，避免普通子进程失败时覆盖已有语料。

旧版本对照可从真实提交提取编译产物：

```sh
git show fc061bd:dist/contextguard.mjs > /tmp/contextguard-0.1.2.mjs
node evaluation/evaluate-nested-tap.mjs --baseline /tmp/contextguard-0.1.2.mjs
```

`reports/nested-tap-before-after.json` 保存这一实际对照；日常 CI 生成 `reports/nested-tap-evaluation.json`。七份语料各做 128 次固定种子的候选删除，共 896 次，测试依据原始标注检查连续必要证据与原文行顺序，不读取核心 evidence/metrics 充当 oracle。

输出长度是 stdout 的 UTF-16 单元，计量不含集成说明、stderr、缓存和回查，不代表 token/费用收益。同进程 5 次预热后 31 次中位耗时只用于本地观察，不作为端到端或跨机器速度保证。
