#!/usr/bin/env node
/** Independent line-evidence evaluator. Does not read response.evidence or response.metrics. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { guard } from '../tools/api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('fixtures/manifest.json'));
const sha = value => createHash('sha256').update(value).digest('hex');
const lines = value => { const result = value.split('\n'); if (result.at(-1) === '') result.pop(); return result; };
const dimensions = value => ({ unicode_codepoints: [...value].length, utf16_units: value.length, utf8_bytes: Buffer.byteLength(value) });
const measure = operation => { const start = performance.now(); const value = operation(); return { value, elapsed_ms: performance.now() - start }; };
const subsequence = (original, output) => {
  const source = lines(original); let pos = 0;
  for (const line of lines(output)) { while (pos < source.length && source[pos] !== line) pos += 1; if (pos === source.length) return false; pos += 1; }
  return true;
};
const contains = (haystack, needle) => {
  const source = lines(haystack);
  return source.some((_, index) => needle.every((line, offset) => source[index + offset] === line));
};
function retain(raw, output, expected) {
  const found = expected.map(item => ({ tag: item.tag, line_start: item.line_start, line_end: item.line_end, retained: contains(output, item.lines) }));
  const before = dimensions(raw); const after = dimensions(output);
  return { evidence_total: found.length, evidence_retained: found.filter(item => item.retained).length,
    all_required_evidence_retained: found.every(item => item.retained), missing_evidence: found.filter(item => !item.retained),
    exact_ordered_line_subsequence: subsequence(raw, output), original: before, output: after,
    reduction: Object.fromEntries(Object.keys(before).map(key => [key, before[key] === 0 ? 0 : 1 - after[key] / before[key]])) };
}
export function headTail(raw, maxChars = 900) {
  if (raw.length <= maxChars) return raw;
  const source = lines(raw), allowance = Math.floor(maxChars / 2);
  const head = [], tail = []; let count = 0;
  for (const line of source) { if (count + line.length + 1 > allowance) break; head.push(line); count += line.length + 1; }
  count = 0;
  for (let i = source.length - 1; i >= head.length; i -= 1) { const line = source[i]; if (count + line.length + 1 > allowance) break; tail.unshift(line); count += line.length + 1; }
  return [...head, ...tail].join('\n') + (head.length || tail.length ? '\n' : '');
}
function benchmark(operation, runs = 31) {
  for (let i = 0; i < 5; i += 1) operation();
  const results = Array.from({ length: runs }, () => measure(operation).elapsed_ms).sort((a, b) => a - b);
  return { metric: 'in-process wall milliseconds, 5 warmups then 31 runs; not comparable with peer subprocess wall time', runs,
    median_ms: results[Math.floor(results.length / 2)], min_ms: results[0], max_ms: results.at(-1) };
}

mkdirSync(resolve(root, 'reports/evaluation'), { recursive: true });
mkdirSync(resolve(root, 'fixtures/candidates'), { recursive: true });
const comparisons = []; const adversarial = []; const peerAvailability = [];
for (const fixture of manifest.fixtures) {
  const raw = read(fixture.stdout); const stderr = read(fixture.stderr);
  if (sha(raw) !== fixture.stdout_sha256 || sha(stderr) !== fixture.stderr_sha256) throw new Error(`Hash drift ${fixture.id}; regenerate manifest intentionally`);
  for (const entry of fixture.required_evidence) {
    const originalSpan = lines(raw).slice(entry.line_start - 1, entry.line_end);
    if (JSON.stringify(originalSpan) !== JSON.stringify(entry.lines)) throw new Error(`Evidence span drift ${fixture.id}:${entry.tag}`);
  }
  const request = { format: fixture.format, raw, process: fixture.process, max_output_chars: 16000 };
  const compressed = measure(() => guard(request));
  const head = measure(() => headTail(raw));
  const modes = [
    { mode: 'original', output: raw, elapsed_ms: 0, timing_scope: 'identity reference, not a measured processor' },
    { mode: 'head-tail-900', output: head.value, elapsed_ms: head.elapsed_ms, timing_scope: 'single in-process line selection' },
    { mode: 'contextguard', output: compressed.value.output, elapsed_ms: compressed.elapsed_ms, timing_scope: 'single synchronous API call including JSON serialization', decision: compressed.value.decision, reason: compressed.value.reason,
      process_preserved: JSON.stringify(compressed.value.process) === JSON.stringify(fixture.process), benchmark: benchmark(() => guard(request)) },
  ];
  if (existsSync(resolve(root, 'research/run_peer.py'))) {
    const peer = measure(() => spawnSync('python3', ['research/run_peer.py', '--json', '--run-dir', 'reports/evaluation/peer-runs'], { cwd: root, input: raw, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    if (peer.value.status !== 0) throw new Error(`Peer failed: ${peer.value.stderr}`);
    const result = JSON.parse(peer.value.stdout);
    modes.splice(2, 0, { mode: 'harnesspro-tb2-lite', output: result.output, elapsed_ms: peer.elapsed_ms, timing_scope: 'full Python launcher and actual hook subprocess; not apples-to-apples with in-process core', peer: result });
  }
  if (existsSync(resolve(root, 'research/run_rtk.py'))) {
    const peer = measure(() => spawnSync('python3', ['research/run_rtk.py', '--json', '--run-dir', 'reports/evaluation/rtk-runs'], { cwd: root, input: raw, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    if (peer.value.status !== 0) throw new Error(`RTK peer failed: ${peer.value.stderr}`);
    const result = JSON.parse(peer.value.stdout);
    if (result.available) modes.splice(modes.length - 1, 0, { mode: 'rtk-oss-pipe', output: result.output, elapsed_ms: peer.elapsed_ms, timing_scope: 'Python launcher and actual RTK pipe subprocess', peer: result });
    else peerAvailability.push({ fixture: fixture.id, peer: result.peer, status: 'unrun', reason: result.reason });
  }
  const primaryModes = modes.slice();
  for (const mode of primaryModes) mode.budget_group = 'primary';
  const fairHead = measure(() => headTail(raw, 4000));
  const fairGuard = measure(() => guard({ ...request, max_output_chars: 4000 }));
  modes.push({ mode: 'original-4000-reference', budget_group: 'same-budget-4000', output: raw, elapsed_ms: 0, timing_scope: 'identity reference' },
    { mode: 'head-tail-4000', budget_group: 'same-budget-4000', output: fairHead.value, elapsed_ms: fairHead.elapsed_ms, timing_scope: 'single in-process line selection' },
    ...primaryModes.filter(mode => ['harnesspro-tb2-lite', 'rtk-oss-pipe'].includes(mode.mode)).map(mode => ({ ...mode, mode: `${mode.mode}-4000-reference`, budget_group: 'same-budget-4000', same_output_as_primary: true })),
    { mode: 'contextguard-4000', budget_group: 'same-budget-4000', output: fairGuard.value.output, elapsed_ms: fairGuard.elapsed_ms, timing_scope: 'single synchronous API call', decision: fairGuard.value.decision, reason: fairGuard.value.reason, process_preserved: JSON.stringify(fairGuard.value.process) === JSON.stringify(fixture.process) });
  for (const mode of modes) {
    const outputPath = `reports/evaluation/${fixture.id}.${mode.mode}.txt`;
    writeFileSync(resolve(root, outputPath), mode.output);
    const { output, ...metadata } = mode;
    comparisons.push({ fixture: fixture.id, format: fixture.format, ...metadata, output_file: outputPath, ...retain(raw, output, fixture.required_evidence) });
  }

  const runCase = (name, candidate, { expectedDecision, override = {}, outputMustEqualRaw = false } = {}) => {
    const candidatePath = `fixtures/candidates/${fixture.id}.${name}.txt`;
    if (candidate !== undefined) writeFileSync(resolve(root, candidatePath), candidate);
    const effective = { ...request, ...override, ...(candidate === undefined ? {} : { candidate }) };
    const measured = measure(() => guard(effective)); const result = measured.value;
    const retention = retain(raw, result.output, fixture.required_evidence);
    const checks = {
      required_evidence: retention.all_required_evidence_retained,
      exact_original_lines: retention.exact_ordered_line_subsequence,
      process_preserved: JSON.stringify(result.process) === JSON.stringify(effective.process),
      expected_decision: expectedDecision === undefined || result.decision === expectedDecision,
      raw_fallback: !outputMustEqualRaw || result.output === effective.raw,
    };
    adversarial.push({ fixture: fixture.id, case: name, candidate_file: candidate === undefined ? null : candidatePath,
      request_overrides: override, decision: result.decision, reason: result.reason, elapsed_ms: measured.elapsed_ms,
      checks, passed: Object.values(checks).every(Boolean), ...retention });
  };
  runCase('head-tail-omission', head.value);
  runCase('tiny-budget', undefined, { override: { max_output_chars: 24 }, expectedDecision: 'fallback', outputMustEqualRaw: true });
  runCase('process-truncated', undefined, { override: { process: { ...fixture.process, truncated: true } }, expectedDecision: 'fallback', outputMustEqualRaw: true });
  if (fixture.id === 'node-tap-middle-failure') {
    const failure = fixture.required_evidence.find(item => item.tag === 'tap-failure-block');
    const rawLines = lines(raw);
    runCase('whole-failure-block-omitted', rawLines.filter((_, index) => index < failure.line_start - 1 || index >= failure.line_end).join('\n') + '\n', { expectedDecision: 'repaired' });
    runCase('corrupt-middle-actual', raw.replace('    remaining: 7', '    remaining: 700'), { expectedDecision: 'fallback', outputMustEqualRaw: true });
    runCase('status-tamper', raw.replace('not ok 37 -', 'ok 37 -'), { expectedDecision: 'fallback', outputMustEqualRaw: true });
    runCase('line-order-tamper', [...rawLines.slice(-10), ...rawLines.slice(0, -10)].join('\n') + '\n', { expectedDecision: 'fallback', outputMustEqualRaw: true });
  } else if (fixture.id === 'rg-json-multiple-unicode-long') {
    const rawLines = lines(raw);
    const long = rawLines.findIndex(line => line.includes('long-middle'));
    runCase('long-middle-hit-omitted', rawLines.filter((_, index) => index !== long).join('\n') + '\n', { expectedDecision: 'repaired' });
    const firstMatch = rawLines.findIndex(line => JSON.parse(line).type === 'match');
    const mutated = rawLines.slice(); mutated[firstMatch] = mutated[firstMatch].replace(/fixtures\/sources\/search\/[^"\\]+/, 'fixtures/sources/search/swapped.txt');
    runCase('path-swap', mutated.join('\n') + '\n', { expectedDecision: 'fallback', outputMustEqualRaw: true });
    runCase('truncated-json-candidate', raw.slice(0, -12), { expectedDecision: 'fallback', outputMustEqualRaw: true });
    const summaryIndex = rawLines.findIndex(line => JSON.parse(line).type === 'summary');
    const summary = JSON.parse(rawLines[summaryIndex]); summary.data.stats.matches = 0;
    const status = rawLines.slice(); status[summaryIndex] = JSON.stringify(summary);
    runCase('summary-count-tamper', status.join('\n') + '\n', { expectedDecision: 'fallback', outputMustEqualRaw: true });
  }
}
// Separate fail-open assertions: these are robustness inputs, not additional real process captures.
const robustnessInputs = [
  { id: 'unknown-format', request: { format: 'unknown', raw: 'status changed\nimportant middle diagnostic\n', candidate: 'status changed\n', process: { exit_code: 9, scope: ['synthetic'], truncated: false } } },
  { id: 'malformed-rg-original', request: { format: 'rg-json', raw: '{"type":"match","data":', process: { exit_code: 0, scope: ['synthetic'], truncated: false } } },
];
const robustness = robustnessInputs.map(({ id, request }) => { const result = guard(request); return { id, origin: 'explicit synthetic malformed input, not captured process output', decision: result.decision, reason: result.reason, passed: result.output === request.raw && result.decision === 'fallback' }; });
const report = {
  schema_version: 1, generated_at: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch },
  scope: 'Offline replay of real process outputs from synthetic sources. No online task success, tokens, model costs or net savings measured.',
  evidence_ground_truth: 'fixtures/manifest.json required_evidence copied from original stdout by independent external annotator; guard evidence/metrics ignored',
  timing_boundary: 'UTF-16 units/codepoints/UTF-8 bytes are separate counts. Processor timing is measured independently. Peer subprocess startup included; no speed ranking inferred.',
  fixtures_manifest_sha256: sha(read('fixtures/manifest.json')),
  comparisons, adversarial, robustness, peerAvailability,
  summary: { fixtures: manifest.fixtures.length, comparisons: comparisons.length, adversarial_passed: adversarial.filter(row => row.passed).length, adversarial_total: adversarial.length, robustness_passed: robustness.filter(row => row.passed).length, robustness_total: robustness.length,
    guard_fallbacks: comparisons.filter(row => row.mode === 'contextguard' && row.decision === 'fallback').length,
    guard_evidence_complete: comparisons.filter(row => row.mode === 'contextguard' && row.all_required_evidence_retained && row.process_preserved).length,
    online_model_evaluation: 'not_run', real_cost_evaluation: 'not_run', token_evaluation: 'not_run', task_success_evaluation: 'not_run' },
};
writeFileSync(resolve(root, 'reports/evaluation.json'), JSON.stringify(report, null, 2) + '\n');
const pct = value => `${(100 * value).toFixed(2)}%`;
const rows = comparisons.map(row => `| ${row.fixture} | ${row.mode} | ${row.evidence_retained}/${row.evidence_total} | ${row.original.utf16_units} → ${row.output.utf16_units} | ${pct(row.reduction.utf16_units)} | ${row.decision ?? '—'} |`).join('\n');
writeFileSync(resolve(root, 'reports/evaluation.md'), `# ContextGuard 离线独立评测\n\n生成时间：${report.generated_at}。来源为合成程序/文本的真实进程输出，未运行付费模型或在线任务。\n\n原始 stdout 是独立证据清单来源；评测器不读取 ContextGuard 返回的 evidence 或 metrics。所有原文证据片段必须原样连续保留，另查全输出是否为原文有序行子序列。primary 组 head-tail 预算为 900 个 UTF-16 单位且整行截取，core 主比较预算为 16000。同行使用实际 HarnessPro TB2 Lite 固定版本的公开默认预算，预算不同，不能仅按压缩比例排名。同表另列 same-budget-4000 组：头尾与 ContextGuard 均设 4000，同行保持实际公开 4000 阈值（头2400+尾900）；原文与无预算控制的 RTK 仅作参考。超出必需证据预算时 core 回退，因此不会保证 4000 硬输出上限。\n\n| 夹具 | 方法 | 必需证据项 | UTF-16 单位 | 减少率 | 决策 |\n|---|---|---:|---:|---:|---|\n${rows}\n\n对抗案例：${report.summary.adversarial_passed}/${report.summary.adversarial_total}；格式失效/未知格式回退：${report.summary.robustness_passed}/${report.summary.robustness_total}。核心原始比较回退 ${report.summary.guard_fallbacks}/${manifest.fixtures.length}。完整逐案输入、输出、原因、耗时和独立检查在 evaluation.json 与 evaluation/ 目录。\n\n字符计数分别报告 Unicode codepoints、UTF-16 单位和 UTF-8 字节。时间以毫秒单独报告；core 有 5 次预热和 31 次测量，同行含 Python 启动及 hook 子进程，不能据此比较绝对性能。\n\n**未测：**模型 token、真实费用、净省钱、在线任务成功率。合成账本只验证记账逻辑。stderr 被独立保存与校验，stdout API 比较不声称保留 stderr。动态时间、临时工作目录会在重新采集后变化，原文哈希与标注将一同更新。\n`);
console.log(JSON.stringify(report.summary, null, 2));
if (adversarial.some(row => !row.passed) || robustness.some(row => !row.passed) || report.summary.guard_evidence_complete !== manifest.fixtures.length) process.exitCode = 1;
