import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEvents(text) {
  const unique = new Map();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error(`Invalid telemetry JSON at line ${index + 1}`); }
    if (event.schema_version !== 1 || !event.event_id || !event.run_id || !event.event) throw new Error(`Invalid telemetry at line ${index + 1}`);
    if (unique.has(event.event_id) && JSON.stringify(unique.get(event.event_id)) !== JSON.stringify(event)) throw new Error('Conflicting duplicate event');
    unique.set(event.event_id, event);
  }
  return [...unique.values()];
}

export function summarizeEvents(events) {
  const calls = new Map(), reasons = {}, loaded = new Set(), retries = new Set();
  let recalls = 0, recallFailures = 0;
  for (const e of events) {
    if (e.event === 'plugin.loaded') loaded.add(e.instance_id);
    if (e.event === 'recall.completed') recalls++;
    if (e.event === 'recall.failed') recallFailures++;
    if (e.event === 'session.retry') retries.add(JSON.stringify([e.run_id, e.session_id, e.attempt, e.next]));
    if (!e.event.startsWith('tool.')) continue;
    if (!e.session_id || !e.call_id) throw new Error('Tool observation lacks session/call identity');
    const key = JSON.stringify([e.run_id, e.session_id, e.call_id]);
    const call = calls.get(key) ?? { run_id: e.run_id, session_id: e.session_id, call_id: e.call_id, tool: e.tool };
    if (e.event === 'tool.started') call.started = true;
    if (e.event === 'tool.finished') {
      if (call.hook && JSON.stringify(call.hook) !== JSON.stringify(e)) throw new Error('Duplicate tool.execute.after observation');
      call.hook = e;
    }
    if (e.event === 'tool.runtime') call.runtime = e;
    calls.set(key, call);
  }
  const counts = { total_calls: calls.size, started: 0, after_hook: 0, contract_eligible: 0,
    applied: 0, fallback: 0, skip: 0, error: 0, observed: 0, runtime_failed: 0, unfinished: 0,
    missing_start: 0, delivery_mismatch: 0, recalls, recall_failures: recallFailures,
    recall_tool_attempts: 0, recall_tool_failures: 0, retries: retries.size };
  let inputChars = 0, visibleChars = 0;
  for (const c of calls.values()) {
    if (c.started) counts.started++; else counts.missing_start++;
    if (c.runtime?.status === 'error') counts.runtime_failed++;
    if (!c.hook && !c.runtime) counts.unfinished++;
    if (!c.hook) continue;
    counts.after_hook++;
    if (c.hook.contract_eligible) counts.contract_eligible++;
    if (!['applied', 'fallback', 'skip', 'error', 'observed'].includes(c.hook.outcome)) throw new Error('Invalid hook outcome');
    counts[c.hook.outcome]++;
    if (c.hook.reason === 'recall_cli') {
      counts.recall_tool_attempts++;
      if (c.hook.exit_code !== 0) counts.recall_tool_failures++;
    }
    reasons[c.hook.reason] = (reasons[c.hook.reason] ?? 0) + 1;
    inputChars += c.hook.input_chars ?? 0;
    visibleChars += c.hook.visible_chars ?? 0;
    if (c.runtime?.visible_sha256 && c.runtime.visible_sha256 !== c.hook.visible_sha256) counts.delivery_mismatch++;
  }
  return { schema_version: 1, loaded_instances: loaded.size, counts, reasons,
    chars: { unit: 'utf16_code_units', hook_input: inputChars, hook_visible: visibleChars, net_reduction: inputChars - visibleChars },
    tool_output_tokens: null, tokenizer: null,
    boundary: 'Counts cover observed tool calls only. Missing starts, unfinished calls and delivery mismatches are explicit. Characters are not tokens or billed savings.',
    calls: [...calls.values()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(summarizeEvents(parseEvents(readFileSync(process.argv[2], 'utf8'))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
