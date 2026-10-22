#!/usr/bin/env python3
"""Replay arbitrary UTF-8 stdin through the pinned RTK OSS 1.0.1 pipe command.

The bundled binary is macOS arm64 only. No host hooks/configuration are installed.
The pipe command cannot infer the original process exit status from stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "vendor/rtk-oss-v1.0.1-darwin-arm64/rtk"
BINARY_SHA256 = "897581cccf1d2b2d0886063133eadcf4377d71354c1ed4b8b3b7691f3e7633d2"
REVISION = "4ef8730cf3a0dea11c8d64a9b90bc0616fe52100"


def availability():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return False, "optional pinned executable supports Darwin arm64 only; peer unrun on this platform"
    if not BINARY.is_file():
        return False, "optional RTK binary absent; run python3 research/fetch_rtk.py on Darwin arm64 to download the pinned OSS release"
    if hashlib.sha256(BINARY.read_bytes()).hexdigest() != BINARY_SHA256:
        return False, "RTK binary checksum differs from the pinned release; refusing execution"
    return True, "pinned executable available"


def environment(work: Path):
    """Use tool-specific state paths; do not repurpose HOME or user config."""
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "RTK_DB_PATH": str(work / "history.db"),
        "RTK_TELEMETRY_DISABLED": "1",
        "RTK_NO_TOML": "1",
        "RTK_SUPPRESS_HOOK_WARNING": "1",
        "RTK_TEE_DIR": str(work / "tee"),
        "RTK_RECALL": "0", "RTK_TEE": "0",
    }


def run(text: str, *, run_dir=None):
    available, reason = availability()
    if not available:
        raise RuntimeError(reason)
    work = Path(run_dir).resolve() if run_dir else ROOT / "research/runs/rtk"
    work.relative_to(ROOT)
    work.mkdir(parents=True, exist_ok=True)
    raw = text.encode("utf-8")
    start = time.perf_counter_ns()
    process = subprocess.run([str(BINARY), "pipe"], input=raw, capture_output=True,
                             cwd=work, env=environment(work), timeout=15)
    elapsed = time.perf_counter_ns() - start
    if process.returncode:
        raise RuntimeError("RTK pipe failed: " + process.stderr.decode("utf-8", "replace"))
    output = process.stdout.decode("utf-8")
    return {
        "available": True,
        "peer": "RTK OSS 1.0.1 pipe auto-detection",
        "revision": REVISION,
        "binary_sha256": BINARY_SHA256,
        "platform": "Darwin arm64",
        "mode": "pipe-auto",
        "output": output,
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "output_sha256": hashlib.sha256(process.stdout).hexdigest(),
        "input_bytes_utf8": len(raw),
        "output_bytes_utf8": len(process.stdout),
        "input_chars_python_codepoints": len(text),
        "output_chars_python_codepoints": len(output),
        "byte_identical": raw == process.stdout,
        "elapsed_ns_including_rtk_subprocess": elapsed,
        "hook_stderr": process.stderr.decode("utf-8"),
        "pipe_exit_code": process.returncode,
        "scope": "offline stdin pipe only; pipe exit code is not original command status; no forced unsupported format filter",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--run-dir", type=Path)
    args = parser.parse_args()
    available, reason = availability()
    if not available:
        if args.json:
            print(json.dumps({"available": False, "peer": "RTK OSS 1.0.1 pipe auto-detection",
                              "revision": REVISION, "reason": reason, "status": "unrun"}))
            return
        parser.exit(2, reason + "\n")
    result = run(sys.stdin.buffer.read().decode("utf-8"), run_dir=args.run_dir)
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n" if args.json else result["output"]
    sys.stdout.buffer.write(output.encode("utf-8"))


if __name__ == "__main__":
    main()
