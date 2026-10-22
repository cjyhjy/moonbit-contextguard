#!/usr/bin/env node
/** Strict offline accountant for paired task ledgers. No network or model calls. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const categories = ['primary', 'summary', 'retrieval', 'retry'];
const tokenKeys = ['input_uncached_tokens', 'input_cached_tokens', 'output_tokens'];
const kinds = ['synthetic', 'measured_online', 'offline_replay'];
const sources = ['synthetic', 'provider_billed', 'rate_card_estimate'];
const check = (ok, context, message) => { if (!ok) throw new Error(`${context}: ${message}`); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const rounded = value => Number(value.toFixed(12));
const zeroUsage = () => Object.fromEntries(tokenKeys.map(key => [key, 0]));
function validateCost(value, kind, context) {
  check(nonnegative(value.cost_usd), context, 'cost_usd must be finite and nonnegative');
  check(sources.includes(value.cost_source), context, 'invalid cost_source');
  if (kind === 'synthetic') check(value.cost_source === 'synthetic', context, 'synthetic data must declare synthetic cost_source');
  if (kind === 'offline_replay') check(value.cost_source === 'rate_card_estimate', context, 'offline replay costs must be estimates');
  if (kind === 'measured_online') check(value.cost_source !== 'synthetic', context, 'measured online data cannot claim synthetic costs');
  for (const key of tokenKeys) check(Number.isSafeInteger(value[key]) && value[key] >= 0, context, `${key} must be a nonnegative safe integer (cached and uncached input are disjoint)`);
}
export function parseLedger(text) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { throw new Error(`line ${index + 1}: invalid JSON`); }
  });
}
export function accountLedger(records) {
  check(Array.isArray(records) && records.length > 0, 'ledger', 'must contain records');
  const offline = new Map(), runs = [], runIds = new Set(), pairs = new Map();
  records.forEach((record, index) => {
    const context = `record ${index + 1}`;
    check(record && typeof record === 'object' && !Array.isArray(record), context, 'must be an object');
    check(record.schema_version === 1, context, 'schema_version must be 1');
    check(kinds.includes(record.evidence_kind), context, 'invalid evidence_kind');
    if (record.record_type === 'offline_cost') {
      check(nonempty(record.optimization_id) && !offline.has(record.optimization_id), context, 'optimization_id must be unique and nonempty');
      check(Number.isSafeInteger(record.amortization_runs) && record.amortization_runs > 0, context, 'amortization_runs must be positive integer');
      validateCost(record, record.evidence_kind, context);
      offline.set(record.optimization_id, { ...record, allocated_runs: 0 });
      return;
    }
    check(record.record_type === 'run', context, 'record_type must be run or offline_cost');
    for (const key of ['pair_id', 'run_id', 'task_id', 'model']) check(nonempty(record[key]), context, `${key} required`);
    check(!runIds.has(record.run_id), context, 'duplicate run_id'); runIds.add(record.run_id);
    check(/^[a-f0-9]{64}$/.test(record.input_sha256), context, 'input_sha256 must be lowercase SHA-256');
    check(record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings), context, 'settings object required for pair comparability');
    check(['original', 'guard'].includes(record.condition), context, 'condition must be original or guard');
    check(['completed', 'failed'].includes(record.status), context, 'status must be completed or failed');
    check(typeof record.task_success === 'boolean' || record.task_success === null, context, 'task_success must be boolean or null (unmeasured)');
    check(record.status !== 'failed' || record.task_success !== true, context, 'failed run cannot claim task_success');
    check(nonnegative(record.duration_ms), context, 'duration_ms must be finite and nonnegative');
    check(Array.isArray(record.charges) && record.charges.length > 0, context, 'charges must contain primary and any auxiliary calls');
    check(record.charges.some(charge => charge.category === 'primary'), context, 'primary charge required, including zero-cost runs');
    record.charges.forEach((charge, chargeIndex) => {
      check(charge && categories.includes(charge.category), context, `charge ${chargeIndex + 1}: invalid category`);
      validateCost(charge, record.evidence_kind, `${context} charge ${chargeIndex + 1}`);
      check(!('amortization_runs' in charge), context, 'amortization is only declared on standalone offline_cost records');
    });
    check(Array.isArray(record.offline_optimization_ids) && record.offline_optimization_ids.every(nonempty), context, 'offline_optimization_ids array required');
    check(new Set(record.offline_optimization_ids).size === record.offline_optimization_ids.length, context, 'duplicate offline optimization reference');
    const pair = pairs.get(record.pair_id) ?? {};
    check(!pair[record.condition], context, 'duplicate condition in pair'); pair[record.condition] = record;
    pairs.set(record.pair_id, pair); runs.push(record);
  });
  for (const [pairId, pair] of pairs) {
    check(pair.original && pair.guard, pairId, 'requires exactly one original and one guard run');
    for (const key of ['task_id', 'input_sha256', 'model', 'settings', 'evidence_kind']) check(same(pair.original[key], pair.guard[key]), pairId, `pair mismatch: ${key}`);
  }
  const accounted = runs.map(run => {
    const byCategory = Object.fromEntries([...categories, 'offline_optimization'].map(category => [category, 0]));
    const usage = zeroUsage(); const costSources = new Set();
    for (const charge of run.charges) {
      byCategory[charge.category] += charge.cost_usd; costSources.add(charge.cost_source);
      for (const key of tokenKeys) usage[key] += charge[key];
    }
    for (const id of run.offline_optimization_ids) {
      const optimization = offline.get(id);
      check(optimization, run.run_id, `unknown offline optimization ${id}`);
      check(optimization.evidence_kind === run.evidence_kind, run.run_id, `offline optimization evidence_kind mismatch: ${id}`);
      optimization.allocated_runs += 1;
      check(optimization.allocated_runs <= optimization.amortization_runs, id, 'allocations exceed declared amortization_runs');
      byCategory.offline_optimization += optimization.cost_usd / optimization.amortization_runs;
      costSources.add(optimization.cost_source);
    }
    return { run_id: run.run_id, pair_id: run.pair_id, condition: run.condition, evidence_kind: run.evidence_kind,
      status: run.status, task_success: run.task_success, duration_ms: run.duration_ms, recorded_online_usage: usage,
      cost_sources: [...costSources].sort(), costs_usd: Object.fromEntries(Object.entries(byCategory).map(([key, amount]) => [key, rounded(amount)])),
      direct_cost_usd: rounded(categories.reduce((sum, category) => sum + byCategory[category], 0)),
      allocated_total_cost_usd: rounded(Object.values(byCategory).reduce((sum, amount) => sum + amount, 0)) };
  });
  const paired = [...pairs.entries()].map(([pairId, pair]) => {
    const original = accounted.find(run => run.run_id === pair.original.run_id);
    const guarded = accounted.find(run => run.run_id === pair.guard.run_id);
    return { pair_id: pairId, evidence_kind: pair.original.evidence_kind, task_id: pair.original.task_id,
      original_run_id: original.run_id, guard_run_id: guarded.run_id,
      original_allocated_cost_usd: original.allocated_total_cost_usd, guard_allocated_cost_usd: guarded.allocated_total_cost_usd,
      guard_minus_original_cost_usd: rounded(guarded.allocated_total_cost_usd - original.allocated_total_cost_usd),
      original_task_success: original.task_success, guard_task_success: guarded.task_success,
      task_success_comparison: original.task_success === null || guarded.task_success === null ? 'not_measured' : original.task_success === guarded.task_success ? 'same_recorded_outcome' : 'different_recorded_outcome' };
  });
  const onlineRuns = accounted.filter(run => run.evidence_kind === 'measured_online');
  const onlineBilled = onlineRuns.length > 0 && onlineRuns.every(run => run.cost_sources.every(source => source === 'provider_billed'));
  return { schema_version: 1, boundary: 'This tool validates and totals submitted ledger data; it does not execute tasks, verify provider bills, estimate token counts, or establish causal quality/cost improvements.',
    online_model_evaluation: onlineRuns.length ? 'records_provided_not_independently_verified' : 'not_run',
    real_cost_evaluation: onlineBilled ? 'provider_billed_records_provided_not_independently_verified' : 'not_run',
    counts: { records: records.length, pairs: pairs.size, runs: runs.length, actual_online_runs: onlineRuns.length, synthetic_runs: runs.filter(run => run.evidence_kind === 'synthetic').length, offline_replay_runs: runs.filter(run => run.evidence_kind === 'offline_replay').length },
    offline_costs: [...offline.values()].map(value => ({ optimization_id: value.optimization_id, evidence_kind: value.evidence_kind, cost_source: value.cost_source,
      incurred_cost_usd: value.cost_usd, amortization_runs: value.amortization_runs, allocated_runs: value.allocated_runs,
      allocated_cost_usd: rounded(value.cost_usd * value.allocated_runs / value.amortization_runs),
      unallocated_cost_usd: rounded(value.cost_usd * (value.amortization_runs - value.allocated_runs) / value.amortization_runs),
      recorded_offline_usage: Object.fromEntries(tokenKeys.map(key => [key, value[key]])) })),
    runs: accounted, pairs: paired };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error('Usage: node evaluation/ledger.mjs INPUT.jsonl [--output REPORT.json]');
    const result = JSON.stringify(accountLedger(parseLedger(readFileSync(path, 'utf8'))), null, 2) + '\n';
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0) { if (!process.argv[outputIndex + 1]) throw new Error('--output requires a path'); writeFileSync(process.argv[outputIndex + 1], result); }
    else process.stdout.write(result);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
