import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {sourceDigest} from '../tools/source-digest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = join(root, 'reports/.delivery-scratch');
const childEnv = {...process.env};
delete childEnv.NODE_TEST_CONTEXT;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function put(base, path, contents) {
  const target = join(base, path);
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, contents);
}
function fixture(t) {
  mkdirSync(scratch, {recursive: true});
  const base = mkdtempSync(join(scratch, 'case-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  for (const path of ['tools/source-digest.mjs', 'tools/verify.mjs', 'tools/package.py']) {
    mkdirSync(dirname(join(base, path)), {recursive: true});
    copyFileSync(join(root, path), join(base, path));
  }
  const files = {
    'package.json': JSON.stringify({name: 'delivery-fixture', version: '9.8.7', type: 'module'}),
    'moon.mod': 'fixture', 'src/main.mbt': '// fixture', 'cmd/bridge/main.mbt': '// fixture',
    'tools/moon': 'if [ "$1:$3" = "build:${DELIVERY_FAIL_BACKEND:-none}" ]; then exit 23; fi\nexit 0\n', 'tools/build.mjs': '// prebuilt fixture\n',
    'tools/check-toolchain.mjs': '// synthetic fixture gate\n', 'tools/verify-registry.py': '# synthetic fixture registry check\n',
    'tools/cli.mjs': '// fixture cli\n', 'tools/example.mjs': '// original snapshot\n',
    'dist/contextguard.mjs': 'export const fixture = true;\n',
    'fixtures/example-request.json': '{}', 'evaluation/example-ledger.synthetic.jsonl': '',
    'evaluation/ledger.test.mjs': "import test from 'node:test'; test('fixture ledger', () => {});\n",
    'evaluation/evaluate-nested-tap.mjs': '// fixture\n',
    'evaluation/ledger.mjs': '// fixture\n', 'evaluation/audit.mjs': '// fixture\n',
    'evaluation/evaluate.mjs': `import {writeFileSync} from 'node:fs';
if (process.env.DELIVERY_MUTATE_DURING_VERIFY) writeFileSync('tools/example.mjs', '// changed during checks');
if (process.env.DELIVERY_MUTATE_ARTIFACT) writeFileSync('dist/contextguard.mjs', '// changed build during checks');\n`,
    'tests/smoke.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
test('fixture smoke', async () => {
  if (process.env.DELIVERY_DELAY) {
    writeFileSync('reports/child-started.txt', 'started');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (process.env.DELIVERY_LIVE_MUTATION) writeFileSync(process.env.DELIVERY_LIVE_MUTATION, '// changed live during smoke');
  assert.equal(process.env.DELIVERY_FAIL_SMOKE, undefined);
});\n`
  };
  for (const [path, contents] of Object.entries(files)) put(base, path, contents);
  put(base, 'dist/build-manifest.json', JSON.stringify({schema_version: 1, source: sourceDigest(base), artifact_sha256: sha(readFileSync(join(base, 'dist/contextguard.mjs')))}));
  return base;
}
function run(base, command, args, env = {}) {
  return spawnSync(command, args, {cwd: base, env: {...childEnv, ...env}, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
}
function verify(base, env) { return run(base, process.execPath, ['tools/verify.mjs'], env); }
function pack(base, env) { return run(base, 'python3', ['-B', 'tools/package.py'], env); }
function passed(result) { assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`); }
function receipt(base) { return JSON.parse(readFileSync(join(base, 'reports/verification.json'))); }
function archiveInfo(base) {
  const result = run(base, 'python3', ['-B', '-c', `import hashlib,json,zipfile
with zipfile.ZipFile('release/contextguard-9.8.7.zip') as z:
 prefix='contextguard-9.8.7/'
 checks=z.read(prefix+'CHECKSUMS.sha256').decode().splitlines()
 for line in checks:
  expected,path=line.split('  ',1)
  assert hashlib.sha256(z.read(prefix+path)).hexdigest()==expected,path
 assert len(z.namelist())==len(checks)+1
 print(json.dumps({'members':z.namelist(),'example':z.read(prefix+'tools/example.mjs').decode(),'smoke':json.loads(z.read(prefix+'reports/clean-directory.json'))}))`]);
  passed(result);
  return JSON.parse(result.stdout);
}

test('delivery packages the verified version and every archived checksum matches', t => {
  const base = fixture(t);
  put(base, '.env', 'LOCAL_TEST_SECRET=do-not-ship');
  put(base, '.contextguard/private-capture.txt', 'private capture');
  put(base, '.toolchain-downloads/archive.tar.gz', 'cached toolchain');
  put(base, 'private.pem', 'synthetic private key fixture');
  passed(verify(base));
  passed(pack(base));
  const archived = archiveInfo(base);
  assert.equal(archived.smoke.status, 'passed');
  assert.equal(archived.smoke.immutable_snapshot, true);
  assert.ok(archived.members.every(path => !path.includes('.env') && !path.includes('.contextguard') && !path.includes('.toolchain-downloads') && !path.endsWith('.pem')));
  const bytes = readFileSync(join(base, 'release/contextguard-9.8.7.zip'));
  assert.equal(readFileSync(join(base, 'release/contextguard-9.8.7.zip.sha256'), 'utf8').split('  ')[0], sha(bytes));
});

test('delivery rejects added, removed and modified shipping inputs plus compiled artifact tampering', t => {
  const base = fixture(t);
  passed(verify(base));
  const changes = [
    ['new-runtime.mjs', 'export const unverified = true;'],
    ['dist/new-runtime.mjs', 'export const unverified = true;'],
    ['reports/new-runtime.mjs', 'export const unverified = true;'],
    ['tools/example.mjs', null],
    ['tools/example.mjs', '// unverified edit'],
    ['dist/contextguard.mjs', '// tampered compiled output']
  ];
  for (const [path, contents] of changes) {
    const target = join(base, path);
    const previous = existsSync(target) ? readFileSync(target) : null;
    if (contents === null) rmSync(target); else put(base, path, contents);
    const result = pack(base);
    assert.notEqual(result.status, 0, `accepted ${path}`);
    assert.match(result.stderr, /Inputs changed since verification|Build\/source verification mismatch/);
    assert.equal(existsSync(join(base, 'release/contextguard-9.8.7.zip')), false);
    if (previous === null) rmSync(target); else put(base, path, previous);
  }
});

test('failed clean-directory tests preserve the previous archive and checksum', t => {
  const base = fixture(t);
  passed(verify(base));
  passed(pack(base));
  const archive = readFileSync(join(base, 'release/contextguard-9.8.7.zip'));
  const checksum = readFileSync(join(base, 'release/contextguard-9.8.7.zip.sha256'));
  const failed = pack(base, {DELIVERY_FAIL_SMOKE: '1'});
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Clean-directory verification failed/);
  assert.deepEqual(readFileSync(join(base, 'release/contextguard-9.8.7.zip')), archive);
  assert.deepEqual(readFileSync(join(base, 'release/contextguard-9.8.7.zip.sha256')), checksum);
  assert.equal(JSON.parse(readFileSync(join(base, 'reports/package-verification.json'))).status, 'failed');
});

test('packaging never rereads changed live source bytes after its clean smoke test', t => {
  const base = fixture(t);
  passed(verify(base));
  passed(pack(base, {DELIVERY_LIVE_MUTATION: join(base, 'tools/example.mjs')}));
  assert.equal(readFileSync(join(base, 'tools/example.mjs'), 'utf8'), '// changed live during smoke');
  assert.equal(archiveInfo(base).example, '// original snapshot\n');
  assert.notEqual(pack(base).status, 0, 'a subsequent package must reject the now-stale source receipt');
});

test('verification fails when shipping inputs change during its own checks', t => {
  const base = fixture(t);
  passed(verify(base));
  const previous = receipt(base).run_id;
  const result = verify(base, {DELIVERY_MUTATE_DURING_VERIFY: '1'});
  assert.notEqual(result.status, 0);
  assert.equal(receipt(base).status, 'failed');
  assert.notEqual(receipt(base).run_id, previous);
  assert.match(result.stderr, /inputs changed while checks were running/);
  assert.notEqual(pack(base).status, 0);
});

test('a failed test replaces the previous source pass even when no inputs changed', t => {
  const base = fixture(t);
  passed(verify(base));
  const before = receipt(base);
  assert.notEqual(verify(base, {DELIVERY_FAIL_SMOKE: '1'}).status, 0);
  assert.equal(receipt(base).status, 'failed');
  assert.deepEqual(receipt(base).inputs, before.inputs);
  assert.notEqual(pack(base).status, 0);
});

test('verification rejects compiled output modified after the initial correspondence check', t => {
  const base = fixture(t);
  passed(verify(base));
  assert.notEqual(verify(base, {DELIVERY_MUTATE_ARTIFACT: '1'}).status, 0);
  assert.equal(receipt(base).status, 'failed');
  assert.equal(receipt(base).checks.find(item => item.id === 'compiled-source-correspondence').status, 'passed');
  assert.match(receipt(base).checks.at(-1).error, /generated JS or source digest mismatch/);
  assert.notEqual(pack(base).status, 0);
});

test('an interrupted verification leaves running status and cannot reuse its previous pass', async t => {
  const base = fixture(t);
  passed(verify(base));
  const previous = receipt(base).run_id;
  const child = spawn(process.execPath, ['tools/verify.mjs'], {cwd: base, env: {...childEnv, DELIVERY_DELAY: '1'}, stdio: 'ignore'});
  t.after(() => child.kill('SIGKILL'));
  const exited = new Promise(resolve => child.once('exit', resolve));
  for (let i = 0; i < 300 && !existsSync(join(base, 'reports/child-started.txt')); i++) await delay(10);
  assert.ok(existsSync(join(base, 'reports/child-started.txt')), 'delayed child started');
  assert.equal(receipt(base).status, 'running');
  assert.notEqual(receipt(base).run_id, previous);
  child.kill('SIGKILL');
  await exited;
  await delay(600); // Allow the intentionally orphaned short-lived fixture test to exit.
  assert.equal(receipt(base).status, 'running');
  const result = pack(base);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Source verification has not passed/);
});

