import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {guard} from '../tools/api.mjs';
import {guard_request} from '../dist/contextguard.mjs';

const fixture = readFileSync(new URL('../fixtures/raw/rg-json-multiple-unicode-long.stdout.txt', import.meta.url), 'utf8');
const processInfo = {exit_code: 0, scope: ['fixture'], truncated: false};
const encode = records => records.map(JSON.stringify).join('\n') + '\n';
const request = (raw, process = processInfo) => ({format: 'rg-json', raw, process});
function changed(fn) {
  return encode(fixture.trimEnd().split('\n').map(line => {
    const record = JSON.parse(line);
    fn(record);
    return record;
  }));
}
function fallback(raw, reason, options = {}) {
  const result = guard({...request(raw), ...options});
  assert.equal(result.decision, 'fallback');
  assert.equal(result.output, raw);
  assert.equal(result.assurance, 'original_passthrough');
  if (reason) assert.equal(result.reason, reason);
  return result;
}
function simpleStream({content = '猫needle\n', submatch = {match: {text: 'needle'}, start: 3, end: 9}, path = {text: 'a.txt'}} = {}) {
  const lines = typeof content === 'string' ? {text: content} : content;
  return encode([
    {type: 'begin', data: {path}},
    {type: 'match', data: {path, lines, line_number: 1, absolute_offset: 0, submatches: [submatch]}},
    {type: 'end', data: {path, binary_offset: null, stats: {matched_lines: 1, matches: 1}}},
    {type: 'summary', data: {stats: {matched_lines: 1, matches: 1, searches: 1}}}
  ]);
}

test('new fields in omitted rg events and their nested metadata cannot disappear', () => {
  const mutations = [
    r => {if (r.type === 'begin') r.error = 'permission denied';},
    r => {if (r.type === 'begin') r.data.error = 'permission denied';},
    r => {if (r.type === 'begin') r.data.path.error = 'permission denied';},
    r => {if (r.type === 'end') r.data.truncated = true;},
    r => {if (r.type === 'end') r.data.stats.error_count = 1;},
    r => {if (r.type === 'end') r.data.stats.elapsed.error = 'permission denied';}
  ];
  for (const mutation of mutations) fallback(changed(mutation));
});

test('rg requires an explicit null binary_offset and validates supplied statistics', () => {
  fallback(changed(r => {if (r.type === 'end') delete r.data.binary_offset;}), 'rg_missing_binary_offset');
  fallback(changed(r => {if (r.type === 'end') r.data.binary_offset = 5;}), 'rg_binary_output');
  fallback(changed(r => {if (r.type === 'end') r.data.stats.searches = 2;}), 'rg_file_count_mismatch');
  fallback(changed(r => {if (r.type === 'end') r.data.stats.searches_with_match = 0;}), 'rg_file_count_mismatch');
  fallback(changed(r => {if (r.type === 'summary') r.data.stats.searches_with_match = 0;}), 'rg_count_mismatch');
  for (const value of ['100', -1, null, 1.5]) {
    fallback(changed(r => {if (r.type === 'end') r.data.stats.bytes_searched = value;}), 'rg_invalid_stats');
  }
});

test('duplicate JSON keys, including escaped names and nested keys, fail open', () => {
  const cases = [
    fixture.replace('"type":"begin"', '"type":"error","type":"begin"'),
    fixture.replace('"type":"begin"', '"ty\\u0070e":"error","type":"begin"'),
    fixture.replace('"binary_offset":null', '"binary_offset":99,"binary_offset":null'),
    fixture.replace('"data":{', '"data":{},"data":{'),
    fixture.replace('"path":{"text":', '"path":{"text":"different","text":')
  ];
  for (const raw of cases) fallback(raw, 'rg_duplicate_json_key');
});

test('duplicate top-level or nested request keys are explicit transport errors', () => {
  for (const source of [
    '{"raw":"first","raw":"second"}',
    '{"raw":"first","r\\u0061w":"second"}',
    '{"raw":"x","process":{"exit_code":2,"exit_code":0}}'
  ]) {
    assert.deepEqual(JSON.parse(guard_request(source)), {error: 'invalid_json_request'});
  }
  const raw = simpleStream({path: {text: 'quote" colon: comma, braces{} brackets[].txt'}});
  assert.equal(guard(request(raw)).decision, 'compressed');
});

test('text and base64 are exclusive, decoded and checked before accepting ranges', () => {
  const encoded = simpleStream({
    content: {bytes: Buffer.from('猫needle\n').toString('base64')},
    path: {bytes: Buffer.from([0xff, 0x2e, 0x74, 0x78, 0x74]).toString('base64')},
    submatch: {match: {bytes: Buffer.from('needle').toString('base64')}, start: 3, end: 9}
  });
  assert.equal(guard(request(encoded)).decision, 'compressed');
  const invalidBytes = ['***', 'bmVlZGxlCg===', 'bmVlZGxl Cg==', 'A'];
  for (const bytes of invalidBytes) fallback(simpleStream({content: {bytes}}), 'rg_invalid_record');
  fallback(simpleStream({content: {text: '猫needle\n', bytes: '54yrbmVlZGxlCg=='}}), 'rg_invalid_record');
  fallback(simpleStream({path: {text: 'a.txt', bytes: 'YS50eHQ='}}), 'rg_invalid_begin');
});

