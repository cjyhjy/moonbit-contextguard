import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync,openSync,closeSync,readSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runProcess,renderForAgent} from '../tools/run.mjs';
import {readRequest,MAX_REQUEST_CHARS} from '../tools/input.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const base=mkdtempSync(join(tmpdir(),'contextguard-runtime-'));
process.on('exit',()=>rmSync(base,{recursive:true,force:true}));
const env={...process.env};delete env.NODE_TEST_CONTEXT;
let sequence=0;
const options=()=>({cwd:root,env,captureDir:join(base,`capture-${sequence++}`)});

test('invalid execution options are rejected before any filesystem or process side effects',async()=>{
  const marker=join(base,'must-not-exist');
  const argv=[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
  for(const invalid of [{maxOutputChars:-1},{maxOutputChars:4194305},{maxOutputChars:1.5},{timeoutMs:2147483648},{timeoutMs:0},{maxCaptureBytes:67108865},{maxCaptureBytes:0},{format:7}]) {
    const o={...options(),...invalid};
    await assert.rejects(runProcess(argv,o),TypeError);
    assert.equal(existsSync(marker),false);
    assert.equal(existsSync(o.captureDir),false);
  }
  for(const badArgv of [[],[''],[process.execPath,'\0']])await assert.rejects(runProcess(badArgv,options()),TypeError);
});

test('post-execution storage failure returns captured stdout, stderr and a distinct runner failure',async()=>{
  const o=options();
  const code=`require('node:fs').rmSync(${JSON.stringify(o.captureDir)},{recursive:true});process.stdout.write('evidence remains\\n');process.stderr.write('diagnostic remains\\n');process.exitCode=7`;
  const r=await runProcess([process.execPath,'-e',code],o);
  assert.equal(r.output,'evidence remains\n');
  assert.equal(r.stderr,'diagnostic remains\n');
  assert.equal(r.process.exit_code,7);
  assert.equal(r.runner_exit_code,125);
  assert.equal(r.reason,'evidence_storage_failed');
  assert.equal(r.capture.available,false);
  assert.equal(r.capture.error_code,'ENOENT');
  assert.equal(r.output_kind,'original');
  assert.match(renderForAgent(r),/evidence=unavailable; storage_error=ENOENT/u);
  assert.doesNotMatch(renderForAgent(r),/recall:/u);
});

test('delivery metrics include stderr and the complete visible envelope',async()=>{
  const r=await runProcess([process.execPath,'-e',"process.stdout.write('中😀');process.stderr.write('bad')"],options());
  const m=r.delivery_metrics;
  assert.equal(r.runner_exit_code,0);
  assert.equal(m.char_unit,'utf16_code_units');
  assert.equal(m.original_body_chars,6);
  assert.equal(m.delivered_body_chars,6);
  assert.equal(m.agent_visible_chars,renderForAgent(r).length);
  assert.equal(m.envelope_chars,m.agent_visible_chars-6);
  assert.equal(m.net_reduction_chars,6-m.agent_visible_chars);
  assert(m.net_reduction_chars<0);
});

test('descendant pipe timeout cannot masquerade as a successful runner after parent exit zero',{skip:process.platform==='win32'},async()=>{
  const code="require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]}).unref();process.stdout.write('parent done\\n')";
  const r=await runProcess([process.execPath,'-e',code],{...options(),timeoutMs:500});
  assert.equal(r.output,'parent done\n');
  assert.equal(r.process.exit_code,0);
  assert.equal(r.process.exit_code_source,'process');
  assert.equal(r.process.timed_out,true);
  assert.equal(r.process.truncated,true);
  assert.equal(r.runner_exit_code,124);
});

test('detached descendants cannot hold the runner beyond its deadline through inherited pipes',{skip:process.platform==='win32'},async()=>{
  const code="const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{detached:true,stdio:['ignore',1,2]});c.unref();console.log('descendant_pid:'+c.pid)";
  const start=performance.now();
  const r=await runProcess([process.execPath,'-e',code],{...options(),timeoutMs:500});
  const elapsed=performance.now()-start;
  const pid=Number(r.output.match(/descendant_pid:(\d+)/u)?.[1]);
  try {
    assert(Number.isInteger(pid)&&pid>0,r.output);
    assert(elapsed<2000,`runner waited ${elapsed} ms for a detached descendant`);
    assert.equal(r.process.exit_code,0);
    assert.equal(r.process.timed_out,true);
    assert.equal(r.runner_exit_code,124);
  } finally {
    if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
});

test('bounded UTF-8 reader counts UTF-16 and handles split multibyte sequences',()=>{
  const file=join(base,'utf8-request');
  const source='x'.repeat(65535)+'😀中';
  writeFileSync(file,source);
  assert.equal(readRequest(file,source.length),source);
  assert.throws(()=>readRequest(file,source.length-1),/request_budget_exceeded/u);
  writeFileSync(file,Buffer.from([0x61,0xc3]));
  assert.throws(()=>readRequest(file),TypeError);
  writeFileSync(file,'\ufeff{}');
  assert.equal(readRequest(file),'\ufeff{}');
});

test('budget exhaustion stops file reads early and leaves caller-owned fd open',()=>{
  const file=join(base,'over-budget-request');writeFileSync(file,'x'.repeat(200000));
  const fd=openSync(file,'r');
  try {
    assert.throws(()=>readRequest(fd,100),/request_budget_exceeded/u);
    const next=Buffer.alloc(1);
    assert.equal(readSync(fd,next,0,1,null),1);
    assert.equal(next.toString(),'x');
  } finally {closeSync(fd);}
});

test('CLI rejects duplicate request keys, malformed UTF-8 and oversized input without stdout',()=>{
  for(const [input,reason] of [
    ['{"raw":"a","raw":"b"}',/invalid_json_request/u],
    [Buffer.from([0xff]),/encoded data/u],
    ['x'.repeat(MAX_REQUEST_CHARS+1),/request_budget_exceeded/u],
  ]) {
    const r=spawnSync(process.execPath,['tools/cli.mjs'],{cwd:root,env,input,encoding:'utf8',timeout:10000});
    assert.equal(r.status,2,r.stderr);
    assert.equal(r.stdout,'');
    assert.match(JSON.parse(r.stderr).error,reason);
  }
});

test('runner CLI returns 125 on capture overflow while preserving a parseable result',()=>{
  const o=options();
  const r=spawnSync(process.execPath,['tools/run.mjs','--capture-dir',o.captureDir,'--max-capture-bytes','8','--',process.execPath,'-e',"process.stdout.write('x'.repeat(100000))"],{cwd:root,env,encoding:'utf8',timeout:10000});
  assert.equal(r.status,125,r.stderr);
  const result=JSON.parse(r.stdout);
  assert.equal(result.output,'xxxxxxxx');
  assert.equal(result.process.capture_limit_hit,true);
  assert.equal(result.runner_exit_code,125);
});
