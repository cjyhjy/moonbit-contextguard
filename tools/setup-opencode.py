#!/usr/bin/env python3
"""Fetch a pinned official CLI into the project cache; never replace a global install."""
import hashlib
import json
import os
import pathlib
import platform
import subprocess
import tarfile
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
pin = json.loads((root / 'adapters/opencode-pin.json').read_text())
names = {('Darwin', 'arm64'): 'opencode-darwin-arm64.zip', ('Linux', 'x86_64'): 'opencode-linux-x64.tar.gz'}
name = names.get((platform.system(), platform.machine()))
if name is None:
    raise SystemExit('Pinned downloader supports macOS arm64 and Linux x86_64 only')
asset = next(x for x in pin['archives'] if x['name'] == name)
cache = root / '.toolchain-downloads' / ('opencode-' + pin['version'])
cache.mkdir(parents=True, exist_ok=True)
archive = cache / name
if not archive.exists():
    temporary = archive.with_suffix(archive.suffix + '.tmp')
    subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '180', asset['url'], '--output', str(temporary)], check=True)
    if hashlib.sha256(temporary.read_bytes()).hexdigest() != asset['sha256']:
        raise SystemExit('Official archive checksum mismatch')
    temporary.replace(archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != asset['sha256']:
    raise SystemExit('Cached archive checksum mismatch')
if name.endswith('.zip'):
    with zipfile.ZipFile(archive) as z:
        if set(z.namelist()) != {'opencode'}:
            raise SystemExit('Unexpected ZIP members')
        binary = z.read('opencode')
else:
    with tarfile.open(archive, 'r:gz') as t:
        members = t.getmembers()
        if len(members) != 1 or members[0].name not in ('opencode', './opencode') or not members[0].isfile():
            raise SystemExit('Unexpected tar members')
        binary = t.extractfile(members[0]).read()
target = cache / 'opencode'
target.write_bytes(binary)
os.chmod(target, 0o755)
version = subprocess.check_output([str(target), '--version'], text=True).strip()
if version != pin['version']:
    raise SystemExit('CLI version mismatch')
print(json.dumps({'version': version, 'archive_sha256': asset['sha256'], 'binary_sha256': hashlib.sha256(binary).hexdigest(), 'binary': str(target)}))
