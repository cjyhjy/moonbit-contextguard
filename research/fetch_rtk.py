#!/usr/bin/env python3
"""Explicit optional public download for the pinned macOS arm64 RTK OSS peer.

This script is never called by the core, CLI, demo, or mandatory offline tests.
It verifies the archive and executable SHA256 and installs only below vendor/.
"""
import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = "https://github.com/rtk-ai/rtk/releases/download/v1.0.1/rtk-oss-aarch64-apple-darwin.tar.gz"
ARCHIVE_SHA256 = "4a4d9d09656ff29423336aa506e680afc3f7b6dafe84f0194a1c9a523a3c80e1"
BINARY_SHA256 = "897581cccf1d2b2d0886063133eadcf4377d71354c1ed4b8b3b7691f3e7633d2"


def main():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("This optional pinned binary supports macOS arm64 only; no peer will be run.")
    dest = ROOT / "vendor/rtk-oss-v1.0.1-darwin-arm64"
    binary = dest / "rtk"
    if binary.exists():
        if hashlib.sha256(binary.read_bytes()).hexdigest() == BINARY_SHA256:
            print("Pinned RTK OSS executable already present; no download needed.")
            return
        raise SystemExit("Existing vendor binary has a different hash; preserved without overwriting.")
    with urllib.request.urlopen(URL, timeout=45) as response:
        data = response.read(12_000_001)
    if len(data) > 12_000_000 or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("Pinned archive size/hash check failed; nothing installed.")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        payload = archive.extractfile("rtk").read()
        license_text = archive.extractfile("LICENSE").read()
    if hashlib.sha256(payload).hexdigest() != BINARY_SHA256:
        raise SystemExit("Pinned executable hash check failed; nothing installed.")
    dest.mkdir(parents=True, exist_ok=True)
    binary.write_bytes(payload)
    binary.chmod(0o755)
    (dest / "LICENSE").write_bytes(license_text)
    print("Installed pinned optional RTK OSS peer below vendor/; no global hooks/configuration changed.")


if __name__ == "__main__":
    main()
