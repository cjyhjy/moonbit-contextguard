import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { prepareExperiment } from './prepare.mjs';
import { tasks, gradeTask } from './tasks.mjs';
import { integrationInputs } from './local-acceptance.mjs';
import { BudgetBook, rateCard } from './online-budget.mjs';
import { startCaptureProxy } from './online-proxy.mjs';
import { validatePinnedRuntime, runOnlineSession, inspectOnlineRun, taskProtocol } from './online-runtime.mjs';
import { parseDeepSeekStream, accountNativeRequests } from './deepseek-usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";
const privateJSON = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export async function loadAuthorizedKey(path) {
  const text = await readFile(path, 'utf8');
  const matches = text.split(/\r?\n/).map(x => x.match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*?)\s*$/)).filter(Boolean);
  if (matches.length !== 1) throw new Error('Expected one DeepSeek credential entry');
  let key = matches[0][1];
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1,-1);
  if (!key || /\s/.test(key)) throw new Error('Invalid credential entry');
  return key;
}

async function providerGet(path, key) {
  const r = await fetch(`https://api.deepseek.com${path}`, { headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!r.ok) throw new Error(`Provider read-only check failed: HTTP ${r.status}`);
  return r.json();
}

export function controlledTasks() {
  return tasks.map(task => ({ ...task, prompt: task.prompt +
    `\n本次任务的工作目录就是当前目录。先用 bash 单独运行以下完整命令进行诊断；不要拼接 cd、管道或其他命令：\n${task.command}\n` +
    '如果修改了实现，最后再次用完全相同的命令验证。可使用 read/edit 等本地文件工具。只修改 src 下的实现，保留测试、脚本、配置和日志。' +
    '如工具输出提供了回查命令，可在需要原始细节时按其说明回查。完成后简要报告实际结果。' }));
}

function summarizePairs(results) {
  const groups = new Map();
  for (const r of results) { const g=groups.get(r.pair_id)??{};g[r.condition]=r;groups.set(r.pair_id,g); }
  return [...groups].map(([id,p]) => {
    const a=p.original,b=p.guard;
    if(!a||!b)return {pair_id:id,complete:false};
    const sameFingerprints=JSON.stringify(a.fingerprints)===JSON.stringify(b.fingerprints)&&a.fingerprints.length===1;
    return { pair_id:id,task_id:a.task_id,complete:true,comparable_backend_fingerprint:sameFingerprints,
      original_success:a.task_success,guard_success:b.task_success,
      original_cost:a.accounting.peak_rate_estimated_cost,guard_cost:b.accounting.peak_rate_estimated_cost,
      guard_minus_original_cost:Number((b.accounting.peak_rate_estimated_cost-a.accounting.peak_rate_estimated_cost).toFixed(9)),
      original_usage:a.accounting.usage,guard_usage:b.accounting.usage,
      original_duration_ms:a.duration_ms,guard_duration_ms:b.duration_ms,guard_counts:b.counts,
      guard_chars:b.chars,original_requests:a.request_count,guard_requests:b.request_count };
  });
}

export async function onlinePilot({ credentialFile }) {
  const key = await loadAuthorizedKey(credentialFile);
  const runtime = await validatePinnedRuntime();
  const [balance,models] = await Promise.all([providerGet('/user/balance',key),providerGet('/models',key)]);
  const account = balance.balance_infos?.find(x => x.currency==='CNY') ?? balance.balance_infos?.find(x=>x.currency==='USD');
  if (!balance.is_available || !account || !(Number(account.total_balance)>0)) throw new Error('Provider balance unavailable');
  if (!models.data?.some(x=>x.id===rateCard.model)) throw new Error('Requested model not in provider list');
  const parent = join(root,'.contextguard/online'); await mkdir(parent,{recursive:true,mode:0o700});
  const base = await mkdtemp(join(parent,'pilot-'));
  const book = new BudgetBook(join(base,'budget.json'),{currency:account.currency,available:Number(account.total_balance)});
  await privateJSON(join(base,'balance-before.json'),{observed_at:new Date().toISOString(),...balance});
  await privateJSON(join(base,'models-before.json'),models);
  const children = new Map();
  const report = {schema_version:1,experiment_id:randomUUID(),status:'running',evidence_kind:'measured_online',
    task_source:'synthetic_fault_and_control',started_at:new Date().toISOString(),user_timezone:'America/Los_Angeles',
    artifacts_directory:base,integration_inputs_sha256:await integrationInputs(),runtime,
    model:{provider:'DeepSeek official',request_model:rateCard.model,published_version:rateCard.published_version,
      thinking:'disabled',temperature:0.2,max_output_tokens:4096,auxiliary_model:rateCard.model},
    budget:book.summary(),rate_card:rateCard,results:[],probes:[],issues:[],
    boundary:'Real model autonomous execution on five controlled synthetic tasks. Peak official rate estimates are not independently attributed provider bills. No population-level quality or savings claim.'};
  const reportPath=join(root,'reports/online-pilot.json');
  const save=async()=>{
    report.budget=book.summary();report.updated_at=new Date().toISOString();report.pairs=summarizePairs(report.results);
    await privateJSON(join(base,'report.json'),report);await privateJSON(reportPath,report);
  };
  await save();
  console.log(JSON.stringify({event:'pilot_started',directory:base,currency:account.currency,effective_budget:book.summary().total_limit}));
  const proxy=await startCaptureProxy({directory:join(base,'requests'),apiKey:key,book,
    onFatal:(runId,reason)=>{children.get(runId)?.(reason);},
    onRecord:r=>console.log(JSON.stringify({event:'request_recorded',run_id:r.run_id,category:r.category,cost:r.cost,total_cost:r.budget.settled_cost}))});
  try {
    // Minimal protocol probe. Explicit tool selection is not counted as autonomous task success.
    const probeId='protocol-'+randomUUID(),probeURL=proxy.openRun(probeId,{probe:true});
    const messages=[{role:'user',content:'Call verify_capture with value ready.'}];
    const tools=[{type:'function',function:{name:'verify_capture',description:'Confirm local protocol capture',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}];
    const call=async body=>{
      const r=await fetch(probeURL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${proxy.localToken}`},body:JSON.stringify({model:rateCard.model,...body})});
      if(!r.ok)throw new Error('Protocol probe failed');return parseDeepSeekStream(await r.text());
    };
    const first=await call({messages,tools,tool_choice:{type:'function',function:{name:'verify_capture'}},max_tokens:128});
    const requested=first.message.tool_calls?.[0];
    if(requested?.function.name!=='verify_capture'||JSON.parse(requested.function.arguments).value!=='ready')throw new Error('Protocol tool-call probe failed');
    const second=await call({messages:[...messages,first.message,{role:'tool',tool_call_id:requested.id,content:'ready'}],max_tokens:128});
    await proxy.closeRun(probeId);
    report.probes.push({kind:'protocol',run_id:probeId,status:'passed',requests:2,model:second.model,system_fingerprint:second.system_fingerprint});
    await save();
    const selected=controlledTasks();
    const plan=await prepareExperiment(join(base,'pairs'),{selectedTasks:selected,model:report.model,
      budget:{currency:account.currency,total:book.summary().total_limit,per_run:book.state.run_limit_nano/1e9,max_requests:12,timeout_ms:480000}});
    plan.online_execution_ready=true;plan.missing_online_configuration=[];
    plan.authorization='User explicitly authorized existing DeepSeek key reuse and the proposed five-pair budget.';
    await privateJSON(join(base,'pairs/plan.json'),plan);
    for(const run of plan.runs){
      if(book.state.halted)throw new Error('Provider accounting halted');
      const available=await providerGet('/user/balance',key);
      await privateJSON(join(base,`balance-${run.run_id}.json`),{observed_at:new Date().toISOString(),...available});
      const remaining=Number(available.balance_infos?.find(x=>x.currency===account.currency)?.total_balance);
      if(!available.is_available||!(remaining>=book.reserveNano/1e9))throw new Error('Available balance below conservative request reservation');
      const task=selected.find(t=>t.id===run.task_id);
      console.log(JSON.stringify({event:'run_started',task:task.id,condition:run.condition,run_id:run.run_id}));
      const result=await runOnlineSession({directory:run.workspace,stateDirectory:join(base,'state',run.run_id),
        runId:run.run_id,mode:run.condition==='original'?'observe':'guard',allowCommands:task.format?[{command:task.command,scope:task.scope}]:[],
        extraBashCommands:[task.command],prompt:run.prompt,proxy,childRegistry:children});
      const records=proxy.records.filter(r=>r.run_id===run.run_id);
      const inspected=await inspectOnlineRun({directory:run.workspace,result,records,book,runId:run.run_id});
      const grade=await gradeTask(task,run.workspace);
      const protocol=taskProtocol(task,inspected.toolParts);
      const value={run_id:run.run_id,pair_id:run.pair_id,task_id:run.task_id,condition:run.condition,input_sha256:run.input_sha256,
        status:inspected.issues.length?'evidence_incomplete':'completed',grade,protocol,task_success:grade.passed&&protocol.passed,duration_ms:result.duration_ms,
        accounting:inspected.accounting,fingerprints:inspected.fingerprints,request_count:inspected.request_count,
        auxiliary_requests:inspected.auxiliary_requests,counts:inspected.telemetry?.counts,reasons:inspected.telemetry?.reasons,
        chars:inspected.telemetry?.chars,tool_output_tokens:null,tool_tokenizer:null,
        delivery:inspected.delivery,issues:inspected.issues,exit_code:result.code,
        initial_diagnostic_exit:inspected.toolParts.find(x=>x.tool==='bash'&&x.state?.input?.command===task.command)?.state?.metadata?.exit??null};
      report.results.push(value);
      await privateJSON(join(base,'state',run.run_id,'inspection.json'),inspected);
      await save();console.log(JSON.stringify({event:'run_completed',task:task.id,condition:run.condition,passed:value.task_success,
        issues:inspected.issues,applied:value.counts?.applied,cost:value.accounting.peak_rate_estimated_cost}));
      if(inspected.issues.length)throw new Error('Runtime or accounting evidence requires repair before continuing');
    }
    // Isolated recall capability probe; never append its audit events to task logs.
    const source=proxy.records.flatMap(r=>(r.body.messages??[]).filter(x=>x.role==='tool').map(x=>x.content))
      .find(x=>typeof x==='string'&&x.startsWith('{"contextguard":1'));
    if(source){
      const header=JSON.parse(source.split('\n')[0]),probeRun='recall-'+randomUUID();
      const directory=join(base,'recall-probe');await mkdir(directory,{mode:0o700});
      const evidence=join(directory,'.contextguard/evidence');await mkdir(evidence,{recursive:true,mode:0o700});
      const receipt=join(evidence,basename(header.receipt));
      await copyFile(header.receipt,receipt);
      const receiptData=JSON.parse(await readFile(receipt,'utf8'));
      await copyFile(join(dirname(header.receipt),receiptData.raw_file),join(evidence,receiptData.raw_file));
      const command=`node ${quote(join(root,'adapters/recall.mjs'))} ${quote(receipt)} 1 10`;
      const result=await runOnlineSession({directory,stateDirectory:join(base,'state',probeRun),runId:probeRun,mode:'observe',
        allowCommands:[],extraBashCommands:[command],prompt:`这是单独的回查能力探针，不是修复任务。请只用 bash 原样执行此命令，并根据真实返回简短说明首行内容，不要读取或修改文件：\n${command}`,
        proxy,childRegistry:children});
      const inspected=await inspectOnlineRun({directory,result,records:proxy.records.filter(r=>r.run_id===probeRun),book,runId:probeRun});
      report.probes.push({kind:'explicit_recall',run_id:probeRun,status:!inspected.issues.length&&inspected.telemetry.counts.recalls===1?'passed':'failed',
        accounting:inspected.accounting,counts:inspected.telemetry.counts,issues:inspected.issues,
        boundary:'Explicitly requested recall from copied immutable evidence; excluded from autonomous recall counts and paired outcomes.'});
    }else report.probes.push({kind:'explicit_recall',status:'not_run_no_compressed_receipt'});
    const complete=report.results.length===10&&report.results.every(x=>x.status==='completed');
    report.status=complete?'completed':'incomplete';
  }catch(error){report.status='interrupted';report.issues.push(error.message);process.exitCode=1;}
  finally{
    await proxy.close();
    try{
      const after=await providerGet('/user/balance',key);
      await privateJSON(join(base,'balance-after.json'),{observed_at:new Date().toISOString(),...after});
      const final=Number(after.balance_infos?.find(x=>x.currency===account.currency)?.total_balance);
      report.balance_observation={currency:account.currency,account_balance_decrease:Number((Number(account.total_balance)-final).toFixed(9)),
        independently_attributed_to_this_experiment:false,reason:'Other account activity and billing settlement timing were not independently excluded.'};
    }catch{report.balance_observation={status:'unavailable'};}
    const inventory=(await readFile(join(base,'requests/inventory.jsonl'),'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));
    try{report.accounting=accountNativeRequests(book.state.attempts,inventory.filter(x=>x.event==='forwarding').map(x=>x.attempt_id),account.currency);}
    catch(error){report.accounting={status:'incomplete',error:error.message};report.status='interrupted';}
    report.source_unchanged=await integrationInputs()===report.integration_inputs_sha256;
    if(!report.source_unchanged){report.status='interrupted';report.issues.push('Implementation changed during experiment');}
    report.finished_at=new Date().toISOString();
    await privateJSON(join(base,'ledger-native.json'),{schema_version:1,evidence_kind:'measured_online',currency:account.currency,
      cost_source:'rate_card_estimate',rate_card:rateCard,attempts:book.state.attempts});
    await save();console.log(JSON.stringify({event:'pilot_finished',status:report.status,completed_runs:report.results.length,budget:book.summary(),report:reportPath}));
  }
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const credentialFile=process.argv[2];if(!credentialFile)throw new Error('Usage: node evaluation/online-pilot.mjs AUTHORIZED_ENV_FILE');
    await onlinePilot({credentialFile:resolve(credentialFile)});
  }catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
