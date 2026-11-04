import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { defaultBinary, isolatedEnvironment, writeProjectPlugin } from './opencode-runtime.mjs';
import { rateCard } from './online-budget.mjs';
import { parseEvents, summarizeEvents } from './telemetry.mjs';
import { accountNativeRequests, parseDeepSeekStream } from './deepseek-usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";

export function taskProtocol(task, toolParts) {
  const executions = toolParts.filter(x => x.tool === 'bash' && x.state?.input?.command === task.command);
  const exits = executions.map(x => x.state?.metadata?.exit ?? null);
  const expectedInitial = task.format === 'node-tap' && task.repair ? 1 : 0;
  return { requested_command_executions: executions.length, exit_codes: exits,
    passed: executions.length >= (task.repair ? 2 : 1) && exits[0] === expectedInitial && exits.at(-1) === 0 };
}

export async function validatePinnedRuntime(binary = defaultBinary) {
  const installed = spawnSync('python3', ['-B', join(root, 'tools/setup-opencode.py')], { encoding: 'utf8', timeout: 30000 });
  if (installed.status !== 0) throw new Error('Official runtime archive verification failed');
  const receipt = JSON.parse(installed.stdout);
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 });
  const pin = JSON.parse(await readFile(join(root, 'adapters/opencode-pin.json'), 'utf8'));
  const bytes = await readFile(binary);
  const sha = hash(bytes);
  if (version.status !== 0 || version.stdout.trim() !== '1.19.5' || sha !== receipt.binary_sha256
    || !pin.archives.some(x => x.sha256 === receipt.archive_sha256)) throw new Error('Pinned runtime identity required');
  return { version: version.stdout.trim(), commit: pin.commit, binary_sha256: sha,
    archive_sha256: receipt.archive_sha256, platform: process.platform, arch: process.arch };
}

