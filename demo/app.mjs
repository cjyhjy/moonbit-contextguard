import { createRequestSession, integerField } from './request-session.mjs';

const $ = (id) => document.getElementById(id);
const labels = {
  'node-tap-all-pass': '测试日志 · 全部通过',
  'node-tap-zero-tests': '测试日志 · 零个测试',
  'node-tap-middle-failure': '测试日志 · 关键失败藏在中间',
  'rg-json-multiple-unicode-long': '搜索结果 · Unicode 与长命中行',
  'rg-json-no-results': '搜索结果 · 没有匹配',
  'rg-json-invalid-path': '搜索错误 · 路径不存在',
};
let manifest;
let busy = false;
let hasResult = false;
const session = createRequestSession();
const n = (value) => typeof value === 'number' ? value.toLocaleString('en-US') : '—';

function setBusy(value) {
  busy = value;
  for (const id of ['run', 'compare', 'head-tail', 'clear-candidate']) $(id).disabled = value;
  $('fixture').disabled = value || !manifest;
  $('run').textContent = value ? '正在校验…' : '校验输出 ↗';
  $('compare').textContent = value ? '等待校验完成…' : '运行四组对照 ⇄';
  $('status').setAttribute('aria-busy', String(value));
}

function resultState(state) {
  $('copy').disabled = state !== 'current';
  $('copy').textContent = '复制结果';
  const text = state === 'current' ? '当前输入的校验结果' : hasResult ? '上次校验快照 · 当前输入尚未通过校验' : '等待校验结果';
  $('result-snapshot').textContent = text;
  $('source-snapshot').textContent = state === 'current' ? '行号对应此次校验的原文快照。' : hasResult ? '此处保留上次校验的原文快照；与当前编辑内容可能不同。' : '运行校验后，可回查对应原文快照。';
  document.querySelector('.metrics').dataset.state = state;
}

function resetComparison(message = '点击“运行四组对照”开始。') {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 5; cell.className = 'empty'; cell.textContent = message;
  row.append(cell); $('comparison').replaceChildren(row);
}

function request() {
  for (const id of ['budget', 'exit-code']) $(id).removeAttribute('aria-invalid');
  const budget = integerField($('budget').value, { label: '输出预算', field: 'budget', min: 0 });
  const exit = integerField($('exit-code').value, { label: '退出码', field: 'exit-code' });
  const result = {
    format: $('format').value,
    raw: $('raw').value,
    max_output_chars: budget,
    process: { exit_code: exit, scope: $('scope').value.split(',').map((s) => s.trim()).filter(Boolean), truncated: $('truncated').checked },
  };
  if ($('candidate-enabled').checked) result.candidate = $('candidate').value;
  return result;
}

