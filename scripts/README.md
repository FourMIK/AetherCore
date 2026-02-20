# AetherCore Scripts Documentation

This directory contains operational scripts for the AetherCore project.

## Scripts Overview

### `release-checklist.sh`

**Operation Ironclad: Desktop Release Checklist**

Comprehensive pre-release validation script that must pass before any desktop release.

**Usage:**
```bash
./scripts/release-checklist.sh
```

**Validates:**
- ✅ Environment tools (Rust, Node.js, Git)
- ✅ Documentation completeness
- ✅ Code signing configuration (in CI)
- ✅ Rust test suite execution
- ✅ TypeScript type checking
- ✅ SBOM generation and supply chain security
- ✅ Version consistency across manifests
- ✅ Lock file integrity
- ✅ Rust workspace compilation

**Exit Codes:**
- `0`: All checks passed
- `1`: One or more critical checks failed

**Output:**
Generates detailed logs in `/tmp/`:
- `/tmp/rust-test-output.log` - Rust test results
- `/tmp/ts-test-output.log` - TypeScript type check results
- `/tmp/sbom-output.log` - SBOM generation output
- `/tmp/cargo-check-output.log` - Rust compilation output

**Integration:**
- Integrated into `.github/workflows/desktop-release.yml`
- Runs automatically on every release tag push
- Blocks release if any check fails

---

### `generate-sbom.sh`

**Operation Glass Fortress: Supply Chain Verification**

Generates comprehensive Software Bill of Materials (SBOM) and audits all dependencies.

**Usage:**
```bash
./scripts/generate-sbom.sh
```

**Generates:**
- `sbom-artifacts/tauri-sbom.json` - CycloneDX SBOM for Rust dependencies
- `sbom-artifacts/frontend-sbom.json` - CycloneDX SBOM for npm dependencies
- `sbom-artifacts/LICENSE_MANIFEST.txt` - BLAKE3 hashes of all license files
- `sbom-artifacts/SUPPLY_CHAIN_MANIFEST.md` - Human-readable summary

**Requirements:**
- `cargo-audit` - Rust vulnerability scanner
- `cargo-deny` - License compliance checker (Operation Legal Shield)
- `cargo-cyclonedx` - Rust SBOM generator
- `@cyclonedx/cyclonedx-npm` - npm SBOM generator
- `b3sum` - BLAKE3 hash tool (falls back to SHA-256)

**Policy:**
- Fails on HIGH or CRITICAL CVEs in Rust dependencies
- Fails on HIGH or CRITICAL CVEs in npm dependencies
- Fails on non-compliant licenses (GPL, AGPL, LGPL)
- Fails if SBOM generation errors

**Documentation:**
See [LICENSE_COMPLIANCE.md](../LICENSE_COMPLIANCE.md) for license compliance details.

---

### `test-license-compliance.sh`

**Operation Legal Shield: License Compliance Testing**

Validates the license compliance configuration and tests for violations.

**Usage:**
```bash
./scripts/test-license-compliance.sh
```

**Tests:**
- ✅ License compliance check (cargo-deny)
- ✅ Security advisories check
- ✅ Banned dependencies check
- ✅ License whitelist validation
- ✅ GPL/AGPL verification

**Requirements:**
- `cargo-deny` installed
- `deny.toml` configuration present
- `jq` for JSON parsing

**Exit Codes:**
- `0`: All license compliance tests passed
- `1`: License violations detected

**Integration:**
- Run before any PR merge
- Automated in CI via `.github/workflows/ci.yml`
- Part of release checklist validation

**Documentation:**
See [LICENSE_COMPLIANCE.md](../LICENSE_COMPLIANCE.md)

---

### `verify-docs.sh`

**Documentation Completeness Verification**

Ensures all required documentation exists and meets minimum quality standards.

**Usage:**
```bash
./scripts/verify-docs.sh
```

**Validates:**
- Required documentation files exist:
  - `INSTALLATION.md`
  - `DEPLOYMENT_DESKTOP.md`
  - `SECURITY.md`
  - `PROVENANCE.md`
  - `README.md`
  - `docs/SUPPLY_CHAIN_SECURITY.md`
- Files meet minimum size requirements
- Documentation has proper formatting
- Cross-references are present

**Exit Codes:**
- `0`: All documentation checks passed
- `1`: One or more documentation files missing or incomplete

---

### `generate-tauri-icons.sh`

**Tauri Icon Generation from AetherCore Brand**

Generates all required icon formats for the Tactical Glass desktop application from the source AetherCore brand icon.

**Usage:**
```bash
./scripts/generate-tauri-icons.sh
```

**Source Icon:**
- `packages/shared/app-icon.png` - AetherCore brand icon (must exist)

**Generates:**
- `icon.ico` - Windows installer and app icon (multi-size)
- `icon.icns` - macOS DMG and app bundle icon
- `32x32.png`, `128x128.png`, `128x128@2x.png` - Standard sizes
- `Square*Logo.png` - Windows Store logos (9 variants)
- `icon.png` - Base 512x512 icon

**Requirements:**
- `imagemagick` (convert command)
- `iconutil` (macOS) or `icnsutils` (Linux) for .icns generation

**Output:**
All icons written to `packages/dashboard/src-tauri/icons/`

**Integration:**
This script should be run after merging branches that include the brand icon file. The generated icons will be automatically used by Tauri during desktop builds.

---

### `generate-tactical-certs.sh`

**Tactical Certificate Generation**

Generates TLS certificates for tactical mesh communication.

**Usage:**
```bash
./scripts/generate-tactical-certs.sh
```

**Generates:**
- CA certificate and key
- Server certificates
- Client certificates

**Security:**
- Uses Ed25519 keys
- 365-day validity
- Self-signed for testnet use

