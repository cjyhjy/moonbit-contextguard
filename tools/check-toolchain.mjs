import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function validateToolchain(output, pinned) {
  const match = output.match(/\bmoonc v(\d+)\.(\d+)\.(\d+)(\+[^\s]+)?(?=\s|$)/);
  if (!match) throw new Error('Cannot determine moonc version');
  const parts = match.slice(1, 4).map(Number);
  const minimum = [0, 10, 16];
  const difference = parts.map((value, index) => value - minimum[index]).find(value => value !== 0) ?? 0;
  if (difference < 0) throw new Error('Contest requires moonc >= 0.10.16');
  const actual = `${parts.join('.')}${match[4] ?? ''}`;
  if (actual !== pinned) throw new Error(`Use the pinned compiler ${pinned}; found ${actual}`);
  return actual;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const lock = JSON.parse(readFileSync(new URL('../toolchain.lock.json', import.meta.url)));
  const result = spawnSync('sh', ['tools/moon', 'version', '--all'], {cwd: root, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  console.log(`Verified moonc ${validateToolchain(result.stdout, lock.moonc)} (minimum 0.10.16)`);
}
