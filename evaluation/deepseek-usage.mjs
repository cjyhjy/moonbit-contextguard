import { createHash } from 'node:crypto';
import { rateCard, costNano } from './online-budget.mjs';

const requiredInteger = (x, label) => {
  if (!Number.isSafeInteger(x) || x < 0) throw new Error(`Missing/invalid provider ${label}`);
  return x;
};

export function normalizeDeepSeekUsage(u) {
  if (!u) throw new Error('Provider usage missing');
  const input = requiredInteger(u.prompt_tokens, 'prompt_tokens');
  const cached = requiredInteger(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens, 'cached_tokens');
  const miss = requiredInteger(u.prompt_cache_miss_tokens, 'prompt_cache_miss_tokens');
  const hit = requiredInteger(u.prompt_cache_hit_tokens, 'prompt_cache_hit_tokens');
  const output = requiredInteger(u.completion_tokens, 'completion_tokens');
  if (cached !== hit || hit + miss !== input || u.total_tokens !== input + output) throw new Error('Inconsistent provider token totals');
  if (input > rateCard.context_limit || output > rateCard.max_output_tokens) throw new Error('Provider token bound exceeded');
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
  requiredInteger(reasoning, 'reasoning_tokens');
  if (reasoning > output) throw new Error('Reasoning tokens exceed completion tokens');
  return { input_uncached_tokens: miss, input_cached_tokens: hit, output_tokens: output, reasoning_tokens: reasoning };
}

/** DeepSeek places usage on the final content chunk, not a separate usage-only chunk. */
export function parseDeepSeekStream(text) {
  const chunks = []; let done = false;
  for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = block.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
    if (!data) continue;
    if (done) throw new Error('Data after provider DONE');
    if (data.trim() === '[DONE]') { done = true; continue; }
    const c = JSON.parse(data);
    if (c.error) throw new Error('Provider stream error');
    chunks.push(c);
  }
  if (!done || !chunks.length || !chunks.some(x => x.choices?.some(c => c.finish_reason))) throw new Error('Incomplete provider stream');
  const last = chunks.at(-1);
  if (typeof last.id !== 'string' || !last.id || last.model !== rateCard.model || !last.system_fingerprint)
    throw new Error('Provider identity missing or model mismatch');
  for (const c of chunks) {
    if (c.id !== last.id || c.model !== last.model || c.system_fingerprint !== last.system_fingerprint) throw new Error('Provider identity changed within request');
    if (c.usage && JSON.stringify(c.usage) !== JSON.stringify(last.usage)) throw new Error('Conflicting provider usage chunks');
  }
  const normalized = normalizeDeepSeekUsage(last.usage);
  const calls = new Map(); let content = '';
  for (const chunk of chunks) for (const choice of chunk.choices ?? []) {
    if (choice.index !== 0) throw new Error('Only one completion choice is supported');
    content += choice.delta?.content ?? '';
    for (const delta of choice.delta?.tool_calls ?? []) {
      const call = calls.get(delta.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (delta.id) call.id = delta.id;
      if (delta.function?.name) call.function.name += delta.function.name;
      call.function.arguments += delta.function?.arguments ?? '';
      calls.set(delta.index, call);
    }
  }
  return { id: last.id, model: last.model, system_fingerprint: last.system_fingerprint,
    usage: last.usage, normalized_usage: normalized, finish_reason: last.choices[0]?.finish_reason,
    message: { role: 'assistant', content: content || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) },
    raw_stream_sha256: createHash('sha256').update(text).digest('hex') };
}

/** Native-currency accounting is deliberately separate from the legacy USD ledger. */
export function accountNativeRequests(attempts, expectedAttemptIds, currency) {
  if (!['CNY', 'USD'].includes(currency) || new Set(expectedAttemptIds).size !== expectedAttemptIds.length)
    throw new Error('Invalid accounting inventory');
  const ids = new Set(), providerIds = new Set();
  const totals = { input_uncached_tokens: 0, input_cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let amount = 0;
  for (const a of attempts) {
    if (!expectedAttemptIds.includes(a.attempt_id) || ids.has(a.attempt_id) || providerIds.has(a.request_id)
      || a.status !== 'settled' || a.model !== rateCard.model || !a.request_id || a.cost_source !== 'rate_card_estimate')
      throw new Error('Incomplete or conflicting native request ledger');
    ids.add(a.attempt_id); providerIds.add(a.request_id);
    if (a.cost_nano !== costNano(a.usage, currency)) throw new Error('Native ledger cost does not match its rate card');
    for (const k of Object.keys(totals)) totals[k] += requiredInteger(a.usage[k], k);
    amount += requiredInteger(a.cost_nano, 'cost_nano');
  }
  if (ids.size !== expectedAttemptIds.length) throw new Error('Request inventory is not fully accounted');
  return { currency, requests: ids.size, usage: totals, peak_rate_estimated_cost: amount/1e9,
    cost_source: 'rate_card_estimate', rate_source: rateCard[currency].source };
}
