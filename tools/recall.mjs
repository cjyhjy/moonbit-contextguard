#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function recall(directory, stream='stdout', start=1, end=50) {
  if (!['stdout','stderr'].includes(stream)) throw new TypeError('stream must be stdout or stderr');
  if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end-start>10000) throw new TypeError('invalid line interval (1-based inclusive, <=10001 lines)');
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  const bytes=readFileSync(join(directory,`${stream}.bin`));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if (manifest.hashes[stream]!==sha256) throw new Error('capture integrity mismatch');
  const lines=bytes.toString('utf8').split('\n');
  if(lines.at(-1)==='')lines.pop();
  if (start>lines.length && lines.length!==0) throw new RangeError('start line beyond captured output');
  return {stream,start_line:start,end_line:Math.min(end,lines.length),total_lines:lines.length,sha256,process:manifest.process,text:lines.slice(start-1,end).join('\n')};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const [directory,stream,start,end]=process.argv.slice(2);if(!directory)throw new Error('Usage: node tools/recall.mjs CAPTURE_DIR [stdout|stderr] [START] [END]');console.log(JSON.stringify(recall(directory,stream, start?Number(start):1,end?Number(end):50))); }
  catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=2;}
}
