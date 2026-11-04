import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const integer = (x, name) => { if (!Number.isSafeInteger(x) || x < 0) throw new Error(`Missing/invalid ${name}`); return x; };

/** Import captured request/response usage. No character-to-token or billing conversion. */
export function importUsage(records, { evidenceKind, expectedModel, expectedRequests, expectedResponseModel }) {
  if (!['synthetic', 'measured_online'].includes(evidenceKind)) throw new Error('Explicit usage evidence kind required');
  if (evidenceKind === 'measured_online' && !expectedResponseModel) throw new Error('Expected provider response model required');
  const seen = new Map(), charges = [];
  for (const r of records) {
    if (r.evidence_kind !== evidenceKind || r.model !== expectedModel) throw new Error('Usage evidence/model mismatch');
    if (!r.request_id || !r.response || !['primary', 'summary', 'retrieval', 'retry'].includes(r.category)) throw new Error('Usage requires request ID, raw response and one category');
    if (expectedResponseModel && r.response.model !== expectedResponseModel) throw new Error('Provider response model mismatch');
    if (seen.has(r.request_id)) {
      if (JSON.stringify(seen.get(r.request_id)) !== JSON.stringify(r)) throw new Error('Conflicting request usage');
      continue;
    }
    seen.set(r.request_id, r);
    const u = r.response.usage;
    if (!u) throw new Error('Provider usage missing; do not substitute zero');
    const input = integer(u.prompt_tokens, 'prompt_tokens');
    const cached = integer(u.prompt_tokens_details?.cached_tokens, 'cached_tokens');
    if (cached > input) throw new Error('Cached input exceeds total input');
    const output = integer(u.completion_tokens, 'completion_tokens');
    if (!r.cost || !Number.isFinite(r.cost.usd) || r.cost.usd < 0) throw new Error('Explicit cost/estimate required');
    if (evidenceKind === 'synthetic' ? r.cost.source !== 'synthetic' : !['provider_billed', 'rate_card_estimate'].includes(r.cost.source)) throw new Error('Invalid cost source for usage evidence');
    if (evidenceKind === 'measured_online' && !r.cost.evidence_ref) throw new Error('Bill or rate-card evidence reference required');
    charges.push({ request_id: r.request_id, category: r.category, cost_usd: r.cost.usd, cost_source: r.cost.source,
      input_uncached_tokens: input - cached, input_cached_tokens: cached, output_tokens: output,
      usage_sha256: createHash('sha256').update(JSON.stringify(r.response)).digest('hex'),
      cost_evidence_ref: r.cost.evidence_ref ?? null });
  }
  if (!Array.isArray(expectedRequests) || new Set(expectedRequests).size !== expectedRequests.length ||
      expectedRequests.length !== seen.size || expectedRequests.some(id => !seen.has(id))) throw new Error('Request inventory and usage coverage differ');
  return charges;
}

export function readUsage(path, options) {
  const bytes = readFileSync(path);
  const records = bytes.toString('utf8').split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
  return { charges: importUsage(records, options), source_file_sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function inspectOpenCodeSteps(text) {
  const events = text.split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
  const steps = new Map();
  for (const e of events) if (e.type === 'step_finish') {
    const t = e.part?.tokens;
    if (!t || !e.part?.id) throw new Error('Incomplete OpenCode usage step');
    const value = { id: e.part.id, input_uncached_tokens: integer(t.input, 'input') + integer(t.cache?.write, 'cache.write'),
      input_cached_tokens: integer(t.cache?.read, 'cache.read'),
      output_tokens: integer(t.output, 'output') + integer(t.reasoning, 'reasoning'),
      cache_write_tokens: t.cache.write, reasoning_tokens: t.reasoning, opencode_estimated_cost: e.part.cost };
    if (steps.has(value.id) && JSON.stringify(steps.get(value.id)) !== JSON.stringify(value)) throw new Error('Conflicting OpenCode step');
    steps.set(value.id, value);
  }
  return { coverage: 'session_steps_only', complete_run_billing: false, steps: [...steps.values()],
    boundary: 'OpenCode step_finish can omit auxiliary title/summary requests. Import complete provider request usage for total run accounting. Its cost is not an invoice.' };
}
