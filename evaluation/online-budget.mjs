import { mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const rateCard = Object.freeze({
  checked_date: '2026-11-03', model: 'deepseek-flash', published_version: 'DeepSeek-V4.1-Flash-1017',
  basis: 'official_peak_rate_estimate', context_limit: 1048576, max_output_tokens: 4096,
  CNY: { input: 2, cached: 0.04, output: 8, source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' },
  USD: { input: 0.30, cached: 0.006, output: 1.20, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
});

const integer = n => Number.isSafeInteger(n) && n >= 0;
export function costNano(usage, currency) {
  const r = rateCard[currency];
  if (!r || !['input_uncached_tokens', 'input_cached_tokens', 'output_tokens'].every(k => integer(usage[k])))
    throw new Error('Invalid native-currency usage');
  // Nanocurrency units keep the entire budget calculation integral.
  const cost = usage.input_uncached_tokens * Math.round(r.input * 1000)
    + usage.input_cached_tokens * Math.round(r.cached * 1000) + usage.output_tokens * Math.round(r.output * 1000);
  if (!integer(cost)) throw new Error('Cost exceeds exact integer range');
  return cost;
}

/** Fail-closed, persistent reservation book. No credential or network access. */
export class BudgetBook {
  constructor(path, { currency, available, totalLimit = currency === 'CNY' ? 20 : 3,
    runLimit = currency === 'CNY' ? 3 : 0.50, maxRequests = 12 } = {}) {
    if (!rateCard[currency] || ![available, totalLimit, runLimit].every(x => Number.isFinite(x) && x > 0)
      || !Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error('Invalid budget configuration');
    if (existsSync(path)) throw new Error('Existing budget must not be overwritten or silently resumed');
    this.path = path;
    this.reserveNano = costNano({ input_uncached_tokens: rateCard.context_limit, input_cached_tokens: 0,
      output_tokens: rateCard.max_output_tokens }, currency);
    this.state = { schema_version: 1, currency, total_limit_nano: Math.round(Math.min(available, totalLimit) * 1e9),
      authorized_limit_nano: Math.round(totalLimit * 1e9), run_limit_nano: Math.round(runLimit * 1e9),
      max_requests_per_run: maxRequests, maximum_request_reservation_nano: this.reserveNano,
      rate_card: rateCard, halted: null, attempts: [] };
    this.save();
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  exposure(runId) {
    return this.state.attempts.filter(x => !runId || x.run_id === runId)
      .reduce((n, x) => n + (x.status === 'settled' ? x.cost_nano : x.reserved_nano), 0);
  }
  reserve(runId, category) {
    if (this.state.halted) throw new Error('Budget halted after uncertain request');
    if (typeof runId !== 'string' || !runId || !['primary', 'auxiliary', 'probe'].includes(category)) throw new Error('Invalid request identity');
    if (this.state.attempts.filter(x => x.run_id === runId).length >= this.state.max_requests_per_run)
      throw new Error('Run request limit reached');
    if (this.exposure() + this.reserveNano > this.state.total_limit_nano) throw new Error('Total budget reservation limit reached');
    if (this.exposure(runId) + this.reserveNano > this.state.run_limit_nano) throw new Error('Run budget reservation limit reached');
    const attempt = { attempt_id: randomUUID(), run_id: runId, category, status: 'reserved',
      started_at: new Date().toISOString(), reserved_nano: this.reserveNano };
    this.state.attempts.push(attempt); this.save(); return { ...attempt };
  }
  settle(attemptId, response) {
    const a = this.state.attempts.find(x => x.attempt_id === attemptId);
    if (!a || a.status !== 'reserved') throw new Error('Reservation cannot be settled twice');
    if (!response.id || this.state.attempts.some(x => x.request_id === response.id)) throw new Error('Duplicate provider request ID');
    const nano = costNano(response.normalized_usage, this.state.currency);
    if (nano > a.reserved_nano) throw new Error('Provider usage exceeds reservation');
    Object.assign(a, { status: 'settled', request_id: response.id, model: response.model,
      system_fingerprint: response.system_fingerprint, usage: response.normalized_usage,
      cost_nano: nano, finished_at: new Date().toISOString(), cost_source: 'rate_card_estimate' });
    this.save(); return { ...a };
  }
  uncertain(attemptId, reason) {
    const a = this.state.attempts.find(x => x.attempt_id === attemptId);
    if (a && a.status !== 'settled') Object.assign(a, { status: 'uncertain', reason, finished_at: new Date().toISOString() });
    this.state.halted = reason; this.save();
  }
  summary() {
    const settled = this.state.attempts.filter(x => x.status === 'settled');
    return { currency: this.state.currency, cost_source: 'rate_card_estimate', rate_basis: rateCard.basis,
      total_limit: this.state.total_limit_nano / 1e9, settled_cost: settled.reduce((n,x) => n+x.cost_nano, 0)/1e9,
      reserved_or_uncertain_cost: (this.exposure() - settled.reduce((n,x) => n+x.cost_nano,0))/1e9,
      requests: this.state.attempts.length, settled_requests: settled.length, halted: this.state.halted };
  }
}
