import { createServer } from 'node:http';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parseDeepSeekStream } from './deepseek-usage.mjs';
import { rateCard } from './online-budget.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const privateWrite = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

/** Serializes all paid requests, including OpenCode title calls, through one budget. */
export async function startCaptureProxy({ directory, apiKey, book, upstream = 'https://api.deepseek.com',
  allowLoopbackFixture = false, requestTimeoutMs = 90000, onFatal = () => {}, onRecord = () => {} }) {
  const endpoint = new URL(upstream);
  if (!(endpoint.origin === 'https://api.deepseek.com' || allowLoopbackFixture && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1')
    || endpoint.username || endpoint.password || endpoint.search) throw new Error('Unexpected upstream endpoint');
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('Provider credential absent');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const localToken = randomBytes(32).toString('hex');
  const runs = new Map(), records = [], controllers = new Map();
  let queue = Promise.resolve(), stopped = false;
  const journal = item => appendFile(join(directory, 'inventory.jsonl'), JSON.stringify(item) + '\n', { mode: 0o600 });
  const failure = (res, code, message) => {
    if (!res.headersSent) res.writeHead(code, { 'content-type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: { message, type: 'contextguard_capture_error' } }));
  };
  const handle = async (runId, input, res) => {
    let attempt, capture;
    const controller = new AbortController();
    try {
      if (stopped || !runs.get(runId)?.active || res.destroyed) return failure(res, 400, 'Run is closed');
      if (input.model !== rateCard.model || input.n && input.n !== 1 || input.tools?.some(t => t.type !== 'function'))
        throw new Error('Request model or tool policy mismatch');
      const main = input.tools?.some(t => t.function?.name === 'bash') === true;
      const category = runs.get(runId).probe ? 'probe' : main ? 'primary' : 'auxiliary';
      const body = { ...input, model: rateCard.model, thinking: { type: 'disabled' }, reasoning_effort: 'none',
        temperature: 0.2, max_tokens: Math.min(Number.isSafeInteger(input.max_tokens) && input.max_tokens > 0 ? input.max_tokens : 4096, 4096),
        stream: true, stream_options: { include_usage: true } };
      delete body.max_completion_tokens; delete body.top_p;
      attempt = book.reserve(runId, category);
      const dir = join(directory, attempt.attempt_id);
      await mkdir(dir, { mode: 0o700 });
      capture = { attempt_id: attempt.attempt_id, run_id: runId, category, status: 'reserved',
        started_at: attempt.started_at, request_file: join(dir, 'request.json'), stream_file: join(dir, 'response.sse'),
        sdk_request_sha256: sha(JSON.stringify(input)), outbound_request_sha256: sha(JSON.stringify(body)), body };
      records.push(capture);
      await privateWrite(capture.request_file, body);
      await journal({ event: 'forwarding', attempt_id: attempt.attempt_id, run_id: runId,
        started_at: attempt.started_at, outbound_request_sha256: capture.outbound_request_sha256 });
      controllers.set(attempt.attempt_id, { controller, runId });
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let raw = '';
      try {
        const response = await fetch(new URL('/chat/completions', endpoint), { method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
        capture.http_status = response.status;
        if (!response.ok) {
          raw = (await response.text()).slice(0, 1024 * 1024);
          await privateWrite(capture.stream_file, raw);
          throw new Error(`upstream_http_${response.status}`);
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const decoder = new TextDecoder();
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) throw new Error('Response capture size exceeded');
          raw += decoder.decode(chunk, { stream: true });
          if (!res.destroyed) res.write(chunk);
        }
        raw += decoder.decode();
        await privateWrite(capture.stream_file, raw);
        const parsed = parseDeepSeekStream(raw);
        capture.response = parsed;
        const settled = book.settle(attempt.attempt_id, parsed);
        Object.assign(capture, { status: 'settled', request_id: parsed.id, finished_at: settled.finished_at,
          cost_nano: settled.cost_nano, currency: book.state.currency });
        await privateWrite(join(dir, 'capture.json'), { ...capture, body: undefined });
        await journal({ event: 'settled', attempt_id: attempt.attempt_id, run_id: runId, request_id: parsed.id,
          raw_stream_sha256: parsed.raw_stream_sha256, cost_nano: settled.cost_nano });
        onRecord({ run_id: runId, category, request_id: parsed.id, cost: settled.cost_nano/1e9, budget: book.summary() });
        if (!res.writableEnded) res.end();
      } catch (error) {
        if (raw) await privateWrite(capture.stream_file, raw);
        throw error;
      } finally { clearTimeout(timer); controllers.delete(attempt.attempt_id); }
    } catch (error) {
      const reason = error.name === 'AbortError' ? 'request_aborted' : error.message;
      if (attempt) {
        book.uncertain(attempt.attempt_id, reason);
        Object.assign(capture, { status: 'failed', error: reason, finished_at: new Date().toISOString() });
        await privateWrite(join(directory, attempt.attempt_id, 'capture.json'), { ...capture, body: undefined });
        await journal({ event: 'failed', attempt_id: attempt.attempt_id, run_id: runId, reason });
      } else await journal({ event: 'locally_rejected', run_id: runId, reason });
      failure(res, 400, reason); onFatal(runId, reason);
    }
  };
  const server = createServer(async (req, res) => {
    try {
      const match = req.url?.match(/^\/runs\/([a-zA-Z0-9_-]+)\/chat\/completions$/);
      if (req.method !== 'POST' || !match || req.headers.authorization !== `Bearer ${localToken}`) return failure(res, 403, 'Local proxy authorization failed');
      const chunks = []; let bytes = 0;
      for await (const c of req) { bytes += c.length; if (bytes > 8*1024*1024) throw new Error('Request size exceeded'); chunks.push(c); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const work = queue.then(() => handle(match[1], body, res));
      queue = work.catch(() => {}); await work;
    } catch { failure(res, 400, 'Invalid local request'); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { records, localToken,
    openRun(runId, { probe = false } = {}) {
      if (runs.has(runId) || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Duplicate/invalid proxy run');
      runs.set(runId, { active: true, probe }); return `${origin}/runs/${runId}`;
    },
    async closeRun(runId) {
      if (runs.has(runId)) runs.get(runId).active = false;
      await queue;
    },
    abortRun(runId) {
      if (runs.has(runId)) runs.get(runId).active = false;
      for (const x of controllers.values()) if (x.runId === runId) x.controller.abort();
    },
    async close() {
      stopped = true;
      for (const x of controllers.values()) x.controller.abort();
      await queue;
      server.closeIdleConnections();
      await new Promise(done => server.close(done));
    },
  };
}
