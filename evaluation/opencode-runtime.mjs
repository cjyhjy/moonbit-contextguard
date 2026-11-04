import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
export const defaultBinary = resolve(root, '.toolchain-downloads/opencode-1.19.5/opencode');

export function isolatedEnvironment(directory) {
  // Do not inherit provider credentials, user plugins, proxy settings, or account state.
  return { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8',
    XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data'),
    XDG_CACHE_HOME: join(directory, 'cache'), XDG_STATE_HOME: join(directory, 'state'),
    OPENCODE_CONFIG_DIR: join(directory, 'config', 'opencode'),
    OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1' };
}

export async function writeProjectPlugin(directory, options) {
  const loader = join(directory, '.opencode', 'plugins', 'contextguard.js');
  await mkdir(resolve(loader, '..'), { recursive: true });
  await writeFile(loader, `import { createContextGuardPlugin } from ${JSON.stringify(pathToFileURL(join(root, 'adapters/opencode.mjs')).href)};\nexport const ContextGuard = createContextGuardPlugin(${JSON.stringify(options)});\n`);
  return loader;
}

/** Actual pinned OpenCode process against a scripted loopback protocol fixture. No online model. */
export async function runScriptedSession({ directory, stateDirectory, runId, allowCommands, nextAction,
  mode = 'guard', maxOutputChars = 12000, toolOutputBytes, binary = defaultBinary, timeoutMs = 60000,
  prompt = 'Execute the local fixture task.' }) {
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0 || version.stdout.trim() !== '1.19.5') throw new Error('Pinned OpenCode 1.19.5 binary required');
  const pin = JSON.parse(await readFile(join(root, 'adapters/opencode-pin.json'), 'utf8'));
  const requests = [], failures = [];
  let mainStep = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error('Fixture request limit exceeded'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const main = Array.isArray(body.tools) && body.tools.some(t => t.function?.name === 'bash');
      const id = `${runId}-request-${requests.length + 1}`;
      const usage = { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 2 } };
      requests.push({ main, body, request_id: id, response: { id, model: 'fixture', usage } });
      const action = main ? await nextAction(body, mainStep++) : { text: 'ContextGuard local fixture' };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const emit = (delta, finish = null, usage) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`);
      if (action?.tool) emit({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${mainStep}`, type: 'function', function: { name: action.tool, arguments: JSON.stringify(action.args) } }] });
      else emit({ role: 'assistant', content: action?.text ?? 'Fixture complete.' });
      emit({}, action?.tool ? 'tool_calls' : 'stop', usage);
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    await mkdir(stateDirectory, { recursive: true });
    await writeProjectPlugin(directory, { runId, allowCommands, mode, maxOutputChars });
    const config = { $schema: 'https://opencode.ai/config.json', model: 'contextguard-fixture/fixture',
      small_model: 'contextguard-fixture/fixture', enabled_providers: ['contextguard-fixture'],
      share: 'disabled', autoupdate: false, lsp: false, formatter: false,
      permission: { '*': 'allow', webfetch: 'deny', websearch: 'deny', task: 'deny' },
      provider: { 'contextguard-fixture': { npm: '@ai-sdk/openai-compatible', name: 'Local protocol fixture',
        options: { baseURL: url, apiKey: 'local-fixture-not-a-credential' },
        models: { fixture: { name: 'Fixture', tool_call: true, limit: { context: 131072, output: 4096 },
          cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } } } } },
      ...(toolOutputBytes ? { tool_output: { max_bytes: toolOutputBytes, max_lines: 2000 } } : {}) };
    await writeFile(join(directory, 'opencode.json'), JSON.stringify(config, null, 2));
    const started = performance.now();
    const child = spawn(binary, ['run', '--dir', directory, '--format', 'json', '--model', 'contextguard-fixture/fixture', prompt],
      { cwd: directory, env: isolatedEnvironment(stateDirectory), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
    const stop = () => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(stop, timeoutMs);
    let status;
    try { status = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); }); }
    finally { clearTimeout(timer); }
    await writeFile(join(stateDirectory, 'opencode.jsonl'), stdout);
    await writeFile(join(stateDirectory, 'stderr.txt'), stderr);
    await writeFile(join(stateDirectory, 'requests.json'), JSON.stringify(requests, null, 2));
    return { ...status, duration_ms: performance.now() - started, timed_out: timedOut, failures, requests, stdout, stderr, main_steps: mainStep,
      runtime: { version: version.stdout.trim(), commit: pin.commit,
        binary_sha256: createHash('sha256').update(await readFile(binary)).digest('hex') },
      evidence_kind: 'synthetic', boundary: 'Real OpenCode runtime; scripted loopback protocol responses and fabricated usage. No model, paid API, or task-quality claim.' };
  } finally { await new Promise(done => server.close(done)); }
}
