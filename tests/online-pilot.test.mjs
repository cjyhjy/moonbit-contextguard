import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, mkdir, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetBook, costNano } from '../evaluation/online-budget.mjs';
import { parseDeepSeekStream, accountNativeRequests } from '../evaluation/deepseek-usage.mjs';
import { startCaptureProxy } from '../evaluation/online-proxy.mjs';
import { runOnlineSession, inspectOnlineRun, taskProtocol } from '../evaluation/online-runtime.mjs';
import { defaultBinary } from '../evaluation/opencode-runtime.mjs';
import { tasks, materializeTask, gradeTask } from '../evaluation/tasks.mjs';

const usage={prompt_tokens:100,prompt_tokens_details:{cached_tokens:25},prompt_cache_hit_tokens:25,
  prompt_cache_miss_tokens:75,completion_tokens:20,total_tokens:120};
function stream(id='fixture-request',delta={content:'ready'},u=usage){
  const common={id,model:'deepseek-flash',system_fingerprint:'fixture-backend',object:'chat.completion.chunk',created:0};
  return `data: ${JSON.stringify({...common,choices:[{index:0,delta,finish_reason:null}]})}\n\n`+
    `data: ${JSON.stringify({...common,choices:[{index:0,delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:u})}\n\ndata: [DONE]\n\n`;
}
async function scratch(t){const base=await realpath(await mkdtemp(join(tmpdir(),'contextguard-online-')));t.after(()=>rm(base,{recursive:true,force:true}));return base;}
async function fixture(t,handler){
  const server=createServer(handler);await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
  return `http://127.0.0.1:${server.address().port}`;
}
async function proxySetup(t,handler,options={}){
  const base=await scratch(t),book=new BudgetBook(join(base,'budget.json'),{currency:'CNY',available:20});
  const upstream=await fixture(t,handler);
  const proxy=await startCaptureProxy({directory:join(base,'captures'),apiKey:'fixture-secret-never-logged',book,upstream,allowLoopbackFixture:true,...options});
  t.after(()=>proxy.close());return{base,book,proxy};
}
const post=(proxy,url,body={model:'deepseek-flash',messages:[{role:'user',content:'ready'}]})=>fetch(url+'/chat/completions',{
  method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${proxy.localToken}`},body:JSON.stringify(body)});

test('budget reserves before spending, preserves unknown charges and refuses silent resume',async t=>{
  const base=await scratch(t),path=join(base,'budget.json');
  const book=new BudgetBook(path,{currency:'CNY',available:11.06});
  assert.equal(book.summary().total_limit,11.06);assert.equal(book.reserveNano/1e9,2.12992);
  const a=book.reserve('run','primary');
  assert.throws(()=>book.reserve('run','auxiliary'),/Run budget/);
  book.settle(a.attempt_id,parseDeepSeekStream(stream()));
  assert.equal(book.summary().settled_cost,0.000311);
  assert.throws(()=>book.settle(a.attempt_id,parseDeepSeekStream(stream())),/twice/);
  const b=book.reserve('run','primary');book.uncertain(b.attempt_id,'fixture_missing_usage');
  assert.throws(()=>book.reserve('next','primary'),/halted/);
  assert.equal(book.summary().reserved_or_uncertain_cost,2.12992);
  assert.throws(()=>new BudgetBook(path,{currency:'CNY',available:20}),/overwritten/);
  const small=new BudgetBook(join(base,'small.json'),{currency:'CNY',available:1});
  assert.throws(()=>small.reserve('run','primary'),/Total budget/);
});

test('DeepSeek final content chunk usage and split tool call arguments are retained',()=>{
  const delta={tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'verify_capture',arguments:'{"value":"ready"}'}}]};
  const r=parseDeepSeekStream(stream('request-1',delta).replaceAll('\n','\r\n'));
  assert.equal(r.id,'request-1');assert.equal(r.normalized_usage.input_uncached_tokens,75);
  assert.equal(r.normalized_usage.input_cached_tokens,25);assert.equal(r.message.tool_calls[0].function.name,'verify_capture');
  assert.equal(r.normalized_usage.output_tokens,20);
});

test('missing final usage, inconsistent cache totals, incomplete streams and wrong models fail closed',()=>{
  for(const bad of [stream('x',{},null),stream('x',{}, {...usage,total_tokens:999}),
    stream('x',{}, {...usage,prompt_cache_hit_tokens:26}),stream().replace('data: [DONE]',''),
    stream().replaceAll('deepseek-flash','other-model')])assert.throws(()=>parseDeepSeekStream(bad));
});

test('native ledger reconciles independent inventory and rejects duplicate or incorrectly priced requests',async t=>{
  const base=await scratch(t),book=new BudgetBook(join(base,'b.json'),{currency:'USD',available:3});
  const a=book.reserve('run','primary');book.settle(a.attempt_id,parseDeepSeekStream(stream()));
  const total=accountNativeRequests(book.state.attempts,[a.attempt_id],'USD');
  assert.equal(total.peak_rate_estimated_cost,0.00004665);
  assert.throws(()=>accountNativeRequests(book.state.attempts,[],'USD'),/ledger/);
  assert.throws(()=>accountNativeRequests([...book.state.attempts,...book.state.attempts],[a.attempt_id],'USD'),/ledger/);
  assert.throws(()=>accountNativeRequests([{...book.state.attempts[0],cost_nano:0}],[a.attempt_id],'USD'),/rate card/);
});

test('proxy serializes concurrent auxiliary/main requests, enforces settings, and excludes credentials from evidence',async t=>{
  let active=0,peak=0,count=0;const bodies=[];
  const {base,book,proxy}=await proxySetup(t,async(req,res)=>{
    active++;peak=Math.max(peak,active);const id=++count;
    let text='';for await(const chunk of req)text+=chunk;
    assert.equal(req.headers.authorization,'Bearer fixture-secret-never-logged');bodies.push(JSON.parse(text));
    await new Promise(done=>setTimeout(done,10));
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream('request-'+id));active--;
  });
  const url=proxy.openRun('serial');
  const responses=await Promise.all([post(proxy,url,{model:'deepseek-flash',messages:[],thinking:{type:'enabled'},temperature:1,max_tokens:9000}),post(proxy,url)]);
  await Promise.all(responses.map(r=>r.text()));await proxy.closeRun('serial');
  assert.equal(peak,1);assert.equal(book.summary().settled_requests,2);
  assert(bodies.every(x=>x.thinking.type==='disabled'&&x.temperature===0.2&&x.max_tokens<=4096));
  for(const r of proxy.records){assert(!(await readFile(r.request_file,'utf8')).includes('fixture-secret-never-logged'));}
  assert(!(await readFile(join(base,'budget.json'),'utf8')).includes('fixture-secret-never-logged'));
});

test('incomplete provider usage keeps the reservation and blocks the next paid request',async t=>{
  let forwarded=0;const errors=[];
  const {book,proxy}=await proxySetup(t,(req,res)=>{forwarded++;req.resume();res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream('missing',{},null));},
    {onFatal:(run,reason)=>errors.push(reason)});
  const url=proxy.openRun('failed');await(await post(proxy,url)).text();
  const second=await post(proxy,url);await second.text();
  assert.equal(forwarded,1);assert.equal(book.summary().settled_requests,0);
  assert.equal(book.summary().reserved_or_uncertain_cost,2.12992);assert.equal(errors.length,2);
});

test('unexpected upstream and mismatched model cannot receive the credential',async t=>{
  const base=await scratch(t),book=new BudgetBook(join(base,'b.json'),{currency:'CNY',available:20});
  await assert.rejects(startCaptureProxy({directory:base,apiKey:'fixture',book,upstream:'https://example.com'}),/endpoint/);
  let forwarded=0;
  const setup=await proxySetup(t,(req,res)=>{forwarded++;req.resume();res.end();});
  const url=setup.proxy.openRun('wrong');const r=await post(setup.proxy,url,{model:'other',messages:[]});await r.text();
  assert.equal(r.status,400);assert.equal(forwarded,0);assert.equal(setup.book.summary().requests,0);
});

test('online runner uses actual pinned OpenCode against loopback, edits files, and verifies model-boundary hashes',async t=>{
  try{await access(defaultBinary);}catch{t.skip('Pinned CLI absent in portable distribution');return;}
  let mainStep=0,request=0;
  const {base,book,proxy}=await proxySetup(t,async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const body=JSON.parse(text),main=body.tools?.some(x=>x.function?.name==='bash');
    let delta={content:'Fixture done'};
    if(main){const step=mainStep++;
      const actions=[{name:'bash',args:{command:tasks[0].command,description:'Run diagnostic'}},
        {name:'bash',args:{command:mainStep===2?JSON.parse(body.messages.filter(x=>x.role==='tool').at(-1).content.split('\n')[0]).recall_command.replace('START END','1 10'):'unused',description:'Recall captured lines'}},
        {name:'read',args:{filePath:join(base,'task/src/value.cjs')}},
        {name:'edit',args:{filePath:join(base,'task/src/value.cjs'),oldString:'a-b',newString:'a+b'}},
        {name:'bash',args:{command:tasks[0].command,description:'Verify repair'}}];
      if(actions[step])delta={tool_calls:[{index:0,id:'call-'+step,type:'function',function:{name:actions[step].name,arguments:JSON.stringify(actions[step].args)}}]};
    }
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream('runtime-'+(++request),delta));
  });
  const directory=join(base,'task');await materializeTask(tasks[0],directory);
  const children=new Map();
  const result=await runOnlineSession({directory,stateDirectory:join(base,'state'),runId:'runtime',mode:'guard',
    allowCommands:[{command:tasks[0].command,scope:tasks[0].scope}],prompt:tasks[0].prompt,proxy,childRegistry:children,timeoutMs:60000});
  const inspected=await inspectOnlineRun({directory,result,records:proxy.records,book,runId:'runtime'});
  assert.deepEqual(inspected.issues,[]);assert.equal((await gradeTask(tasks[0],directory)).passed,true,
    JSON.stringify(inspected.toolParts.map(x=>({tool:x.tool,status:x.state.status,error:x.state.error}))));
  assert.equal(inspected.telemetry.counts.applied,2);assert.equal(inspected.accounting.requests,request);
  assert.equal(inspected.telemetry.counts.recalls,1);
  assert.equal(taskProtocol(tasks[0],inspected.toolParts).passed,true);
});
