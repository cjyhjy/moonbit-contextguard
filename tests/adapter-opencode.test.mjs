import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextGuardPlugin, inferFormat, OPENCODE_PIN } from '../adapters/opencode.mjs';
import { guard } from '../tools/api.mjs';
import { recallAdapter } from '../adapters/recall.mjs';

const contract = JSON.parse(await readFile(new URL('../adapters/vendor/opencode-1.2.0-contract.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../adapters/vendor/opencode-1.2.0-plugin-index.ts', import.meta.url), 'utf8');
const fixtureManifest = JSON.parse(await readFile(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const fixture = fixtureManifest.fixtures.find((x) => x.id === 'node-tap-middle-failure');
const raw = await readFile(new URL('../' + fixture.stdout, import.meta.url), 'utf8');
const command = fixture.invocation.shell_display;
const rules = [{ command, scope: fixture.process.scope }];
const input = { tool: 'bash', sessionID: 'offline-session', callID: 'offline-call', args: { command } };

// Execute the ACTUAL pinned upstream trigger body, not a hand-written imitation.
// Only state() is supplied by this offline harness. No OpenCode/model is started.
const body = contract.trigger.slice(contract.trigger.indexOf('    if (!name)'), contract.trigger.lastIndexOf('  }'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const replayTrigger = new AsyncFunction('state', 'name', 'input', 'output', body);

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'contextguard-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hooks = await createContextGuardPlugin({ allowCommands: rules, evidenceDirectory: 'evidence', guard, ...options })({ directory });
  return { directory, invoke: (value, event = input) => replayTrigger(async () => ({ hooks: [hooks] }), 'tool.execute.after', event, value) };
}
const output = (overrides = {}) => ({ title: 'Synthetic failure', output: raw, metadata: { exit: 1, truncated: false, output: 'native metadata preview', description: 'keep me' }, attachments: [{ mime: 'text/plain', url: 'file:///example' }], ...overrides });

test('vendored official type source matches Git blob SHA and mutable hook signature', () => {
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
  assert.equal(blob, contract.pin.sources[0].blob_sha);
  assert.equal(contract.pin.commit, OPENCODE_PIN.commit);
  assert.match(source, /"tool.execute.after"\?: \([\s\S]*?args: any[\s\S]*?output: string[\s\S]*?metadata: any/u);
  assert.match(contract.callsite, /await Plugin.trigger\([\s\S]*?"tool.execute.after"[\s\S]*?result,[\s\S]*?return result/u);
  assert.match(contract.bash_result, /exit: proc.exitCode/u);
});

test('actual pinned trigger mutates same output while preserving metadata and attachments', async (t) => {
  const { directory, invoke } = await setup(t);
  const value = output(); const metadata = value.metadata; const attachments = value.attachments;
  const returned = await invoke(value);
  assert.strictEqual(returned, value);
  assert.strictEqual(value.metadata, metadata);
  assert.strictEqual(value.attachments, attachments);
  assert.equal(value.title, 'Synthetic failure');
  const [header, ...rest] = value.output.split('\n');
  const info = JSON.parse(header);
  assert.deepEqual(info.process, fixture.process);
  assert.equal(info.decision, 'compressed');
  const payload = rest.join('\n').replace(/^--- ContextGuard tool output ---\n/u, '');
  assert(payload.length < raw.length);
  assert(payload.includes('not ok 37'));
  assert(payload.includes('ERR_ASSERTION'));
  assert(payload.endsWith('\n'));
  const receipt = JSON.parse(await readFile(info.receipt, 'utf8'));
  assert.deepEqual(receipt.original.metadata, metadata);
  assert.deepEqual(receipt.original.attachments, attachments);
  assert.equal(await readFile(join(directory, 'evidence', receipt.raw_file), 'utf8'), raw);
  assert.equal(info.raw_sha256, createHash('sha256').update(raw).digest('hex'));
  assert((await readFile(info.evidence, 'utf8')).includes('start_line'));
  const decision = JSON.parse(await readFile(info.evidence, 'utf8'));
  assert.equal(decision.adapter_metrics.agent_visible_chars, value.output.length);
  assert.equal(decision.adapter_metrics.envelope_chars, value.output.length - payload.length);
  const failure = decision.evidence.find((entry) => entry.kind === 'failure');
  const recalled = recallAdapter(info.receipt, failure.start_line, failure.end_line);
  assert.equal(recalled.text, failure.text);
  await writeFile(join(directory, 'evidence', receipt.raw_file), 'tampered');
  assert.throws(() => recallAdapter(info.receipt), /integrity mismatch/u);
});

test('missing exit code, missing truncation, unsupported tool, wrong command and cwd remain untouched', async (t) => {
  const { directory, invoke } = await setup(t);
  const variants = [
    [output({ metadata: { truncated: false } }), input],
    [output({ metadata: { exit: 1 } }), input],
    [output({ metadata: { exit: null, truncated: false } }), input],
    [output(), { ...input, tool: 'mcp-server-tool' }],
    [output(), { ...input, args: { command: command + ' && echo done' } }],
    [output(), { ...input, args: { command, workdir: '/another/project' } }],
  ];
  for (const [value, event] of variants) { const before = structuredClone(value); await invoke(value, event); assert.deepEqual(value, before); }
  assert.deepEqual(await readdir(directory), []);
});

test('upstream truncated and mixed unsupported output fail open through real core', async (t) => {
  const { invoke } = await setup(t);
  for (const value of [output({ metadata: { exit: 1, truncated: true } }), output({ output: 'shell: stderr diagnostic\n' + raw })]) {
    const before = value.output;
    await invoke(value);
    const info = JSON.parse(value.output.split('\n')[0]);
    assert.equal(info.decision, 'fallback');
    assert.equal(value.output.split('--- ContextGuard tool output ---\n')[1], before);
  }
});

test('guard errors or changed process context do not alter visible output', async (t) => {
  for (const fakeGuard of [() => { throw new Error('core unavailable'); }, () => ({ output: 'bad', process: { exit_code: 0, scope: [], truncated: false } })]) {
    const { invoke } = await setup(t, { guard: fakeGuard });
    const value = output(); await invoke(value); assert.equal(value.output, raw);
  }
});

test('unwritable evidence destination leaves output intact', async (t) => {
  const { invoke } = await setup(t, { evidenceDirectory: '/dev/null/not-a-directory' });
  const value = output(); await invoke(value); assert.equal(value.output, raw);
});

test('format inference does not accept shell composition or implicit default reporter', () => {
  assert.equal(inferFormat('rg --json needle src'), 'rg-json');
  assert.equal(inferFormat('node --test --test-reporter=tap test.cjs'), 'node-tap');
  for (const command of ['node --test', 'rg needle src', 'rg --json needle src | head', 'rg --json $(echo needle) src', 'node --test --test-reporter=tap x; echo hi']) assert.equal(inferFormat(command), null);
  assert.throws(() => createContextGuardPlugin({ allowCommands: [{ command: 'node --test', scope: ['.'] }] }), /plain rg/u);
});

test('default factory does not activate any command', async (t) => {
  const { invoke, directory } = await setup(t, { allowCommands: [] });
  const value = output(); await invoke(value); assert.equal(value.output, raw);
  assert.deepEqual(await readdir(directory), []);
});
