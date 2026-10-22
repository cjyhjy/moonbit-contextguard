import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoServer } from '../demo/server.mjs';

async function setup(t) {
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves local demo and real fixture manifest without remote dependencies', async (t) => {
  const url = await setup(t);
  const res = await fetch(url); assert.equal(res.status, 200);
  assert.match(await res.text(), /工具输出证据实验室/u);
  assert.match(res.headers.get('content-security-policy'), /connect-src 'self'/u);
  const manifest = await (await fetch(url + '/fixtures/manifest.json')).json();
  assert(manifest.fixtures.length >= 4);
  assert.equal((await fetch(url + '/fixtures/.hidden')).status, 404);
  assert.equal((await fetch(url + '/fixtures/%2e%2e%2f%2e%2e%2fPROJECTS.md')).status, 404);
});

test('actual HTTP guard returns MoonBit compression, repair, fallback and evidence', async (t) => {
  const url = await setup(t);
  const fixture = JSON.parse(await readFile(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')).fixtures.find((entry) => entry.id === 'node-tap-middle-failure');
  const raw = await readFile(new URL('../' + fixture.stdout, import.meta.url), 'utf8');
  async function post(extra = {}) {
    const res = await fetch(url + '/api/guard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: fixture.format, raw, process: fixture.process, max_output_chars: 12000, ...extra }) });
    assert.equal(res.status, 200); return res.json();
  }
  const compressed = await post(); assert.equal(compressed.decision, 'compressed');
  assert(compressed.metrics.output_chars < raw.length); assert(compressed.evidence.length > 0);
  assert.equal(compressed.output_kind, 'evidence_projection');
  assert.deepEqual(compressed.process, fixture.process);
  const repaired = await post({ candidate: '' }); assert.equal(repaired.decision, 'repaired'); assert(repaired.metrics.missing_facts > 0);
  const fallback = await post({ max_output_chars: 0 }); assert.equal(fallback.decision, 'fallback'); assert.equal(fallback.output, raw);
  const unknown = await post({ format: 'unknown' }); assert.equal(unknown.decision, 'fallback'); assert.equal(unknown.output, raw);
});

test('rejects foreign-origin, non-JSON, malformed requests and arbitrary routes', async (t) => {
  const url = await setup(t);
  assert.equal((await fetch(url + '/api/guard')).status, 405);
  assert.equal((await fetch(url + '/api/guard', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/api/guard', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url + '/api/guard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await fetch(url + '/api/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"command":"echo never"}' })).status, 405);
});
