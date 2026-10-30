#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {sourceDigest, verificationInputs} from './source-digest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const portable = process.argv.includes('--portable');
const githubActions = process.env.GITHUB_ACTIONS === 'true';
const execution = githubActions ? {environment: 'github_actions', repository: process.env.GITHUB_REPOSITORY,
  commit_sha: process.env.GITHUB_SHA, run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT}
  : {environment: 'local'};
const reportPath = join(root, portable ? 'reports/verification-portable.json' : 'reports/verification.json');
mkdirSync(join(root, 'reports/logs'), {recursive: true});
const report = {
  schema_version: 2, project: 'ContextGuard', run_id: randomUUID(),
  started_at: new Date().toISOString(), user_timezone: 'America/New_York',
  mode: portable ? 'portable_prebuilt' : 'source_and_prebuilt', status: 'running',
  environment: {node: process.version, platform: process.platform, arch: process.arch}, execution, checks: [],
  external_evidence: {fixtures: 'fixtures/manifest.json', comparison: 'reports/evaluation.json', peer_pins: 'research/peers-lock.json', adapter: 'reports/adapter-protocol.json', browser: 'reports/demo-browser.json'},
  not_tested: ['online_model_task_success', 'actual_model_token_counts', 'provider_billed_cost_or_net_savings', 'live_agent_installation', ...(!githubActions ? ['remote_CI'] : []), 'public_package_publication', 'formal_contest_submission'],
  boundary: 'All workload sources are synthetic; captured stdout/stderr are historical real process fixtures. Fresh peer availability and unrun entries are recorded in evaluation.json. Portable mode does not compile MoonBit. execution records this run only; no online agent or package publication is certified.'
};
function save() {
  const temporary = `${reportPath}.${report.run_id}.tmp`;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
  renameSync(temporary, reportPath);
}
// Invalidate the previous pass before parsing inputs or starting child processes.
// An interrupted run leaves running/failed, never the previous passed receipt.
save();
const clean = text => String(text ?? '').replaceAll(root, '<PROJECT_ROOT>/').replaceAll(process.env.MOON_HOME || '\0', '<MOON_HOME>');
function run(id, command, args) {
  const start = performance.now();
  const r = spawnSync(command, args, {cwd: root, env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024});
  const log = clean((r.stdout ?? '') + (r.stderr ?? '') + (r.error ? '\n' + r.error.message : ''));
  writeFileSync(join(root, `reports/logs/${id}.log`), log);
  const item = {id, command: [command, ...args], status: r.status === 0 && !r.error ? 'passed' : 'failed', exit_code: r.status, signal: r.signal, elapsed_ms: performance.now() - start, log: `reports/logs/${id}.log`};
  report.checks.push(item); save();
  console.log(`${item.status}: ${id}`);
  if (item.status === 'failed') console.error(log.slice(-5000));
}
function buildIdentity() {
  const bytes = readFileSync(join(root, 'dist/build-manifest.json'));
  const manifest = JSON.parse(bytes);
  const artifact = createHash('sha256').update(readFileSync(join(root, 'dist/contextguard.mjs'))).digest('hex');
  if (manifest.source.sha256 !== sourceDigest(root).sha256 || manifest.artifact_sha256 !== artifact)
    throw new Error('generated JS or source digest mismatch; rebuild required');
  return {source_sha256: manifest.source.sha256, artifact_sha256: artifact, manifest_sha256: createHash('sha256').update(bytes).digest('hex')};
}
try {
  report.version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
  report.inputs = verificationInputs(root);
  report.source = sourceDigest(root);
  save();
  if (!portable) {
    run('moon-version', 'sh', ['tools/moon', 'version', '--all']);
    run('moon-format', 'sh', ['tools/moon', 'fmt', '--check']);
    for (const target of ['js', 'native', 'wasm-gc']) {
      run(`moon-check-${target}`, 'sh', ['tools/moon', 'check', '--target', target]);
      run(`moon-build-${target}`, 'sh', ['tools/moon', 'build', '--target', target, '--release']);
      run(`moon-test-${target}`, 'sh', ['tools/moon', 'test', '--target', target]);
    }
    run('moon-build', process.execPath, ['tools/build.mjs']);
  }
  try {
    report.build = buildIdentity();
    report.checks.push({id: 'compiled-source-correspondence', status: 'passed', ...report.build});
  } catch (error) { report.checks.push({id: 'compiled-source-correspondence', status: 'failed', error: error.message}); }
  const tests = readdirSync(join(root, 'tests')).filter(x => x.endsWith('.test.mjs')).sort().map(x => 'tests/' + x);
  if (!tests.length) throw new Error('No public API tests found');
  run('public-api-process-adapter-http-tests', process.execPath, ['--test', ...tests]);
  run('paired-ledger-tests', process.execPath, ['--test', 'evaluation/ledger.test.mjs']);
  run('independent-evaluation', process.execPath, ['evaluation/evaluate.mjs']);
  run('independent-mutation-audit', process.execPath, ['evaluation/audit.mjs']);
  run('paired-ledger-example', process.execPath, ['evaluation/ledger.mjs', 'evaluation/example-ledger.synthetic.jsonl', '--output', 'reports/evaluation-ledger.synthetic.json']);
  run('json-cli', process.execPath, ['tools/cli.mjs', 'fixtures/example-request.json']);
  run('example', process.execPath, ['tools/example.mjs']);
  if (JSON.stringify(verificationInputs(root)) !== JSON.stringify(report.inputs) || JSON.stringify(sourceDigest(root)) !== JSON.stringify(report.source))
    throw new Error('Verification inputs changed while checks were running; rerun verification');
  if (JSON.stringify(buildIdentity()) !== JSON.stringify(report.build))
    throw new Error('Build outputs changed while checks were running; rerun verification');
  report.checks.push({id: 'verification-inputs-stable', status: 'passed'});
  report.status = report.checks.every(c => c.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.checks.push({id: 'verification-integrity', status: 'failed', error: clean(error.message)});
  report.status = 'failed';
  console.error(clean(error.message));
}
report.generated_at = new Date().toISOString();
save();
if (report.status !== 'passed') process.exitCode = 1;
