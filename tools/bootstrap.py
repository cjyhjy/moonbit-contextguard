#!/usr/bin/env python3
"""Install checksummed official MoonBit archives inside this checkout only."""
import hashlib
import json
import os
import platform
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'toolchain.lock.json').read_text())
INSTALL = ROOT / '.toolchain'
DOWNLOADS = ROOT / '.toolchain-downloads'
ENV = dict(os.environ, MOON_HOME=str(INSTALL),
           PATH=str(INSTALL / 'bin') + os.pathsep + os.environ.get('PATH', ''))


def unpack(url, checksum, destination):
    DOWNLOADS.mkdir(exist_ok=True)
    archive_path = DOWNLOADS / url.rsplit('/', 1)[-1]
    if not archive_path.exists():
        print('Downloading ' + url, flush=True)
        temporary = archive_path.with_suffix('.download')
        subprocess.run(['curl', '--fail', '--location', '--retry', '3',
                        '--proto', '=https', '--proto-redir', '=https',
                        '--connect-timeout', '30', '--max-time', '300',
                        '--output', str(temporary), url], check=True)
        temporary.replace(archive_path)
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != checksum:
        raise SystemExit('Checksum mismatch: ' + archive_path.name)
    destination.mkdir(parents=True, exist_ok=True)
    base = destination.resolve()
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            resolved = (destination / member.name).resolve()
            if base != resolved and base not in resolved.parents:
                raise SystemExit('Unsafe archive path: ' + member.name)
            if member.issym() or member.islnk():
                link_base = resolved.parent if member.issym() else base
                link = (link_base / member.linkname).resolve()
                if base != link and base not in link.parents:
                    raise SystemExit('Unsafe archive link: ' + member.name)
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise SystemExit('Unsupported archive entry: ' + member.name)
        archive.extractall(destination)


def main():
    key = {('Darwin', 'arm64'): 'darwin-aarch64',
           ('Linux', 'x86_64'): 'linux-x86_64'}.get((platform.system(), platform.machine()))
    if key is None:
        raise SystemExit('Pinned bootstrap supports macOS arm64 and Linux x86_64.')
    moonc = INSTALL / 'bin/moonc'
    marker = INSTALL / 'contextguard-bootstrap.json'
    if INSTALL.exists() and any(INSTALL.iterdir()):
        if not moonc.is_file() or not marker.is_file() or json.loads(marker.read_text()) != LOCK:
            raise SystemExit('Existing .toolchain is not a completed installation of this lock; move it aside first.')
        version = subprocess.check_output([str(moonc), '-v'], env=ENV, text=True)
        if 'v' + LOCK['moonc'] + ' ' not in version:
            raise SystemExit('Existing .toolchain has a different compiler; move it aside first.')
        print('Pinned toolchain already installed: ' + version.strip())
        return
    name = 'moonbit-' + key + '.tar.gz'
    unpack(LOCK['compiler_base_url'] + name,
           LOCK['official_archive_sha256_from_existing_local_lock'][name], INSTALL)
    unpack(LOCK['core_archive_url'], LOCK['core_archive_sha256_from_existing_local_lock'], INSTALL / 'lib')
    for binary in (INSTALL / 'bin').iterdir():
        if binary.is_file():
            binary.chmod(binary.stat().st_mode | 0o111)
    tcc = INSTALL / 'bin/internal/tcc'
    if tcc.exists():
        tcc.chmod(tcc.stat().st_mode | 0o111)
    subprocess.run([str(INSTALL / 'bin/moon'), '-C', str(INSTALL / 'lib/core'),
                    'bundle', '--warn-list', '-a', '--all'], env=ENV, check=True)
    subprocess.run([str(INSTALL / 'bin/moon'), 'version', '--all'], env=ENV, check=True)
    marker.write_text(json.dumps(LOCK, indent=2) + '\n')


if __name__ == '__main__':
    main()
