/** Repeatable actual-browser smoke/race checks; requires the installed Tabbit CLI. */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const launcher = join(homedir(), '.local/bin/tabbit-cli');
const task = 'ContextGuard Automated Regression';
const requestId = `demo-${Date.now()}`;
const url = process.env.CONTEXTGUARD_DEMO_URL ?? 'http://127.0.0.1:4188/';
const program = `
const checks = [];
await page.goto(${JSON.stringify(url)}, {waitUntil:'domcontentloaded'});
await expect(page.locator('#status-decision')).toHaveText('COMPRESSED');
const raw = await page.locator('#raw').inputValue();
await page.locator('.evidence-row').filter({hasText:'failure'}).click();
await expect(page.locator('#source-lines')).toContainText('ERR_ASSERTION');
checks.push('happy path and failure source recall');
await page.locator('#head-tail').click();
await expect(page.locator('#status-decision')).toHaveText('REPAIRED');
await expect(page.locator('#missing-count')).toContainText('4');
checks.push('head-tail missing evidence repaired');
await page.locator('#budget').fill('100');
await page.locator('#run').click();
await expect(page.locator('#status-decision')).toHaveText('FALLBACK');
await expect(page.locator('#output')).toHaveText(raw);
await expect(page.locator('#budget-feedback')).toContainText('超出预算');
checks.push('budget fallback preserves exact raw');
await page.locator('#budget').fill('');
await page.locator('#run').click();
await expect(page.locator('#status-decision')).toHaveText('ERROR');
await expect(page.locator('#budget')).toHaveAttribute('aria-invalid','true');
await expect(page.locator('#budget')).toBeFocused();
await expect(page.locator('#copy')).toBeDisabled();
checks.push('blank numeric field rejected and focused');
await page.locator('#budget').fill('12000');
await page.locator('#clear-candidate').click();
await expect(page.locator('#status-decision')).toHaveText('COMPRESSED');
await page.locator('#compare').click();
await expect(page.locator('#comparison tr')).toHaveCount(4);
await page.locator('.evidence-row').filter({hasText:'failure'}).click();
const snapshot = await page.locator('#source-lines').textContent();
await page.evaluate(() => {
  window.__demoNativeFetch = window.fetch;
  let hold = true;
  window.fetch = async (...args) => {
    if (args[0] === '/api/guard' && hold) {
      hold = false;
      const options = {...args[1]}; delete options.signal;
      const response = await window.__demoNativeFetch(args[0],options);
      window.__demoHeld = true;
      await new Promise(resolve => { window.__demoRelease = resolve; });
      return response;
    }
    return window.__demoNativeFetch(...args);
  };
});
try {
  await page.locator('#run').click();
  await page.waitForFunction(() => window.__demoHeld);
  await expect(page.locator('#head-tail')).toBeDisabled();
  await page.locator('#raw').fill('new input while old response is held');
  await expect(page.locator('#status-decision')).toHaveText('STALE');
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#comparison')).toContainText('输入已变更');
  await page.locator('.evidence-row').filter({hasText:'failure'}).click();
  await expect(page.locator('#source-lines')).toHaveText(snapshot);
  await page.locator('#format').selectOption('unknown');
  await page.locator('#run').click();
  await expect(page.locator('#status-decision')).toHaveText('FALLBACK');
  await page.evaluate(async () => { window.__demoRelease(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await expect(page.locator('#output')).toHaveText('new input while old response is held');
  await expect(page.locator('#status-decision')).toHaveText('FALLBACK');
  checks.push('late real HTTP response discarded; exact old evidence snapshot retained; comparison invalidated');
} finally {
  await page.evaluate(() => { window.__demoRelease?.(); window.fetch = window.__demoNativeFetch; });
}
await page.locator('#fixture').selectOption('node-tap-all-pass');
await expect(page.locator('#status-decision')).toHaveText('COMPRESSED');
await page.locator('#fixture').selectOption('node-tap-middle-failure');
await expect(page.locator('#status-decision')).toHaveText('COMPRESSED');
const layouts = [];
for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  await page.setViewportSize(viewport);
  const layout = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.ok(layout.scrollWidth <= layout.width);
  layouts.push(layout);
}
checks.push('desktop and mobile have no page-level horizontal overflow');
await page.close();
return {checks,layouts,url:${JSON.stringify(url)},faultInjection:'The race check holds a real HTTP response and deliberately ignores AbortSignal.'};
`;

function call(args, input) {
  try { return JSON.parse(execFileSync(launcher, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 70000, stdio: ['pipe', 'pipe', 'inherit'] })); }
  catch (error) {
    if (error.stdout) {
      try { return JSON.parse(error.stdout); } catch { /* Preserve launch/transport errors. */ }
    }
    throw error;
  }
}
let result = call(['nodejs', '--task', task, '--request-id', requestId, '--timeout-ms', '60000'], program);
while (['running', 'queued'].includes(result.status)) result = call(['receipt', '--task', task, '--request-id', requestId, '--wait-ms', '60000']);
if (result.status !== 'succeeded') {
  console.error(JSON.stringify(result, null, 2));
  // Retain the browser task and receipt for inspection after an uncertain failure.
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result.value, null, 2));
  const finished = call(['finish', '--task', task]);
  if (finished.forcedCleanup) throw new Error('Tabbit finish required forced cleanup; inspect retained task state.');
}
