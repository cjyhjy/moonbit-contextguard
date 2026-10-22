#!/usr/bin/env node
/** Capture real process outputs from explicitly synthetic inputs. No ContextGuard imports. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = text => createHash('sha256').update(text).digest('hex');
const run = (command, args, cwd = root) => {
  const value = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (value.error || value.signal) throw value.error ?? new Error(`Signal ${value.signal}`);
  return { stdout: value.stdout, stderr: value.stderr, exit_code: value.status };
};
const nodeVersion = run('node', ['--version']).stdout.trim();
const rgVersion = run('rg', ['--version']).stdout.trim();
mkdirSync(resolve(root, 'fixtures/raw'), { recursive: true });
mkdirSync(resolve(root, 'fixtures/sources/search'), { recursive: true });
const searchFiles = {
  'alpha.txt': ['alpha heading', 'context before first hit', 'needle first match 中文', 'context after first hit', 'quiet line', 'tail'].join('\n') + '\n',
  'βeta.txt': ['Unicode source 文件', 'before a long middle hit', `needle long-middle ${'保留证据-λ-'.repeat(420)} END-OF-LONG-HIT`, 'after a long middle hit', 'gap one', 'gap two', 'before final hit', 'needle final Ω match', 'after final hit'].join('\n') + '\n',
  'gamma.txt': ['before gamma', 'needle gamma one', 'needle gamma adjacent', 'after gamma', 'unmatched ending'].join('\n') + '\n',
};
for (const [name, content] of Object.entries(searchFiles)) writeFileSync(resolve(root, 'fixtures/sources/search', name), content);

const specs = [
  { id: 'node-tap-all-pass', format: 'node-tap', command: 'node', args: ['--test', '--test-reporter=tap', 'fixtures/sources/all-pass.test.cjs'], scope: ['fixtures/sources/all-pass.test.cjs'], expectedExit: 0, source_origin: 'synthetic passing test program; actual captured node --test TAP stdout/stderr' },
  { id: 'node-tap-zero-tests', format: 'node-tap', command: 'node', args: ['--test', '--test-reporter=tap'], cwd_relative: 'fixtures/sources/empty-tests', scope: ['fixtures/sources/empty-tests'], source_files: [], expectedExit: 0, source_origin: 'deliberately empty synthetic discovery directory; actual captured node --test TAP stdout/stderr with 0 tests' },
  { id: 'node-tap-middle-failure', format: 'node-tap', command: 'node', args: ['--test', '--test-reporter=tap', 'fixtures/sources/many-tests.test.cjs'], scope: ['fixtures/sources/many-tests.test.cjs'], expectedExit: 1, source_origin: 'synthetic test program; actual captured node --test TAP stdout/stderr' },
  { id: 'rg-json-multiple-unicode-long', format: 'rg-json', command: 'rg', args: ['--json', '--context', '1', 'needle', 'fixtures/sources/search'], scope: ['fixtures/sources/search'], expectedExit: 0, source_origin: 'synthetic text corpus; actual captured rg JSON stdout/stderr' },
  { id: 'rg-json-no-results', format: 'rg-json', command: 'rg', args: ['--json', '--context', '1', 'ABSENT_PATTERN_7f913', 'fixtures/sources/search'], scope: ['fixtures/sources/search'], expectedExit: 1, source_origin: 'synthetic text corpus with deliberately absent pattern; actual captured rg JSON stdout/stderr' },
  { id: 'rg-json-invalid-path', format: 'rg-json', command: 'rg', args: ['--json', '--context', '1', 'needle', 'fixtures/sources/does-not-exist'], scope: ['fixtures/sources/does-not-exist'], expectedExit: 2, source_origin: 'deliberately nonexistent synthetic path; actual captured rg JSON stdout/stderr' },
];

// This independent annotator is intentionally outside the guard implementation.
// Its rules enumerate the stated fixture contract. Every required line is copied
// from captured stdout; no expected facts, status, or metadata come from the guard.
function annotate(stdout, format) {
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const evidence = [];
  const add = (tag, start, end = start) => evidence.push({ tag, line_start: start + 1, line_end: end + 1, lines: lines.slice(start, end + 1) });
  if (format === 'node-tap') {
    for (let i = 0; i < lines.length; i += 1) {
      if (/^TAP version /.test(lines[i])) add('tap-version', i);
      else if (/^\d+\.\.\d+(?:\s|$)/.test(lines[i])) add('tap-plan', i);
      else if (/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(lines[i])) add(`tap-summary-${lines[i].split(' ')[1]}`, i);
      else if (/^(?:not )?ok \d+ .*# (?:SKIP|TODO)(?:\s|$)/.test(lines[i])) add(/# SKIP/.test(lines[i]) ? 'tap-skip' : 'tap-todo', i);
      else if (/^not ok \d+ /.test(lines[i])) {
        let start = i > 0 && /^# Subtest:/.test(lines[i - 1]) ? i - 1 : i;
        let end = i;
        if (lines[i + 1] === '  ---') {
          end = i + 2;
          while (end < lines.length && lines[end] !== '  ...') end += 1;
          if (end === lines.length) throw new Error('Unterminated failure diagnostic in captured TAP');
        }
        add('tap-failure-block', start, end);
        const block = lines.slice(start, end + 1);
        for (const [tag, pattern] of [['tap-failure-location', /^  location:/], ['tap-assertion-actual', /^  actual:/], ['tap-assertion-expected', /^  expected:/], ['tap-assertion-error', /^  error:/]]) {
          const at = block.findIndex(line => pattern.test(line));
          if (at < 0) throw new Error(`Missing expected fixture field ${tag}`);
          add(tag, start + at);
        }
        i = end;
      }
    }
  } else {
    for (let i = 0; i < lines.length; i += 1) {
      const event = JSON.parse(lines[i]);
      if (['match', 'context', 'summary'].includes(event.type)) add(`rg-${event.type}`, i);
    }
  }
  return evidence;
}

const captureRoot = mkdtempSync('/tmp/contextguard-fixture-capture-');
mkdirSync(resolve(captureRoot, 'fixtures'), { recursive: true });
cpSync(resolve(root, 'fixtures/sources'), resolve(captureRoot, 'fixtures/sources'), { recursive: true });
const previous = process.argv.includes('--append-missing') && existsSync(resolve(root, 'fixtures/manifest.json')) ? JSON.parse(readFileSync(resolve(root, 'fixtures/manifest.json'), 'utf8')) : null;
const fixtures = specs.map(spec => {
  const existing = previous?.fixtures.find(item => item.id === spec.id);
  if (existing) return { ...existing, captured_at: existing.captured_at ?? previous.captured_at };
  const fixtureCwd = spec.cwd_relative ? resolve(captureRoot, spec.cwd_relative) : captureRoot;
  mkdirSync(fixtureCwd, { recursive: true });
  const actual = run(spec.command, spec.args, fixtureCwd);
  if (actual.exit_code !== spec.expectedExit) throw new Error(`${spec.id}: expected exit ${spec.expectedExit}, got ${actual.exit_code}`);
  const stdout = `fixtures/raw/${spec.id}.stdout.txt`;
  const stderr = `fixtures/raw/${spec.id}.stderr.txt`;
  writeFileSync(resolve(root, stdout), actual.stdout);
  writeFileSync(resolve(root, stderr), actual.stderr);
  return {
    id: spec.id, captured_at: new Date().toISOString(), format: spec.format, source_origin: spec.source_origin,
    invocation: { command: spec.command, args: spec.args, cwd: fixtureCwd, cwd_relative: spec.cwd_relative ?? '.', portable_cwd: 'temporary directory containing a copy of fixtures/sources; apply cwd_relative', shell_display: [spec.command, ...spec.args].join(' '), environment: 'inherited local environment, no credentials needed' },
    process: { exit_code: actual.exit_code, scope: spec.scope, truncated: false },
    stdout, stderr, stdout_sha256: hash(actual.stdout), stderr_sha256: hash(actual.stderr),
    source_files: spec.id.startsWith('node') ? (spec.source_files ?? spec.scope) : Object.keys(searchFiles).map(name => `fixtures/sources/search/${name}`),
    required_evidence: annotate(actual.stdout, spec.format),
    required_process_fields: ['exit_code', 'scope', 'truncated'],
  };
});
const manifest = {
  schema_version: 1, captured_at: new Date().toISOString(),
  data_origin: 'synthetic source programs and corpus, real subprocess outputs; no production traces or model calls',
  tools: { node: nodeVersion, rg: rgVersion },
  regeneration_command: 'node evaluation/capture-fixtures.mjs',
  evidence_origin: 'independent external fixture annotator in evaluation/capture-fixtures.mjs; expected line spans from original stdout, manually reviewed against source intent; never guard-provided fact metadata',
  stderr_boundary: 'stdout is the guard raw input in these offline cases. Stderr is separately captured and hash checked, not claimed to be included or preserved by guard stdout output.',
  fixtures,
};
rmSync(captureRoot, { recursive: true, force: true });
writeFileSync(resolve(root, 'fixtures/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ generated: fixtures.length, tools: manifest.tools, manifest: 'fixtures/manifest.json' }, null, 2));
