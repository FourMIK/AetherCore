#!/usr/bin/env python3
"""Build a release manifest from CI-generated desktop artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED_EXTENSIONS = {".msi": "windows", ".dmg": "macos", ".appimage": "linux"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def infer_platform(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in SUPPORTED_EXTENSIONS:
        return SUPPORTED_EXTENSIONS[suffix]
    if path.name.lower().endswith(".appimage"):
        return "linux"
    raise ValueError(f"Unsupported artifact type for {path}")


def find_artifacts(bundle_dir: Path) -> list[Path]:
    artifacts: list[Path] = []
    for path in bundle_dir.rglob("*"):
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if lowered.endswith(".msi") or lowered.endswith(".dmg") or lowered.endswith(".appimage"):
            artifacts.append(path)
    return sorted(artifacts)


def parse_min_os(value: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    if not value:
        return mapping
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"Invalid --min-os entry '{part}', expected platform=version")
        platform, version = part.split("=", 1)
        mapping[platform.strip()] = version.strip()
    return mapping


def sign_manifest(manifest_path: Path, signature_path: Path, private_key_path: Path) -> None:
    cmd = [
        "openssl",
        "dgst",
        "-sha256",
        "-sign",
        str(private_key_path),
        "-out",
        str(signature_path),
        str(manifest_path),
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate release-manifest.json for desktop installers")
    parser.add_argument("--bundle-dir", required=True, help="Directory containing CI desktop build outputs")
    parser.add_argument("--output-dir", default="release-artifacts", help="Output directory for copied artifacts and manifest")
    parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.2.0")
    parser.add_argument("--commit", required=True, help="Git commit SHA")
    parser.add_argument("--tauri-version", required=True, help="Bundled Tauri runtime version")
    parser.add_argument("--rust-version", required=True, help="Rust toolchain version used for build")
    parser.add_argument("--node-version", required=True, help="Node.js runtime version used for build")
    parser.add_argument(
        "--min-os",
        default="windows=10.0.19045,macos=13.0,linux=Ubuntu 22.04",
        help="Comma separated minimum OS versions by platform",
    )
    parser.add_argument("--health-timeout-seconds", type=int, default=30)
    parser.add_argument("--health-endpoint", default="http://127.0.0.1:8080/healthz")
    parser.add_argument("--private-key-path", help="Optional PEM key to sign manifest")
    args = parser.parse_args()

    bundle_dir = Path(args.bundle_dir).resolve()
    output_dir = Path(args.output_dir).resolve()

    if not bundle_dir.exists():
        print(f"Bundle directory not found: {bundle_dir}", file=sys.stderr)
        return 1

    artifacts = find_artifacts(bundle_dir)
    if not artifacts:
        print(f"No .msi/.dmg/.AppImage artifacts found under {bundle_dir}", file=sys.stderr)
        return 1

    min_os = parse_min_os(args.min_os)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_artifacts = []
    for artifact in artifacts:
        copied_name = artifact.name
        destination = output_dir / copied_name
        shutil.copy2(artifact, destination)

        platform = infer_platform(artifact)
        manifest_artifacts.append(
            {
                "name": copied_name,
                "path": copied_name,
                "platform": platform,
                "type": artifact.suffix.lower().lstrip("."),
                "sha256": sha256_file(destination),
                "size_bytes": destination.stat().st_size,
                "minimum_os_version": min_os.get(platform, "unspecified"),
            }
        )

    manifest = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release": {"tag": args.tag, "commit": args.commit},
        "bundled_runtime_versions": {
            "tauri": args.tauri_version,
            "rust": args.rust_version,
            "node": args.node_version,
        },
        "health_contract": {
            "bootstrap_argument": "--bootstrap",
            "ready_state_files": {
                "macos": "~/Library/Application Support/com.aethercore.tactical-glass-dev/runtime-config.json",
                "windows": "%APPDATA%/com.aethercore.tactical-glass-dev/runtime-config.json",
                "linux": "~/.config/com.aethercore.tactical-glass-dev/runtime-config.json",
            },
            "health_endpoint": args.health_endpoint,
            "startup_timeout_seconds": args.health_timeout_seconds,
        },
        "artifacts": manifest_artifacts,
    }

    manifest_path = output_dir / "release-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if args.private_key_path:
        signature_path = output_dir / "release-manifest.json.sig"
        sign_manifest(manifest_path, signature_path, Path(args.private_key_path).resolve())
        manifest["signature"] = {
            "algorithm": "rsa-sha256",
            "signature_file": signature_path.name,
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        sign_manifest(manifest_path, signature_path, Path(args.private_key_path).resolve())

    print(f"Generated manifest: {manifest_path}")
    print(f"Collected {len(manifest_artifacts)} artifacts into {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