---

### `run-migrations.sh`

**Database Migration Runner**

Executes database migrations for backend services.

**Usage:**
```bash
./scripts/run-migrations.sh
```

**Applies migrations to:**
- Identity service database
- Mesh service database
- Other service databases as configured

---


---

### `check-android-se-readiness.sh`

**Android Secure Element / StrongBox Readiness Probe**

One-command probe that emits machine-readable `key=value` output for CI and manual operations.

**Usage:**
```bash
./scripts/check-android-se-readiness.sh
```

**StrongBox-required mode:**
```bash
REQUIRE_STRONGBOX=1 ./scripts/check-android-se-readiness.sh
```

**Outputs include:**
- `status` (`READY_STRONGBOX`, `READY_TEE_FALLBACK`, `NOT_READY`)
- `reason` (when not ready)
- device properties (`android_sdk`, `security_patch`, `verified_boot_state`)
- keystore capability flags (`keystore_hw_feature`, `strongbox_feature`)

**Exit codes:**
- `0` for ready states (or fallback when StrongBox not required)
- non-zero when not ready

**Rollout documentation:**
See [docs/ANDROID_SE_ROLLOUT_PLAN.md](../docs/ANDROID_SE_ROLLOUT_PLAN.md).
### `build_arm.sh`

**ARM64 Cross-Compilation**

Cross-compiles Rust crates for ARM64 (IoT edge devices).

**Usage:**
```bash
./scripts/build_arm.sh
```

**Targets:**
- `aarch64-unknown-linux-gnu` - ARM64 Linux
- Generates static libraries for edge deployment

---

## Running Scripts Locally

### Prerequisites

```bash
# Install required tools
cargo install cargo-audit cargo-cyclonedx b3sum --locked
pnpm add -g @cyclonedx/cyclonedx-npm

# Clone repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Install dependencies
pnpm install --frozen-lockfile
```

### Before Release

Always run the release checklist before creating a release tag:

```bash
./scripts/release-checklist.sh
```

Fix any failures before proceeding with the release.

### Generate SBOM

To manually generate SBOM artifacts:

```bash
./scripts/generate-sbom.sh
```

Artifacts will be in `sbom-artifacts/`.

---

## CI/CD Integration

All scripts are integrated into GitHub Actions workflows:

### Desktop Release Workflow

`.github/workflows/desktop-release.yml`

- Runs `release-checklist.sh` as a blocking gate
- Installs supply chain tools
- Runs `generate-sbom.sh` for SBOM generation
- Uploads SBOM artifacts to releases

**Triggered by:** Pushing tags matching `v*` (e.g., `v0.1.0`)

---

## Troubleshooting

### Script Permission Denied

```bash
chmod +x ./scripts/*.sh
```

### Missing Dependencies

Install required tools:

```bash
# Rust tools
cargo install cargo-audit cargo-cyclonedx b3sum --locked

# npm tools
pnpm add -g @cyclonedx/cyclonedx-npm
```

### SBOM Generation Fails

Check for:
- Network connectivity (tools need to download)
- Disk space for cargo cache
- Valid `Cargo.lock` and `pnpm-lock.yaml`

### Tests Fail in Checklist

- Review test output in `/tmp/rust-test-output.log`
- Fix failing tests before release
- Do not bypass test failures

---

## Security Considerations

### Script Integrity

All scripts should be reviewed before execution:

```bash
# Verify script hasn't been tampered with
git log -p scripts/release-checklist.sh
```

### Secrets

Scripts do NOT contain or output secrets. They only:
- Check for presence of environment variables (in CI)
- Validate configuration
- Generate public artifacts (SBOMs)

### Supply Chain

Scripts themselves are part of the supply chain:
- Reviewed in pull requests
- Committed to Git (full audit trail)
- Executed in isolated CI environments

---

## References

- [Release Process Documentation](../docs/RELEASE_PROCESS.md)
- [Supply Chain Security](../docs/SUPPLY_CHAIN_SECURITY.md)
- [Deployment Guide](../DEPLOYMENT_DESKTOP.md)

---

**Last Updated:** 2026-01-04  
**Maintained By:** AetherCore Team

---

### `build-release-manifest.py`

**Release Artifact Orchestrator + Manifest Emitter**

Collects desktop installers from CI output folders, copies them into `release-artifacts/`, computes SHA-256 hashes, and emits `release-manifest.json` (+ optional detached signature).

**Usage:**
```bash
python3 ./scripts/build-release-manifest.py \
  --bundle-dir packages/dashboard/src-tauri/target/release/bundle \
  --output-dir release-artifacts \
  --tag v0.2.0 \
  --commit "$(git rev-parse HEAD)" \
  --tauri-version 2.9.5 \
  --rust-version "$(rustc --version | awk '{print $2}')" \
  --node-version "$(node --version | sed 's/^v//')" \
  --private-key-path ./release-signing.pem
```

**Manifest includes:**
- Artifact names and SHA-256 hashes
- Minimum OS versions
- Bundled runtime versions (Tauri/Rust/Node)
- Health contract (bootstrap arg + readiness contract)

---

### `verify-release-manifest.py`

**Release Artifact Verifier (pre-install gate)**

Validates detached manifest signature and artifact hashes before installation.

**Usage:**
```bash
python3 ./scripts/verify-release-manifest.py \
  --manifest ./release-manifest.json \
  --artifacts-dir . \
  --public-key ./release-manifest-public.pem
```

**Fails when:**
- Manifest signature verification fails
- Any artifact hash mismatches manifest
- A required artifact is missing

**Deployment policy:**
This verifier is the required pre-install gate for Intune, Jamf, and manual distribution workflows.
