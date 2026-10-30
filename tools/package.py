#!/usr/bin/env python3
"""Verify a frozen snapshot before atomically replacing a local archive."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'release'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def save_report(path, report):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_bytes(json_bytes(report))
    os.replace(temporary, path)


def inventory(root):
    process = subprocess.run(['node', 'tools/source-digest.mjs'], cwd=root,
                             capture_output=True, text=True, timeout=30)
    if process.returncode:
        raise ValueError('Cannot inventory distribution: ' + process.stderr.strip())
    return json.loads(process.stdout)


def check_snapshot(root, expected_mode):
    current = inventory(root)
    verification = json.loads((root / ('reports/verification.json' if expected_mode == 'source_and_prebuilt'
                                       else 'reports/verification-portable.json')).read_text())
    if (verification.get('schema_version') != 2 or verification.get('status') != 'passed'
            or verification.get('mode') != expected_mode or not verification.get('run_id')
            or not verification.get('checks')
            or any(item.get('status') != 'passed' for item in verification['checks'])
            or not any(item.get('id') == 'verification-inputs-stable' for item in verification['checks'])):
        raise ValueError('Source verification has not passed with the current manifest checks. Run node tools/verify.mjs first.')
    if verification.get('inputs') != current['inputs'] or verification.get('source') != current['source']:
        raise ValueError('Inputs changed since verification (added, removed or modified files); rerun verification')
    version = json.loads((root / 'package.json').read_text())['version']
    if not isinstance(version, str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?', version):
        raise ValueError('Invalid package version for archive name')
    if verification.get('version') != version:
        raise ValueError('Package version differs from verification')
    manifest_bytes = (root / 'dist/build-manifest.json').read_bytes()
    build = json.loads(manifest_bytes)
    artifact = digest((root / 'dist/contextguard.mjs').read_bytes())
    expected_build = {'source_sha256': current['source']['sha256'],
                      'artifact_sha256': artifact, 'manifest_sha256': digest(manifest_bytes)}
    if (build.get('source') != current['source'] or build.get('artifact_sha256') != artifact
            or verification.get('build') != expected_build):
        raise ValueError('Build/source verification mismatch')
    return version, verification


def write_archive(path, name, snapshot):
    checksums = ''.join(digest(data) + '  ' + relative + '\n'
                        for relative, (data, _) in sorted(snapshot.items())).encode()
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, (data, mode) in sorted(snapshot.items()):
            entry = zipfile.ZipInfo(name + '/' + relative)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(entry, data)
        archive.writestr(name + '/CHECKSUMS.sha256', checksums)
    # Check both the full membership and the bytes, including the final receipt.
    with zipfile.ZipFile(path) as archive:
        expected = {name + '/' + relative: data for relative, (data, _) in snapshot.items()}
        expected[name + '/CHECKSUMS.sha256'] = checksums
        if len(archive.infolist()) != len(expected) or set(archive.namelist()) != set(expected):
            raise ValueError('Archive membership mismatch')
        for member, data in expected.items():
            if archive.read(member) != data:
                raise ValueError('Archive checksum mismatch: ' + member)


def main():
    started = time.time()
    report = {'schema_version': 2, 'project': 'ContextGuard', 'status': 'running',
              'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'boundary': 'Clean extraction used only bundled compiled core, source, Python standard library and installed Node. No network, no MoonBit rebuild, no platform-specific RTK executable. Remote CI and online model tasks not run.'}
    report_path = ROOT / 'reports/package-verification.json'
    report_path.parent.mkdir(exist_ok=True)
    save_report(report_path, report)
    try:
        # Read each shipping file only once. Everything below, including the final
        # ZIP, uses these bytes; edits in the live workspace cannot enter the ZIP.
        snapshot = {}
        for relative in inventory(ROOT)['files']:
            path = ROOT / relative
            with path.open('rb') as source:
                mode = os.fstat(source.fileno()).st_mode
                if path.is_symlink() or not stat.S_ISREG(mode):
                    raise ValueError('Distribution refuses non-regular files: ' + relative)
                snapshot[relative] = (source.read(), stat.S_IMODE(mode))
        RELEASE.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.snapshot-', dir=RELEASE) as work_dir:
            work = Path(work_dir)
            frozen = work / 'frozen'
            frozen.mkdir()
            for relative, (data, mode) in snapshot.items():
                path = frozen / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.chmod(mode)
            version, source_verification = check_snapshot(frozen, 'source_and_prebuilt')
            name = 'contextguard-' + version
            archive = RELEASE / (name + '.zip')
            candidate = work / 'candidate.zip'
            write_archive(candidate, name, snapshot)
            with zipfile.ZipFile(candidate) as zipped:
                zipped.extractall(work / 'clean')
            extracted = work / 'clean' / name
            # Confirm the manifest from actual extracted bytes before running it.
            check_snapshot(extracted, 'source_and_prebuilt')
            command = ['node', 'tools/verify.mjs', '--portable']
            process = subprocess.run(command, cwd=extracted, capture_output=True,
                                     text=True, timeout=180)
            log = process.stdout + process.stderr
            report.update(clean_directory=True, directory_removed_after_check=True,
                          checksums_checked=len(snapshot), command=command,
                          exit_code=process.returncode, stdout_stderr=log,
                          execution=source_verification.get('execution', {'environment': 'local'}),
                          source_verification_run_id=source_verification['run_id'],
                          inputs_sha256=source_verification['inputs']['sha256'])
            print(log)
            portable_path = extracted / 'reports/verification-portable.json'
            if portable_path.exists():
                report['portable_verification'] = json.loads(portable_path.read_text())
            if process.returncode:
                raise ValueError('Clean-directory verification failed')
            _, portable_verification = check_snapshot(extracted, 'portable_prebuilt')
            if (portable_verification['inputs'] != source_verification['inputs']
                    or portable_verification['build'] != source_verification['build']):
                raise ValueError('Clean-directory verification changed the frozen inputs')
            report.update(status='passed', elapsed_seconds=time.time() - started,
                          immutable_snapshot=True)
            smoke = json_bytes(report)
            final_snapshot = {**snapshot, 'reports/clean-directory.json': (smoke, 0o644)}
            write_archive(candidate, name, final_snapshot)
            sha = digest(candidate.read_bytes())
            report.update(archive=str(archive.relative_to(ROOT)), sha256=sha,
                          file_count=len(final_snapshot) + 1, archive_bytes=candidate.stat().st_size)
            # A failed gate above leaves the previous archive and sidecar intact.
            checksum = work / 'archive.sha256'
            checksum.write_text(sha + '  ' + archive.name + '\n')
            os.replace(candidate, archive)
            os.replace(checksum, RELEASE / (name + '.zip.sha256'))
            (ROOT / 'reports/clean-directory.json').write_bytes(smoke)
        save_report(report_path, report)
        print(str(archive))
        print('SHA256 ' + sha)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        report.update(status='failed', error=str(error), elapsed_seconds=time.time() - started)
        save_report(report_path, report)
        raise SystemExit(str(error)) from error


if __name__ == '__main__':
    main()
