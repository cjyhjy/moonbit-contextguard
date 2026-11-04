import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const digest = value => createHash('sha256').update(value).digest('hex');
const flatTest = "const {test}=require('node:test');const assert=require('node:assert/strict');const add=require('../src/value.cjs');\nfor(let i=0;i<70;i++)test('padding '+i,()=>assert.equal(i,i));\ntest('sum regression',()=>assert.equal(add(9,4),13));\n";
const nestedTest = "const {test,describe}=require('node:test');const assert=require('node:assert/strict');const add=require('../src/value.cjs');\nfor(let i=0;i<70;i++)test('padding '+i,()=>{});\ndescribe('outer',()=>describe('inner',()=>test('sum regression',()=>assert.equal(add(9,4),13))));\n";
const tapCommand = 'node --test --test-reporter=tap test/task.test.cjs';
const mathTask = (id, testSource) => ({ id, origin: 'synthetic_fault',
  prompt: '修复 src/value.cjs 中的加法错误，运行 Node TAP 测试确认。保留全部测试文件，不改变测试断言。',
  command: tapCommand, format: 'node-tap', scope: ['test/task.test.cjs'],
  files: { 'src/value.cjs': 'module.exports = (a,b) => a-b;\n', 'test/task.test.cjs': testSource },
  protected: ['test/task.test.cjs'], repair: { path: 'src/value.cjs', content: 'module.exports = (a,b) => a+b;\n' },
  grade: "const add=require(process.argv[1]);assert.equal(add(1,2),3);assert.equal(add(-5,2),-3);assert.equal(add(0,0),0);" });

export const tasks = [
  mathTask('flat-failure', flatTest),
  mathTask('nested-failure', nestedTest),
  { id: 'rg-repair', origin: 'synthetic_fault',
    prompt: '搜索 src 中的 needle 配置，把导出的值修正为 needle-good。用同样的 rg JSON 命令检查修改。',
    command: 'rg --json --no-config --context 30 needle src', format: 'rg-json', scope: ['src'],
    files: { 'src/value.cjs': Array.from({ length: 30 }, (_,i) => `// context before ${i} ${'x'.repeat(50)}`).join('\n') +
      "\nmodule.exports = 'needle-bad';\n" + Array.from({ length: 30 }, (_,i) => `// context after ${i} ${'y'.repeat(50)}`).join('\n') + '\n' },
    protected: [], repair: { path: 'src/value.cjs', find: "'needle-bad'", replace: "'needle-good'" },
    grade: "assert.equal(require(process.argv[1]),'needle-good');" },
  { id: 'unsupported-control', origin: 'synthetic_control',
    prompt: '检查 src/value.cjs 的配置值是否为 ready，运行 node scripts/check.cjs；无需改变已经正确的配置。',
    command: 'node scripts/check.cjs', format: null, scope: ['scripts/check.cjs'],
    files: { 'src/value.cjs': "module.exports = 'ready';\n", 'scripts/check.cjs': "console.log('Configuration is ready');\n" },
    protected: ['scripts/check.cjs'], repair: null, grade: "assert.equal(require(process.argv[1]),'ready');" },
  { id: 'short-control', origin: 'synthetic_control',
    prompt: '运行 Node TAP 测试确认 src/value.cjs 的配置是 ready；无需改变已经正确的实现，保留全部测试。',
    command: tapCommand, format: 'node-tap', scope: ['test/task.test.cjs'],
    files: { 'src/value.cjs': "module.exports = 'ready';\n", 'test/task.test.cjs': "const {test}=require('node:test');test('ready',()=>require('node:assert/strict').equal(require('../src/value.cjs'),'ready'));\n" },
    protected: ['test/task.test.cjs'], repair: null, grade: "assert.equal(require(process.argv[1]),'ready');" },
];

export function snapshot(task) {
  return digest(JSON.stringify({ prompt: task.prompt, command: task.command, files: Object.entries(task.files).sort() }));
}

export async function materializeTask(task, directory) {
  await mkdir(directory, { recursive: false });
  for (const [path, text] of Object.entries(task.files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), text);
  }
  return { input_sha256: snapshot(task), protected_hashes: Object.fromEntries(task.protected.map(p => [p, digest(task.files[p])])) };
}

export async function gradeTask(task, directory) {
  for (const path of task.protected) {
    try { if (digest(await readFile(join(directory, path))) !== digest(task.files[path])) return { passed: false, reason: 'protected_test_modified', path }; }
    catch { return { passed: false, reason: 'protected_test_missing', path }; }
  }
  // Assertions come from this external harness, not from agent-editable test files.
  const r = spawnSync(process.execPath, ['-e', "const assert=require('node:assert/strict');" + task.grade, join(directory, 'src/value.cjs')],
    { cwd: directory, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  return { passed: r.status === 0 && !r.error, reason: r.status === 0 && !r.error ? 'independent_assertions_passed' : 'independent_assertions_failed',
    exit_code: r.status, error: r.error?.code ?? null };
}
