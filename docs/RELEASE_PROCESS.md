# Desktop Release Process
## Operation Ironclad: Release Engineering Guide

**Classification:** COSMIC  
**Mission:** TRL-8 Desktop Application Release Process  
**Last Updated:** 2026-01-04

---

## Overview

This document describes the complete process for releasing the AetherCore Tactical Glass desktop application. All releases must pass through **Operation Ironclad**, our comprehensive release validation gate.

## Release Philosophy

Following 4MIK architectural invariants:

- **Fail-Visibility**: All failures must be explicit and block the release
- **Zero Trust**: Every step must be verified cryptographically where possible
- **BLAKE3 Only**: Use BLAKE3 for all integrity checks (SHA-256 only as fallback)
- **No Mocks in Production**: All production code paths must be validated

### Prohibited Actions

- ❌ Bypassing security checks or test failures
- ❌ Releasing with known HIGH or CRITICAL vulnerabilities
- ❌ Shipping unsigned binaries to production users
- ❌ Skipping SBOM generation or supply chain verification
- ❌ Releasing with version mismatches

---

## Prerequisites

### Developer Setup

1. **Install Required Tools**
   ```bash
   # Rust toolchain
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   
   # Node.js 18+ and npm
   # Download from https://nodejs.org/
   
   # Supply chain tools (optional for local testing)
   cargo install cargo-audit cargo-cyclonedx b3sum --locked
   pnpm add -g @cyclonedx/cyclonedx-npm
   ```

2. **Clone Repository**
   ```bash
   git clone https://github.com/FourMIK/AetherCore.git
   cd AetherCore
   pnpm install --frozen-lockfile
   ```

3. **Verify Local Build**
   ```bash
   # Build and test locally
   cd packages/dashboard
   pnpm run tauri:build
   ```

### Code Signing Credentials

**For macOS Releases:**
- Apple Developer Certificate (`.p12` file)
- Certificate password
- Signing identity (Team ID or Developer ID)
- Apple ID for notarization (optional but recommended)

**For Windows Releases:**
- Code signing certificate (`.pfx` file)
- Certificate password
- Valid timestamp server configuration

**Setting Up Secrets (Repository Admins Only):**

Navigate to GitHub repository → Settings → Secrets → Actions, and add:

| Secret Name | Description | Required For |
|-------------|-------------|--------------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate | macOS |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | macOS |
| `APPLE_SIGNING_IDENTITY` | Team ID or Developer ID | macOS |
| `WINDOWS_CERTIFICATE` | Base64-encoded .pfx certificate | Windows |
| `WINDOWS_CERTIFICATE_PASSWORD` | Certificate password | Windows |

---

## Release Workflow

### Step 1: Pre-Release Validation (Local)

Before tagging a release, validate locally:

```bash
# From repository root
./scripts/release-checklist.sh
```

This comprehensive script verifies:
- ✅ Documentation completeness
- ✅ Test suite execution (Rust + TypeScript)
- ✅ SBOM generation and supply chain security
- ✅ Version consistency across manifests
- ✅ Lock file integrity
- ✅ Rust compilation

**Expected Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ RELEASE VALIDATION PASSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All critical checks passed. Desktop release may proceed.
```

**If Validation Fails:**
- Review error messages carefully
- Fix all FAILED checks (red ✗)
- Review WARNINGS (yellow ⚠) and fix if critical
- Re-run the script until all checks pass

### Step 2: Update Version Numbers

Ensure consistency across all manifests:

```bash
# Update version in root package.json
vim package.json  # Set "version": "0.2.0"

# Update version in Tauri Cargo.toml
vim packages/dashboard/src-tauri/Cargo.toml  # Set version = "0.2.0"

# Update version in Tauri config
vim packages/dashboard/src-tauri/tauri.conf.json  # Set "version": "0.2.0"

# Update lock files
pnpm install --frozen-lockfile
cargo update -w
```

**Verify Consistency:**
```bash
grep -r '"version"' package.json
grep 'version = ' packages/dashboard/src-tauri/Cargo.toml
grep '"version"' packages/dashboard/src-tauri/tauri.conf.json
```

All three should show the same version number.

### Step 3: Update Release Notes

Create or update release notes:

```bash
# Create a release notes file
vim RELEASE_NOTES_v0.2.0.md
```

**Template:**
```markdown
# AetherCore Tactical Glass v0.2.0

## Release Date
YYYY-MM-DD

