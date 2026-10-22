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
let lastRaw = '';
let busy = false;
const n = (value) => typeof value === 'number' ? value.toLocaleString('en-US') : '—';

function setBusy(value) {
  busy = value;
  for (const id of ['run', 'compare', 'fixture']) $(id).disabled = value;
  $('run').textContent = value ? '正在校验…' : '校验输出 ↗';
}

function request() {
  const budget = Number($('budget').value);
  const exit = Number($('exit-code').value);
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('输出预算必须是非负整数');
  if (!Number.isSafeInteger(exit)) throw new Error('退出码必须是整数');
  const result = {
    format: $('format').value,
    raw: $('raw').value,
    max_output_chars: budget,
    process: { exit_code: exit, scope: $('scope').value.split(',').map((s) => s.trim()).filter(Boolean), truncated: $('truncated').checked },
  };
  if ($('candidate-enabled').checked) result.candidate = $('candidate').value;
  return result;
}

async function check(input) {
  const res = await fetch('/api/guard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const result = await res.json();
  if (!res.ok || result.error) throw new Error(result.error ?? `HTTP ${res.status}`);
  return result;
}

function headTail(raw) {
  const lines = raw.split('\n');
  if (lines.length <= 12) return raw.slice(0, Math.floor(raw.length / 3)) + '\n' + raw.slice(-Math.floor(raw.length / 3));
  return lines.slice(0, 5).join('\n') + '\n' + lines.slice(-7).join('\n');
}

function showError(error) {
  $('status').className = 'status-strip error';
  $('status-title').textContent = '暂未生成校验结果';
  $('status-reason').textContent = error.message;
  $('status-decision').textContent = 'ERROR';
}

function render(result, raw) {
  lastRaw = raw;
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
  const evidence = result.evidence ?? [];
  $('evidence-total').textContent = `${evidence.length} 条`;
  $('evidence-list').replaceChildren();
  if (!evidence.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '此次结果没有可确认的证据索引。'; $('evidence-list').append(empty);
    $('source-lines').textContent = '未知格式或保守回退不会伪造证据索引。';
    $('source-range').textContent = '未选择';
  }
  for (const item of evidence) {
    const button = document.createElement('button'); button.className = 'evidence-row';
    const name = document.createElement('span'); name.className = 'evidence-name'; name.textContent = `${item.id} · ${item.kind}`;
    const range = document.createElement('span'); range.className = 'evidence-range'; range.textContent = `L${item.start_line}–${item.end_line} ↗`;
    button.append(name, range);
    button.addEventListener('click', () => {
      document.querySelectorAll('.evidence-row').forEach((node) => node.classList.remove('selected'));
      button.classList.add('selected');
      $('source-title').textContent = item.kind;
      $('source-range').textContent = `L${item.start_line}–${item.end_line}`;
      $('source-lines').textContent = lastRaw.split('\n').slice(item.start_line - 1, item.end_line).map((line, index) => `${String(item.start_line + index).padStart(4)} │ ${line}`).join('\n');
    });
    $('evidence-list').append(button);
  }
  $('evidence-list').querySelector('button')?.click();
}

async function run() {
  if (busy) return;
  setBusy(true);
  try { const input = request(); render(await check(input), input.raw); }
  catch (error) { showError(error); }
  finally { setBusy(false); }
}

async function loadFixture() {
  setBusy(true);
  try {
    const fixture = manifest.fixtures.find((entry) => entry.id === $('fixture').value);
    const [rawRes, stderrRes] = await Promise.all([fetch('/' + fixture.stdout), fetch('/' + fixture.stderr)]);
    if (!rawRes.ok || !stderrRes.ok) throw new Error('读取示例失败');
    const [raw, stderr] = await Promise.all([rawRes.text(), stderrRes.text()]);
    $('format').value = fixture.format;
    $('raw').value = raw;
    $('raw-lines').textContent = `${raw.split('\n').length - Number(raw.endsWith('\n'))} 行`;
    $('exit-code').value = fixture.process.exit_code;
    $('scope').value = fixture.process.scope.join(', ');
    $('truncated').checked = fixture.process.truncated;
    $('candidate').value = '';
    $('candidate-enabled').checked = false;
    $('stderr').textContent = stderr || '（空）';
    $('stderr-count').textContent = `${stderr.length} 单位`;
    $('budget').value = '12000';
    $('fixture-note').textContent = '合成源程序的真实进程输出 · ' + (fixture.invocation?.shell_display ?? fixture.source_origin);
    const input = request(); render(await check(input), input.raw);
    $('comparison').replaceChildren();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}

$('run').addEventListener('click', run);
$('fixture').addEventListener('change', loadFixture);
$('head-tail').addEventListener('click', () => { $('candidate').value = headTail($('raw').value); $('candidate-enabled').checked = true; run(); });
$('clear-candidate').addEventListener('click', () => { $('candidate').value = ''; $('candidate-enabled').checked = false; run(); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('output').dataset.output ?? ''); $('copy').textContent = '已复制'; }
  catch { $('copy').textContent = '请选中结果复制'; }
});
for (const id of ['raw', 'candidate', 'candidate-enabled', 'format', 'budget', 'exit-code', 'scope', 'truncated']) {
  $(id).addEventListener('input', () => {
    $('status-title').textContent = '输入已变更 · 请重新校验';
    $('status-reason').textContent = '下方保留上一次结果与对应原文快照。';
    $('status-decision').textContent = 'STALE';
    $('raw-lines').textContent = `${$('raw').value.split('\n').length - Number($('raw').value.endsWith('\n'))} 行`;
  });
}
$('compare').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    const base = request(); delete base.candidate;
    const cases = [ ['原文候选', base.raw], ['头尾截断', headTail(base.raw)], ['自定义候选', $('candidate').value], ['自动抽取候选', undefined] ];
    const results = [];
    for (const [label, candidate] of cases) {
      const input = { ...base }; if (candidate !== undefined) input.candidate = candidate;
      const result = await check(input); results.push({ label, candidate, result });
    }
    $('comparison').replaceChildren();
    for (const { label, candidate, result } of results) {
      const row = document.createElement('tr');
      for (const value of [label, candidate === undefined ? '核心生成' : n(candidate.length), n(result.metrics?.missing_facts), result.decision, n(result.metrics?.output_chars)]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      $('comparison').append(row);
    }
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});

try {
  const response = await fetch('/fixtures/manifest.json');
  if (!response.ok) throw new Error('本地示例清单尚未生成');
  manifest = await response.json();
  $('fixture').replaceChildren();
  for (const entry of manifest.fixtures) { const option = document.createElement('option'); option.value = entry.id; option.textContent = labels[entry.id] ?? entry.id; $('fixture').append(option); }
  if (manifest.fixtures.some((entry) => entry.id === 'node-tap-middle-failure')) $('fixture').value = 'node-tap-middle-failure';
  await loadFixture();
} catch (error) { showError(error); }
