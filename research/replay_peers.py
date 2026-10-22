#!/usr/bin/env python3
"""Run actual pinned peers on the current frozen fixture manifest; no network."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys
import time

import run_peer
import run_rtk

ROOT = Path(__file__).resolve().parents[1]


def evidence_results(text, fixture):
    lines = text.splitlines()
    results = []
    for evidence in fixture["required_evidence"]:
        block = evidence["lines"]
        present = any(lines[i:i + len(block)] == block for i in range(len(lines) - len(block) + 1))
        results.append({"tag": evidence["tag"], "source_line_start": evidence["line_start"],
                        "source_line_end": evidence["line_end"], "present_exact_contiguous": present})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harnesspro-only", action="store_true", help="portable Python peer; explicitly skip macOS RTK executable")
    args = parser.parse_args()
    manifest_bytes = (ROOT / "fixtures/manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    methods = [("harnesspro", run_peer.run)]
    if not args.harnesspro_only:
        available, reason = run_rtk.availability()
        if available:
            methods.append(("rtk", run_rtk.run))
        else:
            print("RTK unavailable (not run): " + reason)
            # Keep bundled historical evidence distinct from this local rerun.
            (ROOT / "reports/peers-rtk-availability.json").write_text(
                json.dumps({"status": "unrun", "available": False, "reason": reason,
                            "revision": run_rtk.REVISION}, indent=2) + "\n", encoding="utf-8")
    for name, runner in methods:
        records = []
        for fixture in manifest["fixtures"]:
            raw_bytes = (ROOT / fixture["stdout"]).read_bytes()
            assert hashlib.sha256(raw_bytes).hexdigest() == fixture["stdout_sha256"]
            outdir = ROOT / "reports/peers" / name / fixture["id"]
            outdir.mkdir(parents=True, exist_ok=True)
            result = runner(raw_bytes.decode("utf-8"), run_dir=outdir)
            output = result["output"]
            output_path = outdir / "output.txt"
            output_path.write_bytes(output.encode("utf-8"))
            checks = evidence_results(output, fixture)
            result.update({"fixture_id": fixture["id"], "output_file": str(output_path.relative_to(ROOT)),
                           "required_evidence_results": checks,
                           "required_evidence_present": sum(a["present_exact_contiguous"] for a in checks),
                           "required_evidence_total": len(checks),
                           "original_process_metadata_external_to_stdin": fixture["process"]})
            (outdir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            records.append({k: v for k, v in result.items() if k not in ("output", "hook_stdout")})
            print(name, fixture["id"], result["input_bytes_utf8"], result["output_bytes_utf8"],
                  str(result["required_evidence_present"]) + "/" + str(result["required_evidence_total"]))
        report = {"schema_version": 1, "captured_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "command": "python3 research/replay_peers.py" + (" --harnesspro-only" if args.harnesspro_only else ""),
                  "fixture_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                  "python_version": sys.version, "platform": platform.platform(),
                  "interpretation": "Actual upstream offline stdout processing on synthetic-source real process outputs. No model-token, API-cost, task-success, or net-savings measurement. Original process metadata and stderr are external to peer stdin.",
                  "records": records}
        (ROOT / ("reports/peers-" + name + ".json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