export async function runOnlineSession({ directory, stateDirectory, runId, mode, allowCommands, prompt,
  proxy, childRegistry, binary = defaultBinary, timeoutMs = 480000, extraBashCommands = [] }) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  stateDirectory = await realpath(stateDirectory);
  const plugin = await writeProjectPlugin(directory, { runId, mode, allowCommands, maxOutputChars: 12000 });
  const url = proxy.openRun(runId);
  const recall = fileURLToPath(new URL('../adapters/recall.mjs', import.meta.url));
  const bash = Object.fromEntries(['*', ...allowCommands.map(x => x.command), ...extraBashCommands,
    `node ${quote(recall)} *`].map((x,i) => [x, i ? 'allow' : 'deny']));
  const config = {
    $schema: 'https://opencode.ai/config.json', model: `contextguard-online/${rateCard.model}`,
    small_model: `contextguard-online/${rateCard.model}`, enabled_providers: ['contextguard-online'],
    share: 'disabled', autoupdate: false, lsp: false, formatter: false,
    permission: { '*': 'deny', bash, read: 'allow', edit: 'allow', write: 'allow', apply_patch: 'allow',
      glob: 'allow', grep: 'allow', list: 'allow', external_directory: 'deny',
      webfetch: 'deny', websearch: 'deny', task: 'deny', question: 'deny' },
    provider: { 'contextguard-online': { npm: '@ai-sdk/openai-compatible', name: 'Captured DeepSeek pilot',
      options: { baseURL: url, apiKey: proxy.localToken },
      models: { [rateCard.model]: { name: rateCard.model, tool_call: true,
        limit: { context: rateCard.context_limit, output: rateCard.max_output_tokens },
        cost: { input: rateCard.USD.input, output: rateCard.USD.output, cache_read: rateCard.USD.cached, cache_write: rateCard.USD.input } } } } },
  };
  const configPath = join(directory, 'opencode.json');
  const configText = JSON.stringify(config, null, 2);
  await writeFile(configPath, configText, { mode: 0o600 });
  const protectedArtifacts = { [configPath]: hash(configText), [plugin]: hash(await readFile(plugin)) };
  const started = performance.now();
  const child = spawn(binary, ['run', '--dir', directory, '--format', 'json', '--model', `contextguard-online/${rateCard.model}`, prompt],
    { cwd: directory, env: { ...isolatedEnvironment(stateDirectory), OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1' }, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
  let stdout = '', stderr = '', timedOut = false, stopped = null;
  const kill = reason => {
    stopped ??= reason; proxy.abortRun(runId);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  };
  childRegistry.set(runId, kill);
  child.stdout.on('data', x => { stdout += x; if (stdout.length > 32*1024*1024) kill('runtime_output_limit'); });
  child.stderr.on('data', x => { stderr += x; if (stderr.length > 8*1024*1024) kill('runtime_error_output_limit'); });
  const timer = setTimeout(() => { timedOut = true; kill('run_timeout'); }, timeoutMs);
  let status;
  try { status = await new Promise((done,reject) => { child.once('error',reject); child.once('close',(code,signal) => done({code,signal})); }); }
  finally { clearTimeout(timer); childRegistry.delete(runId); await proxy.closeRun(runId); }
  await writeFile(join(stateDirectory, 'opencode.jsonl'), stdout, { mode: 0o600 });
  await writeFile(join(stateDirectory, 'stderr.txt'), stderr, { mode: 0o600 });
  const unchanged = (await Promise.all(Object.entries(protectedArtifacts).map(async ([path,sha]) => hash(await readFile(path)) === sha))).every(Boolean);
  return { ...status, timed_out: timedOut, stop_reason: stopped, duration_ms: performance.now()-started,
    runtime_artifacts_unchanged: unchanged, stdout, stderr };
}

export async function inspectOnlineRun({ directory, result, records, book, runId }) {
  const issues = [];
  if (result.code !== 0 || result.timed_out || result.stop_reason) issues.push('runtime_not_completed');
  if (!result.runtime_artifacts_unchanged) issues.push('runtime_configuration_modified');
  let telemetry;
  try { telemetry = summarizeEvents(parseEvents(await readFile(join(directory, '.contextguard/evidence/events.jsonl'), 'utf8'))); }
  catch { issues.push('telemetry_unreadable'); }
  const cli = result.stdout.split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
  const toolParts = cli.filter(x => x.type === 'tool_use').map(x => x.part);
  const received = new Map();
  for (const r of records) for (const m of r.body.messages ?? []) if (m.role === 'tool') received.set(m.tool_call_id, m.content);
  const delivery = [];
  if (telemetry) {
    if (!telemetry.loaded_instances) issues.push('plugin_not_loaded');
    for (const key of ['unfinished', 'missing_start', 'delivery_mismatch']) if (telemetry.counts[key]) issues.push(key);
    if (new Set(toolParts.map(x => x.callID)).size !== telemetry.counts.total_calls) issues.push('independent_tool_inventory_mismatch');
    for (const call of telemetry.calls) if (call.hook) {
      const text = received.get(call.call_id);
      const matched = typeof text === 'string' && hash(text) === call.hook.visible_sha256;
      delivery.push({ call_id: call.call_id, outcome: call.hook.outcome, received_by_provider: typeof text === 'string', sha_matched: matched });
      if (!matched) issues.push(`tool_delivery_unverified:${call.call_id}`);
    }
  }
  for (const r of records) {
    const raw = await readFile(r.stream_file,'utf8');
    if (r.status !== 'settled' || parseDeepSeekStream(raw).raw_stream_sha256 !== r.response.raw_stream_sha256) issues.push('provider_evidence_incomplete');
  }
  const inventory = (await readFile(join(resolve(records[0]?.request_file ?? directory, '..', '..'), 'inventory.jsonl'),'utf8'))
    .split('\n').filter(Boolean).map(x => JSON.parse(x)).filter(x => x.event === 'forwarding' && x.run_id === runId);
  const attempts = book.state.attempts.filter(x => x.run_id === runId);
  const accounting = accountNativeRequests(attempts, inventory.map(x => x.attempt_id), book.state.currency);
  const fingerprints = [...new Set(attempts.map(x => x.system_fingerprint))];
  return { issues: [...new Set(issues)], telemetry, accounting, fingerprints, delivery, toolParts,
    native_tool_count: toolParts.length, request_count: records.length,
    auxiliary_requests: records.filter(x => x.category === 'auxiliary').length };
}
