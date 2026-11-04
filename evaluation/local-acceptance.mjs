import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareExperiment } from './prepare.mjs';
import { tasks, gradeTask, materializeTask } from './tasks.mjs';
import { runScriptedSession, defaultBinary } from './opencode-runtime.mjs';
import { parseEvents, summarizeEvents } from './telemetry.mjs';
import { importUsage, inspectOpenCodeSteps } from './usage.mjs';
import { accountLedger } from './ledger.mjs';
import { verificationInputs } from '../tools/source-digest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const hash = s => createHash('sha256').update(s).digest('hex');
const bash = command => ({ tool: 'bash', args: { command, description: 'ContextGuard controlled local acceptance' } });

export async function integrationInputs() {
  const files = verificationInputs(root).files.filter(x => /^(adapters|evaluation)\//.test(x.path));
  return hash(JSON.stringify({ files, compiled_core_sha256: hash(await readFile(join(root, 'dist/contextguard.mjs'))) }));
}

function scriptFor(task) {
  let stage = 0;
  return (body, step) => {
    assert(step < 10, 'scripted task step limit');
    if (stage === 0) { stage = 1; return bash(task.command); }
    if (stage === 1) {
      stage = 2;
      const text = body.messages.filter(x => x.role === 'tool').at(-1)?.content;
      assert.equal(typeof text, 'string');
      if (text.startsWith('{"contextguard":1')) {
        const header = JSON.parse(text.split('\n')[0]);
        return bash(header.recall_command.replace('START END', '1 10'));
      }
    }
    if (stage === 2) {
      stage = 3;
      if (!task.repair) return { text: 'Local control checked.' };
      const r = task.repair;
      const code = r.content !== undefined
        ? `require('node:fs').writeFileSync(${JSON.stringify(r.path)},${JSON.stringify(r.content)})`
        : `const fs=require('node:fs');const p=${JSON.stringify(r.path)};fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(${JSON.stringify(r.find)},${JSON.stringify(r.replace)}))`;
      return bash(`node -e ${quote(code)}`);
    }
    if (stage === 3) { stage = 4; return bash(task.command); }
    return { text: 'Scripted repair complete. This was not a model evaluation.' };
  };
}

async function inspectRuntime(directory, result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.timed_out, false);
  assert.deepEqual(result.failures, []);
  const events = parseEvents(await readFile(join(directory, '.contextguard/evidence/events.jsonl'), 'utf8'));
  const telemetry = summarizeEvents(events);
  assert(telemetry.loaded_instances > 0, 'actual project plugin loaded');
  assert.equal(telemetry.counts.unfinished, 0);
  assert.equal(telemetry.counts.missing_start, 0);
  assert.equal(telemetry.counts.delivery_mismatch, 0);
  const received = new Map();
  for (const r of result.requests) for (const m of r.body.messages ?? []) {
    if (m.role === 'tool') received.set(m.tool_call_id, m.content);
  }
  for (const call of telemetry.calls) if (call.hook) {
    assert.equal(typeof received.get(call.call_id), 'string', `provider request includes ${call.call_id}`);
    assert.equal(hash(received.get(call.call_id)), call.hook.visible_sha256, 'hook result equals actual next-request body');
  }
  const cli = result.stdout.split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
  const toolParts = cli.filter(x => x.type === 'tool_use').map(x => x.part);
  assert.equal(new Set(toolParts.map(x => x.callID)).size, telemetry.counts.total_calls, 'independent runtime tool inventory matches telemetry');
  const steps = inspectOpenCodeSteps(result.stdout);
  const usage = result.requests.map(r => ({ evidence_kind: 'synthetic', request_id: r.request_id,
    model: 'contextguard-fixture/fixture', category: r.main ? 'primary' : 'summary', response: r.response,
    cost: { source: 'synthetic', usd: 0 } }));
  const charges = importUsage(usage, { evidenceKind: 'synthetic', expectedModel: 'contextguard-fixture/fixture',
    expectedResponseModel: 'fixture',
    expectedRequests: result.requests.map(x => x.request_id) });
  await writeFile(join(directory, '.contextguard/usage.synthetic.jsonl'), usage.map(x => JSON.stringify(x)).join('\n') + '\n');
  return { telemetry, charges, steps, toolParts, received };
}

