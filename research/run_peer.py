#!/usr/bin/env python3
"""Run the pinned HarnessPro PostToolUse hook on arbitrary UTF-8 stdin.

No fixtures, expected facts, MoonBit implementation, model, or network are used.
The upstream hook and published Terminal-Bench 2 Lite limits are unmodified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = "8ae622eb4a4923dbb4b515be7ded614f88fd4f38"
HOOK_BLOB = "2eb13a90f215ef3ab65fe911020c16583757a8a2"


def run(text: str, *, max_chars=4000, head_chars=2400, tail_chars=900, run_dir=None):
    """Return upstream output and reproducibility metadata; keep its raw store."""
    if min(max_chars, head_chars, tail_chars) <= 0:
        raise ValueError("all limits must be positive")
    if head_chars + tail_chars >= max_chars:
        raise ValueError("head_chars + tail_chars must be less than max_chars")
    hook = ROOT / "vendor/harnesspro/hook.py"
    source = hook.read_bytes()
    blob = hashlib.sha1(b"blob " + str(len(source)).encode() + b"\0" + source).hexdigest()
    if blob != HOOK_BLOB:
        raise RuntimeError("vendored HarnessPro hook differs from pinned Git blob")
    digest = hashlib.sha256(text.encode()).hexdigest()
    state = Path(run_dir).resolve() if run_dir else ROOT / "research/runs/harnesspro" / digest
    state.relative_to(ROOT)  # Keep all peer side effects inside this project.
    state.mkdir(parents=True, exist_ok=True)
    policy = {
        "tool_output_max_chars": max_chars,
        "tool_output_head_chars": head_chars,
        "tool_output_tail_chars": tail_chars,
    }
    selection = state / "selection.json"
    selection.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
    payload = {
        "cwd": str(state),
        "hook_event_name": "PostToolUse",
        "tool_name": "exec_command",
        "tool_use_id": digest,
        "tool_response": text,
    }
    env = os.environ.copy()
    env.pop("RHO_RUNTIME_INTERFACE", None)
    env["RHO_RUNTIME_SELECTION_PATH"] = str(selection)
    env["RHO_RUNTIME_AUDIT_PATH"] = str(state / "audit.jsonl")
    start = time.perf_counter_ns()
    process = subprocess.run(
        [sys.executable, "-B", str(hook)], input=json.dumps(payload, ensure_ascii=False),
        text=True, capture_output=True, env=env, cwd=state, timeout=15,
    )
    elapsed_ns = time.perf_counter_ns() - start
    if process.returncode:
        raise RuntimeError("HarnessPro hook failed: " + process.stderr)
    response = json.loads(process.stdout) if process.stdout.strip() else None
    output = response["reason"] if response else text
    raw = state / ".rho_runtime/raw" / (digest + ".json")
    raw_verified = raw.is_file() and json.loads(raw.read_text(encoding="utf-8")) == text
    return {
        "peer": "HarnessPro Terminal-Bench 2 Lite PostToolUse",
        "revision": UPSTREAM,
        "source_git_blob_sha1": blob,
        "mode": "published-default" if policy == {
            "tool_output_max_chars": 4000, "tool_output_head_chars": 2400,
            "tool_output_tail_chars": 900,
        } else "custom-limits",
        "limits": policy,
        "output": output,
        "input_sha256": digest,
        "output_sha256": hashlib.sha256(output.encode()).hexdigest(),
        "input_chars_python_codepoints": len(text),
        "output_chars_python_codepoints": len(output),
        "input_bytes_utf8": len(text.encode()),
        "output_bytes_utf8": len(output.encode()),
        "compacted": response is not None,
        "raw_recovery_verified": bool(raw_verified),
        "raw_file": str(raw.relative_to(ROOT)) if raw.is_file() else None,
        "elapsed_ns_including_python_subprocess": elapsed_ns,
        "hook_stdout": process.stdout,
        "hook_stderr": process.stderr,
        "scope": "single offline PostToolUse event; no pre-tool RTK rewrite, agent, or model run",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit JSON metadata and output")
    parser.add_argument("--max-chars", type=int, default=4000)
    parser.add_argument("--head-chars", type=int, default=2400)
    parser.add_argument("--tail-chars", type=int, default=900)
    parser.add_argument("--run-dir", type=Path)
    args = parser.parse_args()
    data = sys.stdin.buffer.read().decode("utf-8")
    result = run(data, max_chars=args.max_chars, head_chars=args.head_chars,
                 tail_chars=args.tail_chars, run_dir=args.run_dir)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n" if args.json else result["output"]
    sys.stdout.buffer.write(rendered.encode("utf-8"))


if __name__ == "__main__":
    main()
