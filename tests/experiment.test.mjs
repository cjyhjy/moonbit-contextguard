import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tasks, materializeTask, gradeTask } from '../evaluation/tasks.mjs';
import { prepareExperiment } from '../evaluation/prepare.mjs';
import { importUsage, inspectOpenCodeSteps } from '../evaluation/usage.mjs';
import { accountLedger } from '../evaluation/ledger.mjs';

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'contextguard-experiment-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}

test('paired preparation alternates order, preserves identical inputs, and never enables online execution', async t => {
  const base = await scratch(t);
  const plan = await prepareExperiment(join(base, 'pairs'));
  assert.equal(plan.runs.length, 10);
  assert.equal(plan.online_execution_ready, false);
  assert.deepEqual(plan.runs.slice(0, 4).map(x => x.condition), ['original', 'guard', 'guard', 'original']);
  for (let i = 0; i < plan.runs.length; i += 2) {
    assert.equal(plan.runs[i].input_sha256, plan.runs[i+1].input_sha256);
    assert.deepEqual(plan.runs[i].settings, plan.runs[i+1].settings);
    assert.notEqual(plan.runs[i].workspace, plan.runs[i+1].workspace);
  }
  await assert.rejects(prepareExperiment(join(base, 'pairs')), /EEXIST/);
  const second = await prepareExperiment(join(base, 'second-pairs'));
  assert(second.runs.every(x => !plan.runs.some(y => y.run_id === x.run_id || y.pair_id === x.pair_id)));
  assert.equal((await readFile(join(plan.runs[0].workspace, 'src/value.cjs'), 'utf8')).includes('a-b'), true);
});

test('external graders reject planted faults and test edits/deletions, accept only the corrected implementation', async t => {
  const base = await scratch(t);
  for (const task of tasks) {
    const directory = join(base, task.id); await materializeTask(task, directory);
    assert.equal((await gradeTask(task, directory)).passed, task.repair === null);
    if (task.repair) {
      const r = task.repair, target = join(directory, r.path);
      await writeFile(target, r.content ?? (await readFile(target, 'utf8')).replace(r.find, r.replace));
      assert.equal((await gradeTask(task, directory)).passed, true);
    }
    if (task.protected.length) {
      const target = join(directory, task.protected[0]);
      await writeFile(target, '// removed assertions');
      assert.equal((await gradeTask(task, directory)).reason, 'protected_test_modified');
      await rm(target);
      assert.equal((await gradeTask(task, directory)).reason, 'protected_test_missing');
    }
  }
});

const usage = (request_id = 'request-1') => ({ request_id, evidence_kind: 'synthetic', model: 'fixture', category: 'primary',
  response: { model: 'fixture', usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 25 }, completion_tokens: 20 } },
  cost: { usd: 0, source: 'synthetic' } });
const opts = { evidenceKind: 'synthetic', expectedModel: 'fixture', expectedRequests: ['request-1'] };

test('provider usage counts cached input once, includes auxiliary requests, and deduplicates identical delivery', () => {
  const r = usage();
  const result = importUsage([r, r], opts);
  assert.equal(result.length, 1); assert.equal(result[0].input_uncached_tokens, 75);
  assert.equal(result[0].input_cached_tokens, 25);
  const auxiliary = { ...usage('title-1'), category: 'summary' };
  assert.throws(() => importUsage([r], { ...opts, expectedRequests: ['request-1', 'title-1'] }), /coverage differ/);
  assert.equal(importUsage([r, auxiliary], { ...opts, expectedRequests: ['request-1', 'title-1'] }).length, 2);
});

test('unknown usage, missing cache accounting, conflicting request IDs and mislabeled billing are rejected', () => {
  for (const u of [{}, { prompt_tokens: 100, completion_tokens: 20 }, { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 101 }, completion_tokens: 20 }]) {
    assert.throws(() => importUsage([{ ...usage(), response: { usage: u } }], opts));
  }
  assert.throws(() => importUsage([usage(), { ...usage(), category: 'retry' }], opts), /Conflicting/);
  assert.throws(() => importUsage([{ ...usage(), cost: { usd: 1, source: 'provider_billed' } }], opts), /cost source/);
  const online = { ...usage(), evidence_kind: 'measured_online', cost: { usd: 1, source: 'provider_billed' } };
  assert.throws(() => importUsage([online], { ...opts, evidenceKind: 'measured_online', expectedResponseModel: 'fixture' }), /evidence reference/);
  assert.throws(() => importUsage([usage()], { ...opts, expectedResponseModel: 'other-model' }), /response model mismatch/);
});

test('OpenCode steps preserve cache-write/reasoning counts and remain partial billing evidence', () => {
  const event = { type: 'step_finish', part: { id: 'step', tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 5, write: 7 } }, cost: 0.01 } };
  const result = inspectOpenCodeSteps(JSON.stringify(event) + '\n' + JSON.stringify(event));
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].input_uncached_tokens, 17);
  assert.equal(result.steps[0].output_tokens, 23);
  assert.equal(result.complete_run_billing, false);
});

test('a provider request cannot be billed again under another run or category', () => {
  const charge = importUsage([usage()], opts)[0];
  const run = { schema_version: 1, record_type: 'run', evidence_kind: 'synthetic', pair_id: 'p', task_id: 't',
    input_sha256: 'a'.repeat(64), model: 'fixture', settings: {}, status: 'completed', task_success: true,
    duration_ms: 1, charges: [charge], offline_optimization_ids: [] };
  assert.throws(() => accountLedger([{ ...run, run_id: 'a', condition: 'original' }, { ...run, run_id: 'b', condition: 'guard' }]), /request_id must be unique/);
});
