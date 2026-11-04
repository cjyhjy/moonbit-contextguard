import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContextGuardPlugin } from '../adapters/opencode.mjs';
import { recallWithAudit } from '../adapters/recall.mjs';
import { parseEvents, summarizeEvents } from '../evaluation/telemetry.mjs';

const raw = await readFile(new URL('../fixtures/raw/node-tap-middle-failure.stdout.txt', import.meta.url), 'utf8');
const command = 'node --test --test-reporter=tap test.cjs';
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'contextguard-telemetry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hooks = await createContextGuardPlugin({ runId: 'test-run', allowCommands: [{ command, scope: ['test.cjs'] }], ...options })({ directory });
  const log = () => readFile(join(directory, '.contextguard/evidence/events.jsonl'), 'utf8').then(parseEvents);
  let id = 0;
  async function invoke(overrides = {}, event = {}) {
    const input = { tool: 'bash', sessionID: 'session', callID: `call-${++id}`, args: { command }, ...event };
    const output = { title: 'test', output: raw, metadata: { exit: 1, truncated: false }, ...overrides };
    await hooks['tool.execute.before'](input, { args: input.args });
    await hooks['tool.execute.after'](input, output);
    return { input, output };
  }
  return { hooks, directory, log, invoke };
}

test('coverage includes all skips, core fallback, applied, and runtime failure without an after hook', async t => {
  const s = await setup(t);
  const applied = await s.invoke();
  assert(applied.output.output.length < raw.length);
  await s.invoke({}, { tool: 'grep' });
  await s.invoke({}, { args: { command: 'npm test' } });
  await s.invoke({}, { args: { command, workdir: '/elsewhere' } });
  await s.invoke({ metadata: { truncated: false } });
  await s.invoke({ metadata: { exit: 1 } });
  await s.invoke({ metadata: { exit: 1, truncated: true } });
  await s.invoke({ output: 'unknown format' });
  const failure = { tool: 'bash', sessionID: 'session', callID: 'tool-error' };
  await s.hooks['tool.execute.before'](failure, { args: {} });
  await s.hooks.event({ event: { type: 'message.part.updated', properties: { part: {
    type: 'tool', tool: 'bash', sessionID: 'session', callID: 'tool-error', state: { status: 'error' } } } } });
  const report = summarizeEvents(await s.log());
  assert.equal(report.counts.total_calls, 9);
  assert.equal(report.counts.applied, 1);
  assert.equal(report.counts.fallback, 2);
  assert.equal(report.counts.skip, 5);
  assert.equal(report.counts.runtime_failed, 1);
  assert.equal(report.counts.unfinished, 0);
  assert.equal(report.reasons.command_not_allowlisted, 1);
  assert.equal(report.tool_output_tokens, null);
});

test('baseline observation preserves every byte; core errors and tiny budgets have explicit outcomes', async t => {
  const baseline = await setup(t, { mode: 'observe' });
  assert.equal((await baseline.invoke()).output.output, raw);
  assert.equal(summarizeEvents(await baseline.log()).counts.observed, 1);
  const broken = await setup(t, { guard: () => { throw new Error('core broken'); } });
  assert.equal((await broken.invoke()).output.output, raw);
  assert.equal(summarizeEvents(await broken.log()).reasons.core_execution_failed, 1);
  const budget = await setup(t, { maxOutputChars: 1 });
  assert.equal((await budget.invoke()).output.output, raw);
  assert.equal(summarizeEvents(await budget.log()).counts.fallback, 1);
});

test('recall is discoverable, hash checked, and audited including a tampered raw file', async t => {
  const s = await setup(t);
  const { output } = await s.invoke();
  const header = JSON.parse(output.output.split('\n')[0]);
  assert.match(header.recall_command, /recall.mjs.*START END/);
  assert(header.original_lines > 50);
  const result = await recallWithAudit(header.receipt, 1, 10);
  assert.equal(result.audit_recorded, true);
  const receipt = JSON.parse(await readFile(header.receipt, 'utf8'));
  await writeFile(join(s.directory, '.contextguard/evidence', receipt.raw_file), 'tampered');
  await assert.rejects(recallWithAudit(header.receipt, 1, 10), /integrity mismatch/);
  const report = summarizeEvents(await s.log());
  assert.equal(report.counts.recalls, 1);
  assert.equal(report.counts.recall_failures, 1);
  await writeFile(header.receipt, '{}');
  await assert.rejects(recallWithAudit(header.receipt), /Receipt integrity/);
});

test('unavailable audit storage never permits compression', async t => {
  let errors = 0;
  const s = await setup(t, { evidenceDirectory: '/dev/null/blocked', onAuditError: () => { errors++; } });
  assert.equal((await s.invoke()).output.output, raw);
  assert(errors > 0);
});

test('partial and conflicting telemetry is rejected, duplicate delivery is not counted twice', async t => {
  const s = await setup(t);
  for (let i = 0; i < 2; i++) await s.hooks.event({ event: { type: 'session.status',
    properties: { sessionID: 's', status: { type: 'retry', attempt: 1, next: 12345 } } } });
  await s.hooks['tool.execute.before']({ sessionID: 's', callID: 'c', tool: 'bash' }, { args: {} });
  const events = await s.log();
  const text = events.map(x => JSON.stringify(x)).join('\n');
  assert.equal(parseEvents(text + '\n' + text).length, events.length);
  assert.equal(summarizeEvents(events).counts.unfinished, 1);
  assert.equal(summarizeEvents(events).counts.retries, 1);
  assert.throws(() => parseEvents(text + '\n{"partial":'), /Invalid telemetry/);
  assert.throws(() => parseEvents(text + '\n' + JSON.stringify({ ...events[0], event: 'changed' })), /Conflicting/);
});
