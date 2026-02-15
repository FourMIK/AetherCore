#!/usr/bin/env python3
"""Verify release-manifest signature and artifact hashes."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_signature(manifest_path: Path, signature_path: Path, public_key_path: Path) -> None:
    cmd = [
        "openssl",
        "dgst",
        "-sha256",
        "-verify",
        str(public_key_path),
        "-signature",
        str(signature_path),
        str(manifest_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify release manifest and artifacts")
    parser.add_argument("--manifest", required=True, help="Path to release-manifest.json")
    parser.add_argument("--artifacts-dir", default=".", help="Base directory where artifacts are stored")
    parser.add_argument("--public-key", help="Public key PEM used to verify manifest signature")
    parser.add_argument("--signature", help="Detached signature path (defaults to manifest metadata)")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    artifacts_dir = Path(args.artifacts_dir).resolve()

    if not manifest_path.exists():
        print(f"Manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if args.public_key:
        signature_file = args.signature
        if not signature_file:
            signature_file = manifest.get("signature", {}).get("signature_file")
        if not signature_file:
            print("No signature file provided and manifest.signature.signature_file is missing", file=sys.stderr)
            return 1
        signature_path = Path(signature_file)
        if not signature_path.is_absolute():
            signature_path = manifest_path.parent / signature_path
        verify_signature(manifest_path, signature_path.resolve(), Path(args.public_key).resolve())
        print("✔ Manifest signature verification passed")

    artifacts = manifest.get("artifacts", [])
    if not artifacts:
        print("Manifest contains no artifacts", file=sys.stderr)
        return 1

    failures = []
    for artifact in artifacts:
        relative = artifact.get("path") or artifact.get("name")
        expected = artifact.get("sha256")
        if not relative or not expected:
            failures.append(f"Invalid artifact entry: {artifact}")
            continue
        artifact_path = artifacts_dir / relative
        if not artifact_path.exists():
            failures.append(f"Missing artifact: {artifact_path}")
            continue
        actual = sha256_file(artifact_path)
        if actual.lower() != expected.lower():
            failures.append(f"Hash mismatch for {artifact_path.name}: expected {expected}, got {actual}")

    if failures:
        for failure in failures:
            print(f"✗ {failure}", file=sys.stderr)
        return 1

    print(f"✔ Artifact hash verification passed for {len(artifacts)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
