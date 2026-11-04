import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tasks, materializeTask } from './tasks.mjs';

export async function prepareExperiment(directory, { model = null, budget = null, selectedTasks = tasks, repeats = 1 } = {}) {
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats must be 1..10');
  await mkdir(directory, { recursive: false });
  const rg = spawnSync('rg', ['--version'], { encoding: 'utf8', timeout: 5000 });
  const plan = { schema_version: 1, experiment_id: randomUUID(), status: 'prepared',
    model, budget, online_execution_ready: false,
    missing_online_configuration: ['provider/model version and parameters', 'total dollar/token budget', 'per-run step/time/token limits', 'complete provider usage capture'],
    baseline: 'OpenCode native output with the same observer; native truncation/compaction unchanged',
    tool_versions: { opencode: '1.19.5', node: process.version, rg: rg.status === 0 ? rg.stdout.split('\n')[0] : null },
    boundary: 'Prepared synthetic tasks. No model calls or online outcomes. No answer patches are copied into task workspaces.', runs: [] };
  let pairIndex = 0;
  for (let repeat = 0; repeat < repeats; repeat++) for (const task of selectedTasks) {
    const label = `${task.id}-repeat-${repeat + 1}`;
    const pairId = `${plan.experiment_id}-${label}`;
    const order = pairIndex++ % 2 === 0 ? ['original', 'guard'] : ['guard', 'original'];
    for (const condition of order) {
      const runId = randomUUID();
      const workspace = join(directory, `${label}-${condition}`);
      const initial = await materializeTask(task, workspace);
      plan.runs.push({ pair_id: pairId, run_id: runId, task_id: task.id, origin: task.origin, repeat: repeat + 1,
        condition, workspace, prompt: task.prompt, command: task.command, ...initial,
        settings: { ...plan.tool_versions, model, budget, native_output_settings: 'default' } });
    }
  }
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node evaluation/prepare.mjs NEW_DIRECTORY');
    const plan = await prepareExperiment(resolve(process.argv[2]));
    console.log(JSON.stringify({ plan: join(resolve(process.argv[2]), 'plan.json'), runs: plan.runs.length,
      online_execution_ready: plan.online_execution_ready, missing: plan.missing_online_configuration }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
