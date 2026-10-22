import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function recallAdapter(receiptPath, start = 1, end = 50) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 10000) throw new RangeError('Invalid line range');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (!/^[a-f0-9]{64}$/u.test(receipt.raw_sha256) || receipt.raw_file !== `raw-${receipt.raw_sha256}.txt`) throw new Error('Invalid receipt');
  const raw = readFileSync(resolve(dirname(receiptPath), receipt.raw_file));
  if (createHash('sha256').update(raw).digest('hex') !== receipt.raw_sha256) throw new Error('Stored output integrity mismatch');
  const lines = raw.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (start > lines.length && lines.length) throw new RangeError('Start line beyond captured output');
  return { observation_boundary: receipt.observation_boundary, process: receipt.process, raw_sha256: receipt.raw_sha256,
    start_line: start, end_line: Math.min(end, lines.length), total_lines: lines.length, text: lines.slice(start - 1, end).join('\n') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [receipt, start, end] = process.argv.slice(2);
    if (!receipt) throw new Error('Usage: node adapters/recall.mjs RECEIPT.json [START] [END]');
    console.log(JSON.stringify(recallAdapter(receipt, start ? Number(start) : 1, end ? Number(end) : 50)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
