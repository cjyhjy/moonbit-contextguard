import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const specs = [
  ['suites', 1, 'compressed'], ['parent', 1, 'compressed'], ['all-pass', 0, 'compressed'],
  ['directives', 0, 'compressed'], ['cancelled', 1, 'fallback'], ['custom-log', 0, 'fallback'],
  ['project-regression', 0, 'compressed']
];
const hash = text => createHash('sha256').update(text).digest('hex');
const env = {...process.env};
delete env.NODE_TEST_CONTEXT;
const fixtures = [];
const capturedFiles = new Map();
for (const [id, exit, decision] of specs) {
  const sources = id === 'project-regression' ? ['tests/core.test.mjs', 'tests/core-optimization.test.mjs'] : [`fixtures/nested-tap/sources/${id}.cjs`];
  const source = sources[0];
  const command = ['--test', '--test-reporter=tap', ...sources];
  const child = spawnSync(process.execPath, command, {cwd: root, env, encoding: 'utf8', timeout: 10000});
  if (child.error || child.status !== exit) throw child.error ?? new Error(`${id}: unexpected exit ${child.status}: ${child.stderr}`);
  const stdout = `fixtures/nested-tap/raw/${id}.stdout.txt`;
  const stderr = `fixtures/nested-tap/raw/${id}.stderr.txt`;
  capturedFiles.set(stdout, child.stdout);
  capturedFiles.set(stderr, child.stderr);
  const lines = child.stdout.trimEnd().split('\n');
  const spans = [];
  const add = (kind, start, stop) => spans.push({kind, start_line: start + 1, end_line: stop, text: lines.slice(start, stop).join('\n')});
  if (decision === 'fallback') add('original', 0, lines.length);
  else {
    add('header', 0, 1);
    const starts = lines.flatMap((line, index) => /^# Subtest: /.test(line) ? [index] : []);
    const summary = lines.findIndex(line => /^1\.\./.test(line));
    if (summary < 0) throw new Error('Missing final plan');
    for (let index = 0; index < starts.length; index++) {
      const start = starts[index], stop = starts[index + 1] ?? summary;
      // Independent fixture annotation: copy the entire root branch if any
      // result under it is a failure, skip or todo. No guard import or metadata.
      if (lines.slice(start, stop).some(line => /^\s*not ok \d+ - /.test(line)
        || /^\s*(?:not )?ok \d+ - .* # (?:SKIP|TODO)(?:\s|$)/.test(line))) add('branch', start, stop);
    }
    add('summary', summary, lines.length);
  }
  fixtures.push({id, source_files: sources.map(path => ({path, sha256: hash(readFileSync(new URL('../'+path, import.meta.url)))})), source, source_sha256: hash(readFileSync(new URL('../'+source, import.meta.url))),
    stdout, stderr, stdout_sha256: hash(child.stdout), stderr_sha256: hash(child.stderr),
    process: {exit_code: exit, scope: ['node', ...command], truncated: false},
    expected_decision: decision, required_spans: spans});
}
for (const [path, contents] of capturedFiles) writeFileSync(new URL('../'+path, import.meta.url), contents);
writeFileSync(new URL('../fixtures/nested-tap/manifest.json', import.meta.url), JSON.stringify({
  schema_version: 1, node: process.version, captured_at: new Date().toISOString(),
  origin: 'Six controlled fixture programs plus this project regression command, executed by real node --test; not production traces or online model evidence.',
  regeneration: 'node evaluation/capture-nested-tap.mjs', fixtures
}, null, 2)+'\n');
console.log(`Captured ${fixtures.length} actual Node subprocess outputs`);