test('a zero-exit smoke process cannot reuse an old portable pass receipt', t => {
  const base = fixture(t);
  passed(verify(base));
  // This old receipt must be excluded from the snapshot; replacing the verifier
  // is an input edit, so verify the new source fixture before testing packaging.
  put(base, 'reports/verification-portable.json', JSON.stringify({...receipt(base), mode: 'portable_prebuilt'}));
  const verifier = readFileSync(join(base, 'tools/verify.mjs'), 'utf8');
  put(base, 'tools/verify.mjs', `if (process.argv.includes('--portable')) process.exit(0);\n` + verifier.replace(/^#!.*\n/, ''));
  passed(verify(base));
  const result = pack(base);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(base, 'release/contextguard-9.8.7.zip')), false);
});

test('a release-build failure in any MoonBit backend prevents source verification from passing', t => {
  const base = fixture(t);
  for (const backend of ['js', 'native', 'wasm-gc']) {
    const result = verify(base, {DELIVERY_FAIL_BACKEND: backend});
    assert.notEqual(result.status, 0, `missed ${backend} release-build failure`);
    assert.equal(receipt(base).status, 'failed');
    assert.equal(receipt(base).checks.find(item => item.id === `moon-build-${backend}`).exit_code, 23);
  }
});

test('bootstrap validates cached hashes and archive paths without network or existing-install writes', t => {
  const base = fixture(t);
  copyFileSync(join(root, 'tools/bootstrap.py'), join(base, 'tools/bootstrap.py'));
  copyFileSync(join(root, 'toolchain.lock.json'), join(base, 'toolchain.lock.json'));
  const result = run(base, 'python3', ['-B', '-c', `import hashlib,importlib.util,io,json,tarfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('bootstrap','tools/bootstrap.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def no_network(*args,**kwargs):
 raise AssertionError('Bootstrap must use the cached synthetic archive')
m.subprocess.run=no_network
m.DOWNLOADS.mkdir()
cached=m.DOWNLOADS/'fixture.tar.gz'
def cache(name,kind=tarfile.REGTYPE,link=''):
 with tarfile.open(cached,'w:gz') as archive:
  entry=tarfile.TarInfo(name)
  entry.type=kind
  entry.linkname=link
  data=b'fixture'
  entry.size=len(data) if kind==tarfile.REGTYPE else 0
  archive.addfile(entry,io.BytesIO(data) if entry.size else None)
 return hashlib.sha256(cached.read_bytes()).hexdigest()
url='https://fixture.invalid/fixture.tar.gz'
good=cache('bin/example')
m.unpack(url,good,m.ROOT/'safe')
assert (m.ROOT/'safe/bin/example').read_bytes()==b'fixture'
def rejected(checksum,destination,message):
 try:
  m.unpack(url,checksum,m.ROOT/destination)
 except SystemExit as error:
  assert message in str(error),str(error)
 else:
  raise AssertionError('Expected rejection: '+message)
rejected('0'*64,'bad-hash','Checksum mismatch')
assert not (m.ROOT/'bad-hash').exists()
rejected(cache('../escaped.txt'),'bad-path','Unsafe archive path')
assert not (m.ROOT/'escaped.txt').exists()
rejected(cache('link',tarfile.SYMTYPE,'../../escaped.txt'),'bad-link','Unsafe archive link')
rejected(cache('device',tarfile.CHRTYPE),'bad-type','Unsupported archive entry')
m.INSTALL.mkdir()
keep=m.INSTALL/'keep.txt'
keep.write_text('existing local contents')
m.platform.system=lambda:'Darwin'
m.platform.machine=lambda:'arm64'
try:
 m.main()
except SystemExit as error:
 assert 'move it aside first' in str(error),str(error)
else:
 raise AssertionError('Existing unmarked toolchain must remain untouched')
assert keep.read_text()=='existing local contents'
assert list(m.INSTALL.iterdir())==[keep]
print(json.dumps({'cached_extract':'passed','checksum_rejection':'passed','path_rejection':'passed','link_rejection':'passed','type_rejection':'passed','existing_install_preserved':'passed','network_calls':0}))`]);
  passed(result);
  const checks = JSON.parse(result.stdout);
  assert.equal(checks.network_calls, 0);
  assert.equal(checks.existing_install_preserved, 'passed');
});