test('rg submatches validate UTF8 bounds, ordering and actual byte content', () => {
  assert.equal(guard(request(simpleStream())).decision, 'compressed');
  for (const submatch of [
    {match: {text: 'needle'}, start: 3, end: 999999},
    {match: {text: 'needle'}, start: 9, end: 3},
    {match: {text: 'needle'}, start: -1, end: 5},
    {match: {text: 'needle'}, start: 1, end: 7},
    {match: {text: 'changed'}, start: 3, end: 9},
    {match: {text: 'wrong!'}, start: 3, end: 9}
  ]) fallback(simpleStream({submatch}));
  const zeroWidth = simpleStream({submatch: {match: {text: ''}, start: 3, end: 3}});
  assert.equal(guard(request(zeroWidth)).decision, 'compressed');
  const overlapping = changed(r => {
    if (r.type === 'match') r.data.submatches.push({...r.data.submatches[0]});
    if (r.data.stats) r.data.stats.matches *= 2;
  });
  fallback(overlapping, 'rg_invalid_submatch');
});

test('rg rejects contradictory source line numbers and absolute offsets', () => {
  fallback(changed(r => {if (r.type === 'match') r.data.line_number = 1;}), 'rg_inconsistent_position');
  fallback(changed(r => {if (r.type === 'match') r.data.absolute_offset += 1;}), 'rg_inconsistent_position');
  fallback(changed(r => {if (r.type === 'match') r.data.absolute_offset = 0;}), 'rg_inconsistent_position');
});

test('multiline and NUL-delimited rg data stays original under the single-line profile', () => {
  fallback(simpleStream({content: '猫needle\nnext\n'}), 'rg_unsupported_line_encoding');
  fallback(simpleStream({content: '猫needle\0'}), 'rg_unsupported_line_encoding');
  assert.equal(guard(request(simpleStream({content: '猫needle\r\n'}))).decision, 'compressed');
  assert.equal(guard(request(simpleStream({content: '猫needle'}))).decision, 'compressed');
});

test('a zero-record file keeps its otherwise lost path and repairs omitted boundaries', () => {
  const path = {text: 'only-occurrence-of-this-path.txt'};
  const summary = {type: 'summary', data: {stats: {matched_lines: 0, matches: 0, searches: 1}}};
  const raw = encode([
    {type: 'begin', data: {path}},
    {type: 'end', data: {path, binary_offset: null, stats: {matched_lines: 0, matches: 0}}},
    summary
  ]);
  const input = request(raw, {...processInfo, exit_code: 1});
  assert.equal(guard(input).output, raw);
  const result = guard({...input, candidate: encode([summary])});
  assert.equal(result.decision, 'repaired');
  assert.equal(result.output, raw);
  assert.deepEqual(result.evidence.map(e => e.kind), ['begin', 'end', 'summary']);
});

test('source and candidate line budgets apply before creating line arrays', () => {
  const tooMany = '\n'.repeat(50001);
  fallback(tooMany, 'line_budget_exceeded');
  fallback(fixture, 'candidate_line_budget_exceeded', {candidate: tooMany});
  const exact = guard(request('\n'.repeat(50000)));
  assert.notEqual(exact.reason, 'line_budget_exceeded');
});

test('similar failure blocks cannot substitute for each other in external candidates', () => {
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '-e',
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('same title',()=>assert.equal(1,2)); test('same title',()=>assert.equal(1,2));"
  ], {encoding: 'utf8', env});
  assert.equal(child.status, 1, child.stderr);
  const input = {format: 'node-tap', raw: child.stdout, process: {exit_code: child.status, scope: ['synthetic node:test via -e'], truncated: false}};
  const result = guard(input);
  assert.equal(result.decision, 'compressed');
  const failures = result.evidence.filter(e => e.kind === 'failure');
  assert.equal(failures.length, 2);
  for (const block of failures) {
    const candidate = result.output.replace(block.text + '\n', '');
    const repaired = guard({...input, candidate});
    assert.equal(repaired.decision, 'repaired');
    for (const evidence of failures) assert.ok(repaired.output.includes(evidence.text));
  }
});

const hasRg = spawnSync('rg', ['--version'], {encoding: 'utf8'}).status === 0;
test('actual ripgrep stdin output works with UTF8 and non-UTF8 match lines', {skip: !hasRg}, () => {
  const inputs = [Buffer.from('猫needle tail\n'), Buffer.from([0xff, ...Buffer.from('needle tail\n')])];
  for (const input of inputs) {
    const child = spawnSync('rg', ['--json', 'needle'], {input, encoding: 'buffer'});
    assert.equal(child.status, 0, child.stderr.toString());
    const raw = child.stdout.toString('utf8');
    const result = guard(request(raw, {exit_code: child.status, scope: ['rg', '--json', 'needle', '<stdin>'], truncated: false}));
    assert.equal(result.decision, 'compressed');
    const matches = raw.trimEnd().split('\n').filter(line => JSON.parse(line).type === 'match');
    for (const match of matches) assert.ok(result.output.includes(match));
  }
});
