import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {guard} from '../tools/api.mjs';

const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('fixtures/nested-tap/manifest.json'));
const sha = value => createHash('sha256').update(value).digest('hex');
const request = f => ({format: 'node-tap', raw: read(f.stdout), process: f.process});
const selected = f => f.required_spans.map(span => span.text).join('\n')+'\n';
const suites = manifest.fixtures.find(f => f.id === 'suites');
function retained(f, result) {
  assert.deepEqual(result.process, f.process);
  for (const span of f.required_spans) assert.ok(result.output.includes(span.text+'\n'), `lost ${f.id}:${span.kind}`);
  const source = read(f.stdout).trimEnd().split('\n');
  let cursor = 0;
  for (const line of result.output.trimEnd().split('\n')) {
    while (cursor < source.length && source[cursor] !== line) cursor++;
    assert.ok(cursor < source.length, 'output is not an ordered original-line subsequence');
    cursor++;
  }
}
function fallback(raw, expected) {
  const result = guard({...request(suites), raw});
  assert.equal(result.decision, 'fallback');
  assert.equal(result.output, raw);
  if (expected) assert.equal(result.reason, expected);
}

for (const f of manifest.fixtures) test(`captured nested TAP: ${f.id}`, () => {
  assert.equal(sha(read(f.source)), f.source_sha256);
  for (const source of f.source_files ?? []) assert.equal(sha(read(source.path)), source.sha256);
  assert.equal(sha(read(f.stdout)), f.stdout_sha256);
  assert.equal(sha(read(f.stderr)), f.stderr_sha256);
  const result = guard(request(f));
  assert.equal(result.decision, f.expected_decision, result.reason);
  retained(f, result);
  if (f.expected_decision === 'compressed') assert.equal(result.output, selected(f));
  else assert.equal(result.output, read(f.stdout));
});

test('missing nested child diagnostics and entire branches are repaired atomically', () => {
  const f = suites, raw = read(f.stdout), branch = f.required_spans.find(s => s.kind === 'branch');
  for (const candidate of [selected(f).replace(branch.text+'\n', ''),
    selected(f).replace(/        not ok [^\n]+\n/, ''),
    selected(f).replace(/          actual: [^\n]+\n/, '')]) {
    const result = guard({...request(f), candidate});
    assert.equal(result.decision, 'repaired');
    assert.equal(result.output, selected(f));
    retained(f, result);
  }
  const budget = guard({...request(f), candidate: '', max_output_chars: 100});
  assert.equal(budget.decision, 'fallback');
  assert.equal(budget.output, raw);
});

test('edited assertions, transplanted child identities and reordered diagnostics fail open', () => {
  const candidate = selected(suites);
  for (const changed of [candidate.replace('actual: 2', 'actual: 999'),
    candidate.replace('not ok 2 - broken identity', 'not ok 1 - shared title'),
    candidate.replace('          expected: 3\n          actual: 2', '          actual: 2\n          expected: 3')]) {
    assert.notEqual(changed, candidate);
    const result = guard({...request(suites), candidate: changed});
    assert.equal(result.decision, 'fallback');
    assert.equal(result.output, read(suites.stdout));
  }
});

test('nested source numbering, plans, parent status, indentation and totals are validated', () => {
  const raw = read(suites.stdout);
  for (const [from, to, reason] of [
    ['        not ok 2 - broken identity', '        not ok 9 - broken identity', 'tap_identity_mismatch'],
    ['        1..4', '        1..3', 'tap_child_plan_mismatch'],
    ['    1..2', '    1..20', 'tap_child_plan_mismatch'],
    ['not ok 13 - suite 月兔', 'ok 13 - suite 月兔', 'tap_parent_status_mismatch'],
    ['        # Subtest: broken identity', '       # Subtest: broken identity', null],
    ['# suites 2\n', '# suites 1\n', 'tap_summary_mismatch'],
    ["  type: 'test'\n", "  type: 'suite'\n", 'tap_summary_mismatch'],
    ['  duration_ms: ', '  duration_ms: NaN', 'tap_invalid_duration']
  ]) {
    const changed = raw.replace(from, to);
    assert.notEqual(changed, raw, from);
    fallback(changed, reason);
  }
  const result = guard({...request(suites), process: {...suites.process, exit_code: 0}});
  assert.equal(result.reason, 'tap_exit_mismatch');
});

test('seeded candidate deletion audit preserves independently annotated nested evidence', () => {
  let state = 0x51a7beef;
  const rows = [];
  for (const f of manifest.fixtures) {
    const lines = read(f.stdout).trimEnd().split('\n');
    for (let i = 0; i < 128; i++) {
      const candidate = lines.filter(() => {
        state = (Math.imul(state, 1664525)+1013904223) >>> 0;
        return state / 2**32 > 0.3;
      }).join('\n')+'\n';
      const result = guard({...request(f), candidate});
      retained(f, result);
      rows.push({fixture: f.id, iteration: i, decision: result.decision});
    }
  }
  writeFileSync(new URL('../reports/nested-tap-audit.json', import.meta.url), JSON.stringify({
    schema_version: 1, seed: '0x51a7beef', cases: rows.length, passed: rows.length,
    oracle: 'Captured original stdout spans, annotated independently of guard evidence/metrics.', rows
  }, null, 2)+'\n');
});

test('fresh actual nested suite output is accepted through the public API', () => {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suites.source], {
    cwd: new URL('../', import.meta.url), env, encoding: 'utf8', timeout: 10000
  });
  assert.equal(child.status, 1, child.error?.message ?? child.stderr);
  const result = guard({format: 'node-tap', raw: child.stdout, process: {...suites.process, exit_code: child.status}});
  assert.equal(result.decision, 'compressed', result.reason);
  assert.ok(result.output.includes('suite 月兔'));
  assert.ok(result.output.includes('not ok 2 - broken identity'));
  assert.ok(result.output.includes('          expected: 3\n          actual: 2'));
  assert.ok(result.output.length < child.stdout.length);
});
