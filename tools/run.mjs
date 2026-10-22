#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { guard } from './api.mjs';

/** Captures a real argv process. No shell, inference, network or global hooks. */
export async function runProcess(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(v => typeof v !== 'string')) throw new TypeError('argv required');
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxCaptureBytes = options.maxCaptureBytes ?? 8 * 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxCaptureBytes) || maxCaptureBytes < 1) throw new TypeError('invalid process budget');
  const cwd = resolve(options.cwd ?? process.cwd());
  const captureDir = resolve(options.captureDir ?? join(cwd, 'reports', 'captures', randomUUID()));
  // Never overwrite an existing capture, even when a caller supplies its path.
  if (!options.captureDir) mkdirSync(resolve(cwd,'reports','captures'),{recursive:true});
  mkdirSync(captureDir, { recursive: false, mode:0o700 });
  const started = new Date().toISOString();
  const before = performance.now();
  const child = spawn(argv[0], argv.slice(1), { cwd, env: options.env ?? process.env, shell: false, detached: process.platform !== 'win32', stdio:['ignore','pipe','pipe'] });
  const chunks = { stdout: [], stderr: [] };
  let bytes = 0, captureLimitHit = false, timedOut = false, spawnError = null;
  const terminate = () => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
  };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  for (const stream of ['stdout','stderr']) child[stream].on('data', chunk => {
    const remaining = maxCaptureBytes - bytes;
    if (chunk.length > remaining) captureLimitHit = true;
    if (remaining > 0) { const part = chunk.subarray(0, remaining); chunks[stream].push(part); bytes += part.length; }
    if (captureLimitHit) terminate();
  });
  child.on('error', error => { spawnError = error.message; });
  const status = await new Promise(done => child.on('close', (code, signal) => done({code,signal})));
  clearTimeout(timer);
  const buffers = Object.fromEntries(Object.entries(chunks).map(([k,v]) => [k, Buffer.concat(v)]));
  const stdout = buffers.stdout.toString('utf8'), stderr = buffers.stderr.toString('utf8');
  const invalidUtf8 = ['stdout','stderr'].some(k => !Buffer.from(buffers[k].toString('utf8')).equals(buffers[k]));
  const processMeta = { exit_code: spawnError ? 127 : (status.code ?? 137), scope: [JSON.stringify(argv)], truncated: captureLimitHit || timedOut || invalidUtf8 || spawnError !== null, signal:status.signal, timed_out:timedOut, capture_limit_hit:captureLimitHit, invalid_utf8:invalidUtf8, spawn_error:spawnError };
  let result;
  try { result = guard({format:options.format ?? 'unknown', raw:stdout, process:processMeta, max_output_chars:options.maxOutputChars ?? 16000}); }
  catch (error) {
    result = {schema_version:1,format:options.format??'unknown',decision:'fallback',reason:'core_transport_error',core_error:error.message,output:stdout,process:processMeta,evidence:[],metrics:{input_chars:stdout.length,output_chars:stdout.length,required_facts:0,missing_facts:0,char_unit:'utf16_code_units'},assurance:'original_passthrough',output_kind:'original'};
  }
  // Decoding replacement chars must never be described as exact original bytes.
  if (invalidUtf8) result = {...result, reason:'non_utf8_capture', assurance:'captured_decoded_text_only'};
  const hashes = {};
  for (const stream of ['stdout','stderr']) {
    writeFileSync(join(captureDir, `${stream}.bin`), buffers[stream], {flag:'wx',mode:0o600});
    hashes[stream] = createHash('sha256').update(buffers[stream]).digest('hex');
  }
  const manifest = { schema_version:1, kind:'real_process_capture', started_at:started, elapsed_ms:performance.now()-before, argv, cwd, process:processMeta, hashes, bytes:{stdout:buffers.stdout.length,stderr:buffers.stderr.length}, format:options.format ?? 'unknown' };
  writeFileSync(join(captureDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  result = {...result, stderr, capture:{directory:captureDir,sha256:hashes}, elapsed_ms:manifest.elapsed_ms};
  writeFileSync(join(captureDir,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}

export function renderForAgent(result) {
  const p = result.process;
  return `[ContextGuard ${result.output_kind}; ${result.decision}; reason=${result.reason}]\n` +
    `exit_code=${p.exit_code}; truncated=${p.truncated}; scope=${JSON.stringify(p.scope)}\n` +
    `evidence=${result.capture.directory}; recall: node tools/recall.mjs ${JSON.stringify(result.capture.directory)} stdout START END\n` +
    `--- stdout ---\n${result.output}${result.output.endsWith('\n')?'':'\n'}--- stderr (uncompressed) ---\n${result.stderr}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), split = args.indexOf('--');
    if (split < 0) throw new Error('Usage: node tools/run.mjs --format node-tap|rg-json [--text] [--capture-dir DIR] [--max-output-chars N] [--timeout-ms N] [--max-capture-bytes N] -- COMMAND ARG...');
    const options = {};
    let textMode = false;
    for (let i=0;i<split;i++) {
      const key=args[i];
      if(key==='--text') {textMode=true;continue;}
      const name={'--format':'format','--capture-dir':'captureDir','--max-output-chars':'maxOutputChars','--timeout-ms':'timeoutMs','--max-capture-bytes':'maxCaptureBytes'}[key];
      if (!name || i+1>=split) throw new Error(`invalid option ${key}`);
      options[name]=name==='format'||name==='captureDir'?args[++i]:Number(args[++i]);
    }
    if (!options.captureDir) mkdirSync(resolve('reports/captures'),{recursive:true});
    const result=await runProcess(args.slice(split+1),options);
    process.stdout.write(textMode?renderForAgent(result):JSON.stringify(result)+'\n');
    process.exitCode=Math.min(255,Math.max(0,result.process.exit_code));
  } catch (error) {console.error(JSON.stringify({error:error.message}));process.exitCode=2;}
}
