#!/usr/bin/env python3
"""Offline check of the exact Mooncakes archive and a separate library consumer."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MOON = ['sh', str(ROOT / 'tools/moon')]
REPORT = ROOT / 'reports/registry-package.json'


def main():
    report = {'schema_version': 1, 'status': 'running', 'checks': [],
              'scope': 'Offline archive/external consumer validation; not a registry publication receipt.'}
    REPORT.parent.mkdir(exist_ok=True)
    def save():
        temp = REPORT.with_suffix('.json.tmp')
        temp.write_text(json.dumps(report, indent=2) + '\n')
        temp.replace(REPORT)
    def run(label, args, cwd=ROOT):
        result = subprocess.run(MOON + args, cwd=cwd, text=True, capture_output=True, timeout=180)
        report['checks'].append({'id': label, 'exit_code': result.returncode,
                                 'output': (result.stdout + result.stderr).replace(str(ROOT), '<PROJECT_ROOT>')})
        save()
        if result.returncode:
            raise RuntimeError(label + ': ' + result.stdout + result.stderr)
        return result.stdout
    save()
    try:
        manifest = (ROOT / 'moon.mod').read_text()
        name = re.search(r'^name = "([^"]+)"', manifest, re.M)[1]
        version = re.search(r'^version = "([^"]+)"', manifest, re.M)[1]
        run('moon-package', ['package'])
        archive = ROOT / '_build/publish' / (name.replace('/', '-') + '-' + version + '.zip')
        required = {'moon.mod', 'moon.pkg', 'contextguard.mbt', 'contextguard_test.mbt',
                    'README.mbt.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                    'cmd/example/main.mbt', 'cmd/example/moon.pkg'}
        required |= {str(p.relative_to(ROOT)) for p in (ROOT / 'src').iterdir()
                     if p.suffix == '.mbt' or p.name == 'moon.pkg'}
        with zipfile.ZipFile(archive) as zipped:
            names = zipped.namelist()
            allowed = required | {'pkg.generated.mbti', 'src/pkg.generated.mbti', 'cmd/example/pkg.generated.mbti'}
            if len(names) != len(set(names)) or not required <= set(names) or not set(names) <= allowed:
                raise RuntimeError('Registry archive membership differs from the source-only allowlist')
            report.update(module=name, version=version, files=sorted(names),
                          archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                          archive_bytes=archive.stat().st_size)
            with tempfile.TemporaryDirectory(prefix='contextguard-registry-') as directory:
                work = Path(directory)
                library = work / 'library'
                zipped.extractall(library)  # Every name was checked against the explicit allowlist.
                consumer = work / 'consumer'
                consumer.mkdir()
                (work / 'moon.work').write_text('members = [ "library", "consumer" ]\n')
                (consumer / 'moon.mod').write_text(
                    'name = "acceptance/consumer"\nimport { "' + name + '@' + version + '" }\n')
                (consumer / 'moon.pkg').write_text(
                    'import { "' + name + '" @contextguard, "moonbitlang/core/json" } for "test"\n')
                # Black-box tests import the packaged public API, not repository internals.
                (consumer / 'consumer_test.mbt').write_bytes((library / 'contextguard_test.mbt').read_bytes())
                for target in ['js', 'native', 'wasm-gc']:
                    run('consumer-check-' + target, ['check', '--target', target], consumer)
                    output = run('consumer-test-' + target,
                                 ['test', '--target', target, '-p', 'acceptance/consumer'], consumer)
                    if not re.search(r'Total tests: 6, passed: 6, failed: 0', output):
                        raise RuntimeError('Consumer tests did not run: ' + target + ': ' + output)
                    output = run('packaged-example-' + target,
                                 ['run', 'cmd/example', '--target', target], library)
                    result = json.loads(output)
                    if result.get('decision') != 'compressed' or result.get('assurance') != 'required_source_units_verified':
                        raise RuntimeError('Packaged example did not preserve verified evidence')
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        raise
    finally:
        save()
    print('Registry archive and independent consumer passed on js/native/wasm-gc')


if __name__ == '__main__':
    main()
