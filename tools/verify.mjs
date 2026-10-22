#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceDigest,verificationInputs} from './source-digest.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const portable=process.argv.includes('--portable');
const githubActions=process.env.GITHUB_ACTIONS==='true';
const execution=githubActions?{environment:'github_actions',repository:process.env.GITHUB_REPOSITORY,commit_sha:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,run_attempt:process.env.GITHUB_RUN_ATTEMPT}:{environment:'local'};
mkdirSync(join(root,'reports/logs'),{recursive:true});
const checks=[];
const clean=text=>String(text??'').replaceAll(root,'<PROJECT_ROOT>/').replaceAll(process.env.MOON_HOME||'\0','<MOON_HOME>');
function run(id,command,args) {
  const start=performance.now();
  const r=spawnSync(command,args,{cwd:root,env:process.env,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
  const log=clean((r.stdout??'')+(r.stderr??'')+(r.error?'\n'+r.error.message:''));
  writeFileSync(join(root,`reports/logs/${id}.log`),log);
  const item={id,command:[command,...args],status:r.status===0&&!r.error?'passed':'failed',exit_code:r.status,signal:r.signal,elapsed_ms:performance.now()-start,log:`reports/logs/${id}.log`};
  checks.push(item);console.log(`${item.status}: ${id}`);if(item.status==='failed')console.error(log.slice(-5000));
}
if(!portable) {
  run('moon-version','sh',['tools/moon','version','--all']);
  run('moon-format','sh',['tools/moon','fmt','--check']);
  for(const target of ['js','native','wasm-gc']) {
    run(`moon-check-${target}`,'sh',['tools/moon','check','--target',target]);
    run(`moon-build-${target}`,'sh',['tools/moon','build','--target',target,'--release']);
    run(`moon-test-${target}`,'sh',['tools/moon','test','--target',target]);
  }
  run('moon-build',process.execPath,['tools/build.mjs']);
}
try {
  const m=JSON.parse(readFileSync(join(root,'dist/build-manifest.json')));
  const compiled=createHash('sha256').update(readFileSync(join(root,'dist/contextguard.mjs'))).digest('hex');
  if(m.source.sha256!==sourceDigest(root).sha256||m.artifact_sha256!==compiled)throw new Error('generated JS or source digest mismatch; rebuild required');
  checks.push({id:'compiled-source-correspondence',status:'passed',source_sha256:m.source.sha256,artifact_sha256:compiled});
} catch(error) {checks.push({id:'compiled-source-correspondence',status:'failed',error:error.message});}
const tests=readdirSync(join(root,'tests')).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'tests/'+x);
run('public-api-process-adapter-http-tests',process.execPath,['--test',...tests]);
run('paired-ledger-tests',process.execPath,['--test','evaluation/ledger.test.mjs']);
run('independent-evaluation',process.execPath,['evaluation/evaluate.mjs']);
run('independent-mutation-audit',process.execPath,['evaluation/audit.mjs']);
run('paired-ledger-example',process.execPath,['evaluation/ledger.mjs','evaluation/example-ledger.synthetic.jsonl','--output','reports/evaluation-ledger.synthetic.json']);
run('json-cli',process.execPath,['tools/cli.mjs','fixtures/example-request.json']);
run('example',process.execPath,['tools/example.mjs']);
const report={schema_version:1,project:'ContextGuard',version:'0.1.0',generated_at:new Date().toISOString(),user_timezone:'America/New_York',mode:portable?'portable_prebuilt':'source_and_prebuilt',status:checks.every(c=>c.status==='passed')?'passed':'failed',environment:{node:process.version,platform:process.platform,arch:process.arch},execution,source:sourceDigest(root),inputs:verificationInputs(root),checks,external_evidence:{fixtures:'fixtures/manifest.json',comparison:'reports/evaluation.json',peer_pins:'research/peers-lock.json',adapter:'reports/adapter-protocol.json',browser:'reports/demo-browser.json'},not_tested:['online_model_task_success','actual_model_token_counts','provider_billed_cost_or_net_savings','live_agent_installation',...(!githubActions?['remote_CI']:[]),'public_package_publication','formal_contest_submission'],boundary:'All workload sources are synthetic; captured stdout/stderr are historical real process fixtures. Fresh peer availability and unrun entries are recorded in evaluation.json. Portable mode does not compile MoonBit. execution records this run only; no online agent or package publication is certified.'};
writeFileSync(join(root,portable?'reports/verification-portable.json':'reports/verification.json'),JSON.stringify(report,null,2)+'\n');
if(report.status!=='passed')process.exitCode=1;