async function check(input, operation) {
  const res = await fetch('/api/guard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: operation.signal });
  let result;
  try { result = await res.json(); }
  catch { throw new Error(`服务未返回有效 JSON（HTTP ${res.status}），请检查本地服务后重试。`); }
  if (!res.ok || result.error) throw new Error(result.error ?? `HTTP ${res.status}`);
  return result;
}

function headTail(raw) {
  const lines = raw.split('\n');
  if (lines.length <= 12) return raw.slice(0, Math.floor(raw.length / 3)) + '\n' + raw.slice(-Math.floor(raw.length / 3));
  return lines.slice(0, 5).join('\n') + '\n' + lines.slice(-7).join('\n');
}

function showError(error) {
  resultState('error');
  $('status').className = 'status-strip error';
  $('status-title').textContent = '此次校验未完成';
  $('status-reason').textContent = error.message;
  $('status-decision').textContent = 'ERROR';
  $('budget-feedback').textContent = '预算尚未验证。';
  if (error.field) { $(error.field).setAttribute('aria-invalid', 'true'); $(error.field).focus(); }
}

function markStale() {
  session.invalidate();
  setBusy(false);
  resultState('stale');
  $('status').className = 'status-strip stale';
  $('status-title').textContent = '输入已变更 · 请重新校验';
  $('status-reason').textContent = hasResult ? '下方保留上一次结果与对应原文快照，暂不可复制为当前结果。' : '使用“校验输出”检查当前输入。';
  $('status-decision').textContent = 'STALE';
  $('budget-feedback').textContent = '预算尚未验证。';
  $('raw-lines').textContent = `${$('raw').value ? $('raw').value.split('\n').length - Number($('raw').value.endsWith('\n')) : 0} 行`;
  resetComparison('输入已变更 · 请重新运行四组对照。');
}

function beginOperation() {
  const operation = session.begin();
  setBusy(true);
  resultState('pending');
  $('status').className = 'status-strip pending';
  $('status-title').textContent = '正在校验当前输入…';
  $('status-reason').textContent = '编辑输入会取消本次请求；证据回查保留上次校验快照。';
  $('status-decision').textContent = 'CHECKING';
  return operation;
}

function finishOperation(operation) {
  if (session.finish(operation)) setBusy(false);
}

function render(result, input) {
  const raw = input.raw;
  const sourceLines = raw.split('\n');
  hasResult = true;
  resultState('current');
  const metrics = result.metrics ?? {};
  const inputChars = metrics.input_chars ?? raw.length;
  const outputChars = metrics.output_chars ?? result.output.length;
  $('input-chars').textContent = n(inputChars);
  $('output-chars').textContent = n(outputChars);
  $('reduction').textContent = inputChars ? `${((1 - outputChars / inputChars) * 100).toFixed(1)}%` : '0.0%';
  $('fact-count').textContent = n(metrics.required_facts);
  $('missing-count').textContent = `候选缺失 ${n(metrics.missing_facts)} 条必要证据`;
  $('output').textContent = result.output || '（空输出）';
  $('output').dataset.output = result.output;
  const fallback = result.decision?.includes('fallback');
  const original = result.output_kind === 'original';
  const repaired = result.decision?.includes('repair');
  $('status').className = `status-strip${fallback ? ' fallback' : ''}`;
  $('status-title').textContent = fallback ? '保留原文 · 不强行满足预算' : original ? '候选已验证 · 完整原文通过' : repaired ? '补回缺失证据 · 交付可回查投影' : '必要证据通过 · 交付可回查投影';
  $('status-reason').textContent = result.reason ?? '';
  $('status-decision').textContent = (result.decision ?? 'UNKNOWN').toUpperCase();
  $('result-label').textContent = original ? 'ORIGINAL OUTPUT' : 'EVIDENCE PROJECTION';
  $('output-kind').textContent = fallback ? '原文保守回退' : original ? '完整原文已验证' : '可回查证据投影';
  $('budget-feedback').textContent = outputChars > input.max_output_chars
    ? `交付超出预算 ${n(outputChars - input.max_output_chars)} 单位 · 为保留必要证据，交付完整原文。`
    : `交付 ${n(outputChars)} / 预算 ${n(input.max_output_chars)} UTF-16 单位`;
  const evidence = result.evidence ?? [];
  $('evidence-total').textContent = `${evidence.length} 条`;
  $('evidence-list').replaceChildren();
  $('source-title').textContent = '原文回查';
  $('source-range').textContent = '未选择';
  if (!evidence.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '此次结果没有可确认的证据索引。'; $('evidence-list').append(empty);
    $('source-lines').textContent = '未知格式或保守回退不会伪造证据索引。';
  }
  for (const item of evidence) {
    const button = document.createElement('button'); button.className = 'evidence-row'; button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span'); name.className = 'evidence-name'; name.textContent = `${item.id} · ${item.kind}`;
    const range = document.createElement('span'); range.className = 'evidence-range'; range.textContent = `L${item.start_line}–${item.end_line} ↗`;
    button.append(name, range);
    button.addEventListener('click', () => {
      document.querySelectorAll('.evidence-row').forEach((node) => { node.classList.remove('selected'); node.setAttribute('aria-pressed', 'false'); });
      button.classList.add('selected'); button.setAttribute('aria-pressed', 'true');
      $('source-title').textContent = item.kind;
      $('source-range').textContent = `L${item.start_line}–${item.end_line}`;
      $('source-lines').textContent = sourceLines.slice(item.start_line - 1, item.end_line).map((line, index) => `${String(item.start_line + index).padStart(4)} │ ${line}`).join('\n');
    });
    $('evidence-list').append(button);
  }
  $('evidence-list').querySelector('button')?.click();
}

async function run() {
  if (busy) return;
  let input;
  try { input = request(); } catch (error) { showError(error); return; }
  const operation = beginOperation();
  try {
    const result = await check(input, operation);
    if (session.canCommit(operation)) render(result, input);
  } catch (error) { if (session.owns(operation)) showError(operation.signal.reason ?? error); }
  finally { finishOperation(operation); }
}

async function loadFixture() {
  const operation = beginOperation();
  resetComparison();
  try {
    const fixture = manifest.fixtures.find((entry) => entry.id === $('fixture').value);
    if (!fixture) throw new Error('所选示例不在本地清单中。');
    const [rawRes, stderrRes] = await Promise.all([fetch('/' + fixture.stdout, { signal: operation.signal }), fetch('/' + fixture.stderr, { signal: operation.signal })]);
    if (!rawRes.ok || !stderrRes.ok) throw new Error('读取示例失败');
    const [raw, stderr] = await Promise.all([rawRes.text(), stderrRes.text()]);
    if (!session.canCommit(operation)) return;
    $('format').value = fixture.format;
    $('raw').value = raw;
    $('raw-lines').textContent = `${raw ? raw.split('\n').length - Number(raw.endsWith('\n')) : 0} 行`;
    $('exit-code').value = fixture.process.exit_code;
    $('scope').value = fixture.process.scope.join(', ');
    $('truncated').checked = fixture.process.truncated;
    $('candidate').value = '';
    $('candidate-enabled').checked = false;
    $('stderr').textContent = stderr || '（空）';
    $('stderr-count').textContent = `${stderr.length} 单位`;
    $('budget').value = '12000';
    $('fixture-note').textContent = '合成源程序的真实进程输出 · ' + (fixture.invocation?.shell_display ?? fixture.source_origin);
    const input = request();
    const result = await check(input, operation);
    if (session.canCommit(operation)) render(result, input);
  } catch (error) { if (session.owns(operation)) showError(operation.signal.reason ?? error); }
  finally { finishOperation(operation); }
}

$('run').addEventListener('click', run);
$('fixture').addEventListener('change', loadFixture);
$('head-tail').addEventListener('click', () => { $('candidate').value = headTail($('raw').value); $('candidate-enabled').checked = true; markStale(); run(); });
$('clear-candidate').addEventListener('click', () => { $('candidate').value = ''; $('candidate-enabled').checked = false; markStale(); run(); });
$('copy').addEventListener('click', async () => {
  if ($('copy').disabled) return;
  const output = $('output').dataset.output;
  try { await navigator.clipboard.writeText(output); if (!$('copy').disabled && $('output').dataset.output === output) $('copy').textContent = '已复制'; }
  catch { if (!$('copy').disabled) $('copy').textContent = '请选中结果复制'; }
});
for (const id of ['raw', 'candidate', 'candidate-enabled', 'format', 'budget', 'exit-code', 'scope', 'truncated']) {
  $(id).addEventListener('input', () => {
    $(id).removeAttribute('aria-invalid');
    if (id === 'raw') $('fixture-note').textContent = '原始输出已编辑 · 当前输入为自定义文本；下方 stderr 仍为所选示例的独立记录。';
    markStale();
  });
}
$('compare').addEventListener('click', async () => {
  if (busy) return;
  let base;
  try { base = request(); } catch (error) { showError(error); return; }
  const current = { ...base };
  delete base.candidate;
  const cases = [ ['原文候选', base.raw], ['头尾截断', headTail(base.raw)], ['自定义候选', $('candidate').value], ['自动抽取候选', undefined] ];
  const operation = beginOperation();
  resetComparison('正在校验同一输入的四组候选…');
  try {
    const results = await Promise.all(cases.map(async ([label, candidate]) => {
      const input = { ...base }; if (candidate !== undefined) input.candidate = candidate;
      return { label, candidate, result: await check(input, operation) };
    }));
    if (!session.canCommit(operation)) return;
    // Refresh the main result for the actual editor settings, not an arbitrary comparison row.
    render(results[Object.hasOwn(current, 'candidate') ? 2 : 3].result, current);
    $('comparison').replaceChildren();
    for (const { label, candidate, result } of results) {
      const row = document.createElement('tr');
      for (const value of [label, candidate === undefined ? '核心生成' : n(candidate.length), n(result.metrics?.missing_facts), result.decision, n(result.metrics?.output_chars)]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      $('comparison').append(row);
    }
  } catch (error) {
    if (session.owns(operation)) { showError(operation.signal.reason ?? error); resetComparison('对照未完成 · 请重新运行四组对照。'); }
  } finally { finishOperation(operation); }
});

const initialization = beginOperation();
try {
  const response = await fetch('/fixtures/manifest.json', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('本地示例清单尚未生成');
  const loaded = await response.json();
  manifest = loaded;
  if (!Array.isArray(manifest.fixtures) || !manifest.fixtures.length) throw new Error('本地示例清单为空');
  $('fixture').replaceChildren();
  for (const entry of manifest.fixtures) { const option = document.createElement('option'); option.value = entry.id; option.textContent = labels[entry.id] ?? entry.id; $('fixture').append(option); }
  if (manifest.fixtures.some((entry) => entry.id === 'node-tap-middle-failure')) $('fixture').value = 'node-tap-middle-failure';
  if (session.canCommit(initialization)) await loadFixture();
  else $('fixture').disabled = busy;
} catch (error) { if (session.owns(initialization)) showError(initialization.signal.reason ?? error); }
finally { finishOperation(initialization); }