## What's New
- Feature 1: Description
- Feature 2: Description
- Bug fix: Description

## Breaking Changes
- Change 1: Migration path
- Change 2: Migration path

## Security Updates
- CVE-YYYY-XXXXX: Fixed vulnerability in dependency X
- Updated dependency Y to version Z

## Known Issues
- Issue 1: Workaround
- Issue 2: Expected resolution timeline

## Verification
SHA-256 checksums and SBOM artifacts are attached to this release.
See SUPPLY_CHAIN_MANIFEST.md for supply chain verification.

## Installation
See [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md) for installation instructions.
```

### Step 4: Commit and Tag

```bash
# Commit version changes
git add package.json packages/dashboard/src-tauri/Cargo.toml packages/dashboard/src-tauri/tauri.conf.json
git add pnpm-lock.yaml Cargo.lock
git commit -m "chore: bump version to v0.2.0"

# Create signed tag (recommended)
git tag -s v0.2.0 -m "Release v0.2.0"

# Or create regular tag
git tag -a v0.2.0 -m "Release v0.2.0"

# Push commits and tags
git push origin main
git push origin v0.2.0
```

### Step 5: Automated Build (GitHub Actions)

Pushing a tag triggers the `.github/workflows/desktop-release.yml` workflow:

**Workflow Steps:**
1. ✅ Checkout code
2. ✅ Setup Rust and Node.js toolchains
3. ✅ Install dependencies
4. ✅ **Run Operation Ironclad checklist** (BLOCKING GATE)
5. ✅ Install supply chain tools
6. ✅ Build frontend (TypeScript)
7. ✅ **Validate code signing configuration** (BLOCKING GATE)
8. ✅ Build & package Tauri app
9. ✅ Generate checksums
10. ✅ Upload SBOM artifacts
11. ✅ Create GitHub release with artifacts

**The build FAILS if:**
- ❌ Release checklist validation fails
- ❌ Code signing is not configured (production tags only)
- ❌ Tests fail
- ❌ SBOM generation fails
- ❌ HIGH or CRITICAL vulnerabilities detected
- ❌ Build timeout exceeded (15 minutes)

### Step 6: Monitor Build Progress

1. Navigate to **Actions** tab in GitHub
2. Find the "Operation Ironclad: Desktop Release" workflow
3. Monitor each job (macOS, Windows)
4. Review logs if any step fails

**Build Artifacts:**
- macOS: `.dmg` installer (universal binary)
- Windows: `.msi` installer
- SBOM files: `tauri-sbom.json`, `frontend-sbom.json`, etc.

### Step 7: Verify Release

Once the workflow completes:

1. **Download Artifacts**
   ```bash
   # Download from GitHub releases page
   wget https://github.com/FourMIK/AetherCore/releases/download/v0.2.0/Tactical-Glass_0.2.0_universal.dmg
   wget https://github.com/FourMIK/AetherCore/releases/download/v0.2.0/Tactical-Glass_0.2.0_x64_en-US.msi
   ```

2. **Verify Checksums**
   ```bash
   # Compare with checksums in release notes
   shasum -a 256 Tactical-Glass_0.2.0_universal.dmg
   sha256sum Tactical-Glass_0.2.0_x64_en-US.msi
   ```

3. **Verify SBOM**
   ```bash
   # Download SBOM artifacts
   wget https://github.com/FourMIK/AetherCore/releases/download/v0.2.0/tauri-sbom.json
   wget https://github.com/FourMIK/AetherCore/releases/download/v0.2.0/SUPPLY_CHAIN_MANIFEST.md
   
   # Review for unexpected dependencies
   jq '.components[] | {name: .name, version: .version}' tauri-sbom.json
   ```

4. **Test Installation**
   - Install on a clean macOS/Windows machine
   - Verify application launches
   - Test core functionality (login, dashboard, etc.)
   - Check for codesign verification (macOS: `codesign -dv --verbose=4 /Applications/Tactical\ Glass.app`)

### Step 8: Announce Release

After verification:

1. **Update Release Notes on GitHub**
   - Edit the GitHub release
   - Add detailed release notes
   - Attach any additional documentation

2. **Notify Stakeholders**
   - Post in team Slack/Discord
   - Email distribution list
   - Update documentation site

3. **Archive SBOM**
   - Store SBOM artifacts in secure archive
   - Update The Great Gospel ledger (if applicable)

---

## Troubleshooting

### Release Checklist Fails

**Issue:** `./scripts/release-checklist.sh` reports failures

**Solution:**
1. Read the specific failure messages
2. Fix the root cause (e.g., update dependencies, fix tests)
3. Re-run the checklist
4. Do NOT bypass the checklist

### Code Signing Failure

**Issue:** "Code signing not configured" error in CI

**Solution:**
1. Verify secrets are set in GitHub repository settings
2. Check certificate validity (not expired)
3. For testing, use pre-release tags (e.g., `v0.2.0-beta`)

### Build Timeout

**Issue:** Build exceeds 15-minute timeout

**Solution:**
1. Check for slow tests
2. Review dependency installation time
3. Consider increasing timeout in workflow (not recommended)
4. Optimize build process

### SBOM Generation Fails

**Issue:** Supply chain verification step fails

**Solution:**
1. Check `cargo-audit` output for vulnerable dependencies
2. Update vulnerable dependencies: `cargo update`
3. Review `npm audit` output
4. Update npm dependencies: `npm update`
5. If no patch available, fork and patch or replace dependency

### Version Mismatch

**Issue:** "Version consistency across manifests" check fails

**Solution:**
```bash
# Ensure all three match
jq '.version' package.json
grep 'version = ' packages/dashboard/src-tauri/Cargo.toml
jq '.version' packages/dashboard/src-tauri/tauri.conf.json

