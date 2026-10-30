# API 契约（schema_version 1）

MoonBit 库入口：`@guard.guard_request(request_json : String) -> String`，包路径 `cjyhjy/contextguard`。JS 胶水入口：`import { guard, guardJson } from './tools/api.mjs'`，同步返回对象；前者接受对象，后者接受原始 JSON 字符串。CLI 从 stdin 或一个文件流式读取单个 JSON 请求，严格解码 UTF-8 并在传输预算耗尽时停止读取，stdout 输出单个 JSON 响应；非法 JSON/UTF-8/传输上限错误以退出码 2 写 stderr。原始 JSON 中同一对象的重复键（包括转义后同名）拒绝为 `invalid_json_request`；调用 `guard(object)` 前已经被宿主解析丢失的信息无法恢复。

```json
{
  "format": "node-tap",
  "raw": "TAP version 13\n...",
  "process": {
    "exit_code": 1,
    "scope": ["node --test --test-reporter=tap test.cjs"],
    "truncated": false
  },
  "max_output_chars": 4000,
  "max_input_chars": 1048576
}
```

`candidate` 可选，为外部压缩器给出的**正文字符串**。省略或 null 使用内置提取器。额外的候选 `facts`、`preserved_fact_ids` 等字段不会影响验证。候选不得替换可信进程元数据。

| 字段 | 约束 |
|---|---|
| format | `node-tap` 或 `rg-json`；其他值回退 |
| raw | 必须为字符串；保留原始换行和原文，不自动规范化 |
| process.exit_code | int32 整数；TAP 0/1、rg 0/1 成功完整流与实际结果相符；其他值保留原文 |
| process.scope | 至少一个非空字符串，由真实调用者提供命令/参数/路径上下文 |
| process.truncated | 明确 false 才能验证；true 回退，不能从正文猜测完整性 |
| max_input_chars | 默认 1,048,576，最大 4,194,304，正整数 |
| max_output_chars | 默认 16,000，范围 0–4,194,304 |

长度以 **UTF-16 code units** 计，与 JS `string.length` 一致；不是 token 数。原文与候选各有 50,000 行上限，分配行数组前检查；JSON 嵌套限制 64 层。最外层 JSON 请求硬限 8,388,608 个 UTF-16 单元；无法安全解析时返回 `error`，JS API 抛出异常，不能宣称已回退或 verified。真实进程包装器捕获该错误，另外明确返回 `core_transport_error` 并保存采集原文。

`max_output_chars` 是期望预算，不是强制截断：证据不能放下时返回可能更长的原文。原始截断时只保留**已收到的原文**，不补造丢失部分。

## 响应

| 字段 | 含义 |
|---|---|
| decision | `compressed` 内置选择通过；`accepted` 外部候选通过；`repaired` 缺失/不完整单元被完整重建；`fallback` 返回原文 |
| reason | 机器可读原因，如 `candidate_changed_or_reordered_source`、`required_evidence_exceeds_budget`、`source_truncated` |
| output | 交付正文；回退时等于 raw |
| process | 原封不动返回调用者提供的元数据；不认证调用者是否诚实 |
| output_kind | `original` 或 `evidence_projection`；后者是证据摘录，不是完整原格式 |
| assurance | 仅为 `required_source_units_verified` 或 `original_passthrough`，不承诺任意语义正确 |
| evidence | 必需单元的 id、kind、1 基含首尾的行范围、原文 text；不含被省略的普通通过测试 |
| metrics | input_chars、output_chars、required_facts、missing_facts、char_unit；facts 计数是**单元数**，不是独立评测标注字段数 |

`missing_facts` 描述修复前候选缺失的单元数；有部分单元或未对齐内容时是保守诊断值，不是语义错误数量。原文无法识别时 evidence 为空。进程包装器另加 stderr、capture（可用状态、目录和双流 SHA-256）、耗时及采集状态。

进程包装器在启动命令前限制 `timeoutMs` 为 1–2,147,483,647 毫秒、`maxCaptureBytes` 为 1–67,108,864 字节、`maxOutputChars` 为 0–4,194,304 UTF-16 单元，均须整数。实际子进程状态保存在 `process.exit_code`；`runner_exit_code` 为超时 124、采集超限/保存失败 125，其他情况沿用实际状态，CLI 返回该值。命令执行后保存证据失败时不再抛弃结果：两条流仍返回，`reason=evidence_storage_failed`、`capture.available=false`，不展示可回查承诺。`delivery_metrics` 记录原始两流、交付两流、完整可见文本及说明开销，`net_reduction_chars` 可为负数。

超时/超限会终止原进程组和直接子进程，并关闭本地管道读取，避免已脱离进程组的后代持有管道而无限阻塞返回。此时已捕获的输出明确为不完整；包装器不能保证清理自行脱离原进程组的后代，也不是进程沙箱。

## 支持的格式

**Node TAP v13（平面与嵌套）**：`# Subtest:`、逐层编号的 `ok/not ok`、Node YAML 诊断块和完整计划/汇总。支持 Node 的 `describe/it` 套件、`t.test()` 子测试及空套件。嵌套层级按每级四个空格识别，每个子范围校验自己的编号和计划；递归核对 tests/suites/pass/fail/skipped/todo 计数及父级状态。套件不计入 tests，带子测试的普通 test 自身计入 tests。根层以下最多 32 层；超限回退 `tap_depth_limit`。

平面测试仍按原子块处理。嵌套树中任一失败、skip/todo 会使整个顶层分支成为必需单元，保留所有父级身份、子计划、断言、位置、堆栈及该分支中的通过测试。只丢弃已经完整校验、所有后代均普通通过、且所有诊断仅包含 duration/type 的顶层分支。不会把嵌套失败扁平化为失去父级上下文的片段。证据 kind 新增 `suite` 与 `subtests`；id 仍对应顶层连续单元。自定义日志、bailout、取消、不同 reporter/未知字段均回退。通过分支的名称、耗时不在必保契约中，可回查原文。详见 [嵌套 TAP](NESTED_TAP.md)。

**ripgrep JSONL**：检查 begin/end 配对、路径关联、行号/绝对偏移递增与相邻行衔接、submatch 的实际字节范围/内容/顺序、逐文件计数及最终计数与 exit 状态。`text` 与 base64 `bytes` 必须二选一，按实际 UTF-8/解码字节核对匹配，不能把 UTF-16 索引当字节偏移。保留每个 match/context 的完整原始 JSON 行和 summary。有正文事件的文件可省略 begin/end；没有正文的文件保留两个边界，避免丢掉其唯一的路径证据。`binary_offset` 必须显式为 null；重复键、未知字段/事件、不合法统计或编码、缺失 summary、错误退出均完整回退。该 profile 是单输入行匹配；多行或 NUL 分隔数据保守回退。`--max-count` 等搜索限制的含义由 scope 原样保留，不把搜索结果说成全仓库完备证明。

## 候选内容规则

验证器按原始顺序逐个匹配候选中的**完整原始单元**，并检查每个必需单元出现。它不使用候选给出的索引或元数据。候选若仅删行、删块，可从可信原文重建完整必要摘录；插入新文本、修改数值/路径/状态、重排原文都回退。候选即使语义等价、只改 JSON 空白，也可能被拒绝，这是明确的保守限制。

此机制不判断工具是否撒谎、测试断言是否合理，亦不防御原始工具输出本身含恶意指令；所有工具文本始终应作为不可信数据交给 Agent。
