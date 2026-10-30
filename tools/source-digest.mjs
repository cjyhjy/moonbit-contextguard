import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const omittedParts = new Set(['.git', '_build', '.toolchain', '.toolchain-downloads', '.moon', '.contextguard', 'node_modules', '__pycache__', '.DS_Store', 'release', '.aws', '.ssh', '.codex', '.agents']);
const omittedPrefixes = ['research/downloads/', 'research/runs/', 'reports/captures/', 'reports/logs/', 'reports/.delivery-scratch/', 'reports/evaluation/audit/'];
const omittedFiles = new Set(['vendor/rtk-oss-v1.0.1-darwin-arm64/rtk', 'reports/package-verification.json', 'reports/clean-directory.json', 'reports/verification-portable.json', 'CHECKSUMS.sha256']);

// Use the same complete inventory for verification and packaging. Generated
// evidence may ship, but caches, private configuration and prior releases cannot.
export function distributionFiles(root) {
  const files = [];
  const walk = relative => {
    for (const entry of readdirSync(join(root, relative), {withFileTypes: true})) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (omittedParts.has(entry.name) || omittedFiles.has(path)
          || omittedPrefixes.some(prefix => `${path}/`.startsWith(prefix))
          || entry.name === '.env' || entry.name.startsWith('.env.')
          || ['credentials.json', 'auth.json'].includes(entry.name)
          || /\.(pyc|tmp|pem|key)$/.test(path) || path.endsWith('/audit.jsonl')) continue;
      if (entry.isSymbolicLink()) throw new Error(`Distribution refuses symlinks: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Distribution refuses non-regular files: ${path}`);
    }
  };
  walk('');
  return files.sort();
}

function digestFiles(root, files) {
  const records = files.map(path => ({path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}));
  return {sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'), files: records};
}

export function sourceDigest(root) {
  return digestFiles(root, distributionFiles(root).filter(path => ['moon.mod', 'moon.pkg', 'contextguard.mbt', 'contextguard_test.mbt'].includes(path)
    || /^(src|cmd)\//.test(path) && (path.endsWith('.mbt') || path.endsWith('/moon.pkg'))));
}

export function verificationInputs(root) {
  // Generated report data changes during evaluation. An executable or other
  // unexpected file added under reports still counts as a verification input.
  // The two compiler outputs are checked separately before and after tests.
  return digestFiles(root, distributionFiles(root).filter(path => !(path.startsWith('reports/') && /\.(json|jsonl|txt|md|png|jpe?g|webp|db|tap)$/.test(path))
    && !['dist/contextguard.mjs', 'dist/build-manifest.json'].includes(path)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify({source: sourceDigest(root), inputs: verificationInputs(root), files: distributionFiles(root)}));
}