# Update to match, then regenerate lock files
pnpm install --frozen-lockfile
cargo update -w
```

---

## Emergency Hotfix Process

For critical security vulnerabilities:

1. **Create Hotfix Branch**
   ```bash
   git checkout -b hotfix/v0.2.1 v0.2.0
   ```

2. **Apply Minimal Fix**
   - Fix only the critical issue
   - No feature additions
   - No refactoring

3. **Update Version** (patch bump)
   ```bash
   # v0.2.0 → v0.2.1
   # Update all three version files
   ```

4. **Run Release Checklist**
   ```bash
   ./scripts/release-checklist.sh
   ```

5. **Tag and Release**
   ```bash
   git commit -m "fix: critical security issue"
   git tag -s v0.2.1 -m "Hotfix v0.2.1: Security patch"
   git push origin hotfix/v0.2.1
   git push origin v0.2.1
   ```

6. **Merge Back**
   ```bash
   git checkout main
   git merge hotfix/v0.2.1
   git push origin main
   ```

---

## Pre-Release (Beta) Testing

For testing without full code signing:

```bash
# Use pre-release tag format
git tag -a v0.3.0-beta.1 -m "Beta release for testing"
git push origin v0.3.0-beta.1
```

**Note:** Pre-release tags may have relaxed code signing requirements for internal testing.

---

## Rollback Procedure

If a release has critical issues:

1. **Mark Release as Pre-release**
   - Edit GitHub release
   - Check "This is a pre-release"

2. **Create Issue**
   - Document the problem
   - Assign priority
   - Link to release

3. **Notify Users**
   - Post warning in release notes
   - Email distribution list
   - Recommend downgrade if necessary

4. **Prepare Hotfix**
   - Follow emergency hotfix process
   - Release as soon as verified

---

## Compliance & Audit

### Required Artifacts Per Release

- ✅ Source code (Git tag)
- ✅ Compiled binaries (`.dmg`, `.msi`)
- ✅ SBOM files (CycloneDX format)
- ✅ License manifest (BLAKE3 hashes)
- ✅ Supply chain manifest
- ✅ SHA-256 checksums
- ✅ Code signing signatures
- ✅ Release notes

### Retention Policy

- **Binaries**: 2 years minimum
- **SBOM artifacts**: Indefinite (required for audits)
- **Build logs**: 90 days (GitHub Actions default)
- **Source code**: Indefinite (Git)

---

## References

- [Desktop Deployment Guide](../DEPLOYMENT_DESKTOP.md)
- [Supply Chain Security](SUPPLY_CHAIN_SECURITY.md)
- [Security Policy](../SECURITY.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

---

## Glossary

- **Operation Ironclad**: Comprehensive release validation process
- **Operation Glass Fortress**: Supply chain verification system
- **SBOM**: Software Bill of Materials
- **TRL-8**: Technology Readiness Level 8 (field deployment ready)
- **The Great Gospel**: System-wide sovereign revocation ledger
- **Aetheric Sweep**: Protocol for purging compromised nodes

---

**Status:** IRONCLAD OPERATIONAL ✅  
**Next Review:** Quarterly or upon process improvement
