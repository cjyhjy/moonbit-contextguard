import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {guard} from '../tools/api.mjs';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('fixtures/nested-tap/manifest.json'));
const baselineArg = process.argv.indexOf('--baseline');
const baselinePath = baselineArg < 0 ? null : process.argv[baselineArg+1];
if (baselineArg >= 0 && !baselinePath) throw new Error('--baseline requires an explicit compiled module');
const baseline = baselinePath ? await import(pathToFileURL(resolve(baselinePath)).href) : null;
const median = operation => {
  for (let i=0;i<5;i++) operation();
  const samples=[];
  for(let i=0;i<31;i++) {const start=performance.now();operation();samples.push(performance.now()-start);}
  return samples.sort((a,b)=>a-b)[15];
};
const rows=[];
for(const f of manifest.fixtures) {
  const raw=read(f.stdout), input={format:'node-tap',raw,process:f.process};
  if(createHash('sha256').update(raw).digest('hex')!==f.stdout_sha256) throw new Error(`${f.id}: capture hash drift`);
  for(const span of f.required_spans) {
    const original=raw.split('\n').slice(span.start_line-1,span.end_line).join('\n');
    if(original!==span.text) throw new Error(`${f.id}: annotation drift`);
  }
  const result=guard(input);
  if(result.decision!==f.expected_decision) throw new Error(`${f.id}: ${result.reason}`);
  if(!f.required_spans.every(span=>result.output.includes(span.text+'\n'))) throw new Error(`${f.id}: evidence lost`);
  const row={fixture:f.id,stdout_sha256:f.stdout_sha256,input_utf16:raw.length,output_utf16:result.output.length,
    decision:result.decision,reason:result.reason,required_spans:f.required_spans.length,retained_spans:f.required_spans.length,
    net_stdout_reduction:raw.length-result.output.length,median_api_ms:median(()=>guard(input))};
  if(baseline){const before=JSON.parse(baseline.guard_request(JSON.stringify(input)));row.baseline={decision:before.decision,reason:before.reason,output_utf16:before.output.length,median_api_ms:median(()=>JSON.parse(baseline.guard_request(JSON.stringify(input))))};}
  rows.push(row);
}
const report={schema_version:1,generated_at:new Date().toISOString(),version:JSON.parse(read('package.json')).version,
  node:process.version,platform:process.platform,arch:process.arch,
  scope:'Six controlled fixture programs and a real project regression command, actual captured Node output. Counts concern stdout UTF-16 units, not tokens, total integration envelope, model cost or online success.',
  timing:'Same process, 5 warmups then median of 31 API calls per case; not an end-to-end performance claim.',
  baseline:baseline?{module_sha256:createHash('sha256').update(readFileSync(baselinePath)).digest('hex'),origin:'Explicit baseline compiled module; see the recorded reproduction command for source commit.'}:null,
  cases:rows,all_required_spans_retained:true};
const output=baseline?'reports/nested-tap-before-after.json':'reports/nested-tap-evaluation.json';
writeFileSync(new URL('../'+output,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(rows.map(({fixture,input_utf16,output_utf16,decision})=>({fixture,input_utf16,output_utf16,decision})),null,2));
