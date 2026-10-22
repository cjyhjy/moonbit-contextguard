import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess,renderForAgent} from '../tools/run.mjs';
import {recall} from '../tools/recall.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const base=mkdtempSync(join(tmpdir(),'contextguard-process-test-'));
process.on('exit',()=>rmSync(base,{recursive:true,force:true}));
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
let seq=0;const options=()=>({cwd:root,captureDir:join(base,String(seq++)),env:childEnv});
test('real failed test process, stderr and indexed recall',async()=>{
  const fixture=JSON.parse(readFileSync(join(root,'fixtures/manifest.json'))).fixtures.find(f=>f.format==='node-tap');
  const result=await runProcess([process.execPath,'--test','--test-reporter=tap','fixtures/sources/many-tests.test.cjs'],{...options(),format:'node-tap'});
  assert.equal(result.process.exit_code,1);
  assert.equal(result.decision,'compressed');
  assert.ok(result.output.includes('not ok 37'));
  assert.equal(result.process.truncated,false);
  assert.ok(renderForAgent(result).includes('exit_code=1'));
  const capture=result.capture.directory;
  assert.ok(readFileSync(join(capture,'stdout.bin')).length+readFileSync(join(capture,'stderr.bin')).length>0);
  const recalled=recall(capture,'stderr',1,50);assert.equal(recalled.sha256,result.capture.sha256.stderr);
  assert.ok(fixture.required_evidence.length>0);
});
test('unknown format passes stdout and stderr plus exact exit status',async()=>{
  const r=await runProcess([process.execPath,'-e',"process.stdout.write('hello\\n');process.stderr.write('problem\\n');process.exitCode=7"],options());
  assert.equal(r.output,'hello\n');assert.equal(r.stderr,'problem\n');assert.equal(r.process.exit_code,7);assert.equal(r.decision,'fallback');
  assert.equal(recall(r.capture.directory,'stdout',1,1).text,'hello');
});
test('capture integrity detects modified stored evidence',async()=>{
  const r=await runProcess([process.execPath,'-e',"console.log('evidence')"],options());
  writeFileSync(join(r.capture.directory,'stdout.bin'),'tampered');
  assert.throws(()=>recall(r.capture.directory),/integrity/);
});
test('capture path collision never overwrites old run',async()=>{
  const o=options();await runProcess([process.execPath,'-e',''],o);
  await assert.rejects(runProcess([process.execPath,'-e',''],o),/EEXIST/);
});
test('timeout and output limit explicitly mark incomplete captures',async()=>{
  const timed=await runProcess([process.execPath,'-e','setInterval(()=>{},1000)'],{...options(),timeoutMs:80});
  assert.equal(timed.process.timed_out,true);assert.equal(timed.process.truncated,true);assert.equal(timed.decision,'fallback');
  const cap=await runProcess([process.execPath,'-e',"process.stdout.write('x'.repeat(10000))"],{...options(),maxCaptureBytes:100});
  assert.equal(cap.output.length,100);assert.equal(cap.process.capture_limit_hit,true);assert.equal(cap.process.truncated,true);
});
test('spawn failure and binary output do not masquerade as complete text',async()=>{
  const missing=await runProcess(['contextguard-definitely-no-such-command-92834'],options());
  assert.equal(missing.process.exit_code,127);assert.ok(missing.process.spawn_error);
  const binary=await runProcess([process.execPath,'-e','process.stdout.write(Buffer.from([0xff,0x00]))'],options());
  assert.equal(binary.reason,'non_utf8_capture');assert.equal(binary.process.invalid_utf8,true);
  assert.deepEqual([...readFileSync(join(binary.capture.directory,'stdout.bin'))],[255,0]);
});
test('signal termination preserves signal-specific shell status and incomplete flag',async()=>{
  const r=await runProcess([process.execPath,'-e',"process.kill(process.pid,'SIGTERM')"],options());
  assert.equal(r.process.exit_code,143);assert.equal(r.process.signal,'SIGTERM');assert.equal(r.process.truncated,true);
});