export async function localAcceptance({ binary = defaultBinary } = {}) {
  const privateRoot = join(root, '.contextguard/acceptance');
  await mkdir(privateRoot, { recursive: true });
  const base = await mkdtemp(join(privateRoot, 'run-'));
  const plan = await prepareExperiment(join(base, 'pairs'));
  const records = [], results = [];
  let currentRun = null;
  const reportPath = join(root, 'reports/integration-local.json');
  const report = { schema_version: 1, status: 'running', generated_at: new Date().toISOString(),
    evidence_kind: 'synthetic', boundary: 'Actual OpenCode 1.19.5 and real local tools; scripted loopback responses, oracle repairs and fabricated usage. No online model quality or billed-cost evidence.',
    integration_inputs_sha256: await integrationInputs(),
    artifacts_directory: base, results, online_model_evaluation: 'not_run', real_cost_evaluation: 'not_run' };
  const save = async () => {
    const text = JSON.stringify(report, null, 2) + '\n';
    await writeFile(reportPath, text);
    await writeFile(join(base, 'report.json'), text);
  };
  await save();
  try {
    for (const run of plan.runs) {
      currentRun = run.run_id;
      const task = tasks.find(t => t.id === run.task_id);
      const result = await runScriptedSession({ directory: run.workspace, stateDirectory: join(base, 'state', run.run_id),
        runId: run.run_id, mode: run.condition === 'original' ? 'observe' : 'guard', binary,
        allowCommands: task.format ? [{ command: task.command, scope: task.scope }] : [],
        prompt: run.prompt, nextAction: scriptFor(task) });
      const inspected = await inspectRuntime(run.workspace, result);
      const grade = await gradeTask(task, run.workspace);
      assert(grade.passed, `${run.run_id}: external grading failed`);
      if (task.origin === 'synthetic_fault' && task.format === 'node-tap') assert.equal(inspected.toolParts[0].state.metadata.exit, 1, 'failed process exit preserved');
      if (run.condition === 'original') assert.equal(inspected.telemetry.counts.applied, 0);
      else if (['flat-failure', 'nested-failure'].includes(task.id)) {
        assert(inspected.telemetry.counts.applied > 0);
        assert.equal(inspected.telemetry.counts.recalls, 1);
        const recalled = [...inspected.received.values()].find(x => x.includes('"audit_recorded":true'));
        assert(recalled, 'recall reply reaches the next provider request');
      } else if (task.id === 'rg-repair') {
        // Context lines are required by the current rg contract. Keep this
        // non-triggering task in the denominator; never weaken the contract.
        assert.equal(inspected.telemetry.counts.fallback, 2);
        assert.equal(inspected.telemetry.reasons.output_budget_exceeded, 2);
      } else assert.equal(inspected.telemetry.counts.applied, 0);
      records.push({ schema_version: 1, record_type: 'run', evidence_kind: 'synthetic', pair_id: run.pair_id,
        run_id: run.run_id, task_id: run.task_id, input_sha256: run.input_sha256,
        model: 'contextguard-fixture/fixture', settings: run.settings, condition: run.condition,
        status: 'completed', task_success: grade.passed, duration_ms: result.duration_ms,
        charges: inspected.charges, offline_optimization_ids: [] });
      results.push({ run_id: run.run_id, task_id: task.id, condition: run.condition, status: 'passed',
        grade, runtime: result.runtime, counts: inspected.telemetry.counts, reasons: inspected.telemetry.reasons,
        chars: inspected.telemetry.chars, provider_body_verified: true, source_kind: task.origin,
        request_usage_records: inspected.charges.length, session_usage_steps: inspected.steps.steps.length,
        duration_ms: result.duration_ms });
      await save();
      console.log(`passed: ${task.id} / ${run.condition}`);
    }
    // Runtime-specific boundaries use fresh workspaces and sessions, outside paired task outcomes.
    for (const variant of ['budget', 'truncated', 'unknown', 'tool-error']) {
      currentRun = `boundary-${variant}`;
      const task = { ...tasks[0], files: { ...tasks[0].files } };
      if (variant === 'unknown') task.files['test/task.test.cjs'] = await readFile(join(root, 'fixtures/nested-tap/sources/custom-log.cjs'), 'utf8');
      const directory = join(base, variant); await materializeTask(task, directory);
      const result = await runScriptedSession({ directory, stateDirectory: join(base, 'state', variant),
        runId: `boundary-${variant}`, binary, allowCommands: [{ command: task.command, scope: task.scope }],
        maxOutputChars: variant === 'budget' ? 1 : 12000, toolOutputBytes: variant === 'truncated' ? 1024 : undefined,
        nextAction: (_, step) => step === 0 ? variant === 'tool-error'
          ? { tool: 'read', args: { filePath: join(directory, 'does-not-exist.txt') } }
          : bash(task.command) : { text: 'Boundary recorded.' } });
      const inspected = await inspectRuntime(directory, result);
      assert.equal(inspected.telemetry.counts.fallback, variant === 'tool-error' ? 0 : 1, variant);
      assert.equal(inspected.telemetry.counts.applied, 0, variant);
      if (variant === 'tool-error') assert.equal(inspected.telemetry.counts.runtime_failed, 1);
      if (variant === 'truncated') assert.equal(inspected.telemetry.reasons.source_truncated, 1);
      results.push({ run_id: `boundary-${variant}`, status: 'passed', counts: inspected.telemetry.counts,
        reasons: inspected.telemetry.reasons, provider_body_verified: true });
      await save(); console.log(`passed: boundary-${variant}`);
    }
    const ledger = accountLedger(records);
    await writeFile(join(root, 'reports/integration-ledger.synthetic.jsonl'), records.map(x => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(join(root, 'reports/integration-ledger.synthetic.json'), JSON.stringify(ledger, null, 2) + '\n');
    assert.equal(await integrationInputs(), report.integration_inputs_sha256, 'integration sources stayed unchanged');
    report.status = 'passed'; report.paired_runs = records.length; report.pairs = ledger.counts.pairs;
    report.boundary_sessions = 4;
  } catch (error) { report.status = 'failed'; report.error = error.stack; report.failed_run = currentRun; throw error; }
  finally { await save(); }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await localAcceptance({ binary: process.argv[2] ? resolve(process.argv[2]) : defaultBinary }); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
