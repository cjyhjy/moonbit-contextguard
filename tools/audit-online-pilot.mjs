#!/usr/bin/env node
// Offline evidence reconciliation. Requires the private artifacts of this pilot.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { integrationInputs } from '../evaluation/local-acceptance.mjs';
import { tasks, gradeTask } from '../evaluation/tasks.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const r=await readJSON(join(root,'reports/online-pilot.json'));
const base=r.artifacts_directory;
assert.equal(r.status,'completed');assert.equal(r.source_unchanged,true);
assert.equal(r.integration_inputs_sha256,await integrationInputs());
const budget=await readJSON(join(base,'budget.json'));
const ledger=await readJSON(join(base,'ledger-native.json'));
const plan=await readJSON(join(base,'pairs/plan.json'));
assert.deepEqual(ledger.attempts,budget.attempts);
assert.equal(budget.halted,null);assert.equal(r.results.length,10);
const inventory=(await readFile(join(base,'requests/inventory.jsonl'),'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));
const forwards=inventory.filter(x=>x.event==='forwarding');
assert.equal(forwards.length,budget.attempts.length);
assert.equal(new Set(forwards.map(x=>x.attempt_id)).size,forwards.length);
let totalNano=0;const providerIds=new Set(),fingerprints=new Set();
for(const a of budget.attempts){
  assert.equal(a.status,'settled');assert(!providerIds.has(a.request_id));providerIds.add(a.request_id);
  const dir=join(base,'requests',a.attempt_id),capture=await readJSON(join(dir,'capture.json'));
  const body=await readJSON(join(dir,'request.json'));
  assert.equal(hash(JSON.stringify(body)),capture.outbound_request_sha256);
  assert.equal(forwards.find(x=>x.attempt_id===a.attempt_id).outbound_request_sha256,capture.outbound_request_sha256);
  assert.equal(body.model,'deepseek-flash');assert.equal(body.thinking.type,'disabled');
  assert.equal(body.temperature,0.2);assert(body.max_tokens<=4096);
  const raw=await readFile(join(dir,'response.sse'),'utf8');
  assert.equal(hash(raw),capture.response.raw_stream_sha256);
  const data=raw.replaceAll('\r\n','\n').split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim());
  assert.equal(data.pop(),'[DONE]');
  const chunks=data.map(x=>JSON.parse(x)),last=chunks.at(-1),u=last.usage;
  assert.equal(last.id,a.request_id);assert.equal(last.model,'deepseek-flash');
  assert.equal(last.system_fingerprint,a.system_fingerprint);fingerprints.add(last.system_fingerprint);
  assert.equal(u.prompt_tokens,u.prompt_cache_hit_tokens+u.prompt_cache_miss_tokens);
  assert.equal(u.prompt_tokens_details.cached_tokens,u.prompt_cache_hit_tokens);
  assert.equal(u.total_tokens,u.prompt_tokens+u.completion_tokens);
  assert.deepEqual(a.usage,{input_uncached_tokens:u.prompt_cache_miss_tokens,input_cached_tokens:u.prompt_cache_hit_tokens,
    output_tokens:u.completion_tokens,reasoning_tokens:u.completion_tokens_details?.reasoning_tokens??0});
  const p=budget.rate_card[budget.currency];
  const cost=u.prompt_cache_miss_tokens*Math.round(p.input*1000)+u.prompt_cache_hit_tokens*Math.round(p.cached*1000)+u.completion_tokens*Math.round(p.output*1000);
  assert.equal(cost,a.cost_nano);assert(cost<=a.reserved_nano);totalNano+=cost;
}
assert(totalNano<=budget.total_limit_nano);assert.equal(totalNano/1e9,r.accounting.peak_rate_estimated_cost);
for(const run of r.results){
  const p=plan.runs.find(x=>x.run_id===run.run_id);assert(p);assert.equal(p.input_sha256,run.input_sha256);
  const task=tasks.find(x=>x.id===run.task_id);assert.deepEqual(await gradeTask(task,p.workspace),run.grade);
  assert.equal(run.task_success,run.grade.passed&&run.protocol.passed);
  const log=(await readFile(join(p.workspace,'.contextguard/evidence/events.jsonl'),'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));
  const calls=log.filter(x=>x.event==='tool.finished');
  const delivered=new Map();
  for(const a of budget.attempts.filter(x=>x.run_id===run.run_id)){
    const body=await readJSON(join(base,'requests',a.attempt_id,'request.json'));
    for(const m of body.messages)if(m.role==='tool')delivered.set(m.tool_call_id,m.content);
  }
  for(const call of calls){assert.equal(typeof delivered.get(call.call_id),'string');assert.equal(hash(delivered.get(call.call_id)),call.visible_sha256);}
  const native=(await readFile(join(base,'state',run.run_id,'opencode.jsonl'),'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));
  assert.equal(new Set(native.filter(x=>x.type==='tool_use').map(x=>x.part.callID)).size,run.counts.total_calls);
  assert.equal(calls.length,run.counts.after_hook);
}
const aggregate=condition=>{
  const rows=r.results.filter(x=>x.condition===condition);
  const sum=fn=>rows.reduce((n,x)=>n+fn(x),0);
  return {runs:rows.length,successes:sum(x=>+x.task_success),requests:sum(x=>x.request_count),
    input_tokens:sum(x=>x.accounting.usage.input_uncached_tokens+x.accounting.usage.input_cached_tokens),
    uncached_input_tokens:sum(x=>x.accounting.usage.input_uncached_tokens),cached_input_tokens:sum(x=>x.accounting.usage.input_cached_tokens),
    output_tokens:sum(x=>x.accounting.usage.output_tokens),peak_rate_estimated_cost:sum(x=>x.accounting.peak_rate_estimated_cost),
    duration_ms:sum(x=>x.duration_ms),tool_calls:sum(x=>x.counts.total_calls),eligible:sum(x=>x.counts.contract_eligible),
    applied:sum(x=>x.counts.applied),fallback:sum(x=>x.counts.fallback),recalls:sum(x=>x.counts.recalls),retries:sum(x=>x.counts.retries),
    tool_char_input:sum(x=>x.chars.hook_input),tool_char_visible:sum(x=>x.chars.hook_visible),tool_char_reduction:sum(x=>x.chars.net_reduction)};
};
const original=aggregate('original'),guard=aggregate('guard');
const reduction=(a,b)=>(a-b)/a;
const applied=r.pairs.filter(x=>x.guard_counts.applied>0);
const audit={schema_version:1,status:'passed',generated_at:new Date().toISOString(),experiment_id:r.experiment_id,
  source_sha256:r.integration_inputs_sha256,requests_reconciled:budget.attempts.length,tool_calls_reconciled:original.tool_calls+guard.tool_calls,
  provider_fingerprints:[...fingerprints],currency:budget.currency,original,guard,
  descriptive_changes:{input_token_reduction_fraction:reduction(original.input_tokens,guard.input_tokens),
    peak_rate_cost_reduction_fraction:reduction(original.peak_rate_estimated_cost,guard.peak_rate_estimated_cost),
    triggered_tasks:applied.length,total_tasks:r.pairs.length,triggered_subset_input_token_reduction_fraction:
      reduction(applied.reduce((n,x)=>n+x.original_usage.input_uncached_tokens+x.original_usage.input_cached_tokens,0),
        applied.reduce((n,x)=>n+x.guard_usage.input_uncached_tokens+x.guard_usage.input_cached_tokens,0))},
  all_requests:r.accounting,budget:r.budget,balance_observation:r.balance_observation,
  limitations:['Five controlled synthetic tasks, one pair each; not a real-project benchmark.',
    'Shared provider caching, order and stochastic outputs can affect price differences, including uncompressed controls.',
    'No spontaneous recall occurred; the separately prompted recall probe passed.',
    'No independently attributed billed amount; account balance did not change at the immediate check.',
    'Tool-output tokenizer is not validated; tool characters are not billed tokens.',
    'The model alias and backend fingerprint were recorded; weights are not an immutable local snapshot.']};
await writeFile(join(root,'reports/online-pilot-analysis.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
