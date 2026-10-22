#!/usr/bin/env python3
"""Compare native rg --json and pinned RTK rg --json on the fixture corpus.

Fresh subprocess timings and file traversal order vary. Keep raw streams, then
compare JSON event multisets after deleting only elapsed/elapsed_total fields.
This is separate from identical-stdin peer replays and is not a latency benchmark.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import run_rtk

ROOT = Path(__file__).resolve().parents[1]


def canonical(output):
    def strip_time(value):
        if isinstance(value, dict):
            return {k: strip_time(v) for k, v in value.items() if k not in ("elapsed", "elapsed_total")}
        if isinstance(value, list):
            return [strip_time(v) for v in value]
        return value
    return Counter(json.dumps(strip_time(json.loads(line)), ensure_ascii=False, sort_keys=True)
                   for line in output.decode("utf-8").splitlines() if line)


def main():
    assert hashlib.sha256(run_rtk.BINARY.read_bytes()).hexdigest() == run_rtk.BINARY_SHA256
    rg = shutil.which("rg")
    if not rg:
        raise RuntimeError("ripgrep is required for native CLI comparison")
    manifest = json.loads((ROOT / "fixtures/manifest.json").read_bytes())
    records = []
    for fixture in manifest["fixtures"]:
        if fixture["format"] != "rg-json":
            continue
        dest = ROOT / "reports/peers/rtk-native-rg" / fixture["id"]
        dest.mkdir(parents=True, exist_ok=True)
        args = fixture["invocation"]["args"]
        env = run_rtk.environment(dest)
        native = subprocess.run([rg] + args, capture_output=True, cwd=ROOT, env=env, timeout=15)
        wrapped = subprocess.run([str(run_rtk.BINARY), "rg"] + args, capture_output=True, cwd=ROOT, env=env, timeout=15)
        for label, process in [("native", native), ("rtk", wrapped)]:
            (dest / (label + ".stdout.txt")).write_bytes(process.stdout)
            (dest / (label + ".stderr.txt")).write_bytes(process.stderr)
        result = {"fixture_id": fixture["id"], "native_command": ["rg"] + args,
                  "rtk_command": ["vendor/rtk-oss-v1.0.1-darwin-arm64/rtk", "rg"] + args,
                  "native_exit_code": native.returncode, "rtk_exit_code": wrapped.returncode,
                  "exit_codes_equal": native.returncode == wrapped.returncode,
                  "stderr_byte_equal": native.stderr == wrapped.stderr,
                  "stdout_byte_equal": native.stdout == wrapped.stdout,
                  "normalized_json_event_multiset_equal": canonical(native.stdout) == canonical(wrapped.stdout),
                  "native_stdout_sha256": hashlib.sha256(native.stdout).hexdigest(),
                  "rtk_stdout_sha256": hashlib.sha256(wrapped.stdout).hexdigest(),
                  "output_directory": str(dest.relative_to(ROOT))}
        records.append(result)
        print(fixture["id"], result["exit_codes_equal"], result["stderr_byte_equal"], result["normalized_json_event_multiset_equal"])
    report = {"schema_version": 1, "peer": "RTK OSS 1.0.1 rg --json native CLI",
              "revision": run_rtk.REVISION, "command": "python3 research/check_rtk_rg.py",
              "normalization": "JSON parsing; recursively remove elapsed and elapsed_total; compare event multisets (file traversal order may vary). Raw stdout/stderr retained. No other field removed.",
              "scope": "Actual native rg and RTK-wrapped rg processes; these fresh outputs are not the frozen stdin replay inputs.",
              "records": records}
    (ROOT / "reports/peers-rtk-native-rg.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
