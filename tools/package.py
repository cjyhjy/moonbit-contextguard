#!/usr/bin/env python3
"""Create and test a self-contained local archive; never publish anything."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'release'
NAME = 'contextguard-0.1.0'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def allowed(relative):
    parts = relative.parts
    if any(p in {'.git', '_build', '.toolchain', '.toolchain-downloads', '.contextguard', 'node_modules', '__pycache__', '.DS_Store', 'release'} for p in parts):
        return False
    value = relative.as_posix()
    if value.startswith(('research/downloads/', 'research/runs/', 'reports/captures/', 'reports/logs/', 'reports/evaluation/audit/')):
        return False
    if value in {'vendor/rtk-oss-v1.0.1-darwin-arm64/rtk', 'reports/package-verification.json', 'reports/clean-directory.json'}:
        return False
    if value.endswith('/audit.jsonl'):
        return False  # upstream working-directory audit is redundant with retained I/O; avoid personal paths
    return not value.endswith(('.pyc', '.tmp'))

def main():
    verification = json.loads((ROOT/'reports/verification.json').read_text())
    if verification['status'] != 'passed':
        raise SystemExit('Source verification has not passed. Run node tools/verify.mjs first.')
    build = json.loads((ROOT/'dist/build-manifest.json').read_text())
    if build['artifact_sha256'] != digest((ROOT/'dist/contextguard.mjs').read_bytes()) or build['source']['sha256'] != verification['source']['sha256']:
        raise SystemExit('Build/source verification mismatch')
    for entry in verification['inputs']['files']:
        if digest((ROOT/entry['path']).read_bytes()) != entry['sha256']:
            raise SystemExit('Inputs changed since verification: '+entry['path'])
    RELEASE.mkdir(exist_ok=True)
    files = sorted(p for p in ROOT.rglob('*') if p.is_file() and allowed(p.relative_to(ROOT)))
    for p in files:
        if p.is_symlink(): raise SystemExit('Distribution refuses symlinks: '+str(p))
        if p.name in {'.env','credentials.json','auth.json'}: raise SystemExit('Unexpected secret/config filename: '+str(p))
    checksums = ''.join(digest(p.read_bytes())+'  '+p.relative_to(ROOT).as_posix()+'\n' for p in files)
    archive = RELEASE/(NAME+'.zip')
    temporary = RELEASE/(NAME+'.zip.tmp')
    with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in files: z.write(p,NAME+'/'+p.relative_to(ROOT).as_posix())
        z.writestr(NAME+'/CHECKSUMS.sha256',checksums)
    os.replace(temporary,archive)
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='contextguard-clean-', dir=RELEASE) as temporary_dir:
        with zipfile.ZipFile(archive) as z: z.extractall(temporary_dir)
        extracted = Path(temporary_dir)/NAME
        for line in (extracted/'CHECKSUMS.sha256').read_text().splitlines():
            expected,path=line.split('  ',1)
            if digest((extracted/path).read_bytes())!=expected: raise SystemExit('Extracted checksum mismatch: '+path)
        command=['node','tools/verify.mjs','--portable']
        process=subprocess.run(command,cwd=extracted,capture_output=True,text=True,timeout=180)
        log=process.stdout+process.stderr
        result=json.loads((extracted/'reports/verification-portable.json').read_text()) if (extracted/'reports/verification-portable.json').exists() else None
        report={'schema_version':1,'project':'ContextGuard','generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'status':'passed' if process.returncode==0 else 'failed','execution':verification.get('execution', {'environment':'local'}),'clean_directory':True,'directory_removed_after_check':True,'checksums_checked':len(files),'command':command,'exit_code':process.returncode,'elapsed_seconds':time.time()-started,'stdout_stderr':log,'portable_verification':result,'boundary':'Clean extraction used only bundled compiled core, source, Python standard library and installed Node. No network, no MoonBit rebuild, no platform-specific RTK executable. Execution location is recorded separately. Online model tasks and registry publication are not tested.'}
        print(log)
        if process.returncode != 0:
            (ROOT/'reports/package-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            raise SystemExit('Clean-directory verification failed')
    smoke=(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
    (ROOT/'reports/clean-directory.json').write_bytes(smoke)
    checksums += digest(smoke)+'  reports/clean-directory.json\n'
    # Only the new verification receipt is added; runtime/source bytes stay identical.
    with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in files: z.write(p,NAME+'/'+p.relative_to(ROOT).as_posix())
        z.writestr(NAME+'/reports/clean-directory.json',smoke)
        z.writestr(NAME+'/CHECKSUMS.sha256',checksums)
    os.replace(temporary,archive)
    sha=digest(archive.read_bytes())
    (RELEASE/(NAME+'.zip.sha256')).write_text(sha+'  '+archive.name+'\n')
    report.update(archive=str(archive.relative_to(ROOT)),sha256=sha,file_count=len(files)+2,archive_bytes=archive.stat().st_size)
    (ROOT/'reports/package-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(str(archive))
    print('SHA256 '+sha)

if __name__=='__main__': main()
