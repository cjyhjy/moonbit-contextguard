#!/usr/bin/env node
// Deterministic external-candidate audit. Ground truth is fixture stdout spans.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from '../tools/api.mjs';
import { runProcess } from '../tools/run.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root,'fixtures/manifest.json'),'utf8'));
let state = 0x5eeda11;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
const split = text => { const result = text.split('\n'); if (result.at(-1)==='') result.pop(); return result; };
const results = [];
for(const f of manifest.fixtures) {
  const raw = readFileSync(resolve(root,f.stdout),'utf8');
  const source = split(raw);
  for(let iteration=0;iteration<128;iteration++) {
    const candidate = source.filter(() => random()>0.35).join('\n')+'\n';
    const response = guard({format:f.format,raw,candidate,process:f.process,max_output_chars:16000});
    const outputLines = split(response.output);
    const retained = f.required_evidence.every(e => outputLines.some((_,i) => e.lines.every((line,j)=>line===outputLines[i+j])));
    let cursor=0;
    const originalLinesOnly = outputLines.every(line=>{while(cursor<source.length && source[cursor]!==line) cursor++;return cursor++<source.length;});
    if(!retained || !originalLinesOnly) throw new Error(`False acceptance or repair loss: ${f.id}, subset ${iteration}`);
    results.push({fixture:f.id,case:`seeded-subset-${iteration}`,decision:response.decision,retained,originalLinesOnly});
  }
}
const temporary = mkdtempSync('/tmp/contextguard-audit-');
let signalResult;
try { signalResult = await runProcess([process.execPath,'-e',"process.kill(process.pid, 'SIGTERM')"],{cwd:temporary,captureDir:resolve(temporary,'capture'),format:'unknown'}); } finally { rmSync(temporary,{recursive:true,force:true}); }
if (signalResult.process.exit_code!==143 || signalResult.process.signal!=='SIGTERM' || !signalResult.process.truncated) throw new Error('Signal metadata regression');
const allPass=manifest.fixtures.find(f=>f.id==='node-tap-all-pass');
const invalidDuration=readFileSync(resolve(root,allPass.stdout),'utf8').replace(/  duration_ms: [^\n]+/,'  duration_ms: ERROR: undocumented diagnostic');
const durationResult=guard({format:allPass.format,raw:invalidDuration,process:allPass.process});
if(durationResult.decision!=='fallback' || durationResult.output!==invalidDuration) throw new Error('Unsupported duration value was silently discarded');
const resolved_findings=[
  {issue:'Signal-terminated child was always reported as exit137 and complete',resolution:'Signal-specific 128+signal number; signal marks source incomplete',observed:signalResult.process,passed:true},
  {issue:'Unsupported nonnumeric pass duration could be discarded',resolution:'Flat TAP profile validates numeric duration and fails open otherwise',observed:{decision:durationResult.decision,reason:durationResult.reason,exact_original_preserved:durationResult.output===invalidDuration},passed:true},
];
const report={schema_version:1,seed_hex:'0x5eeda11',scope:'Deterministic candidate-deletion audit on six actual captured outputs; no guard evidence/metrics used as oracle.',cases:results.length,passed:results.length,resolved_findings,decisions:Object.fromEntries(['accepted','compressed','repaired','fallback'].map(d=>[d,results.filter(r=>r.decision===d).length])),results};
writeFileSync(resolve(root,'reports/evaluation-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:report.cases,passed:report.passed,decisions:report.decisions},null,2));
