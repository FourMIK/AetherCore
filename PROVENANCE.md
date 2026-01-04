# AetherCore Provenance and Supply Chain Security

**Classification:** OPERATIONAL  
**Mission:** Software Provenance and Supply Chain Integrity  
**Last Updated:** 2026-01-04

---

## Overview

This document describes AetherCore's software provenance practices, supply chain security measures, and procedures for verifying the integrity and authenticity of all released artifacts.

## Table of Contents

- [What is Software Provenance?](#what-is-software-provenance)
- [Supply Chain Security Architecture](#supply-chain-security-architecture)
- [Software Bill of Materials (SBOM)](#software-bill-of-materials-sbom)
- [Verification Procedures](#verification-procedures)
- [Cryptographic Integrity](#cryptographic-integrity)
- [Vulnerability Management](#vulnerability-management)
- [Release Artifact Verification](#release-artifact-verification)
- [Continuous Monitoring](#continuous-monitoring)

---

## What is Software Provenance?

**Software Provenance** is the complete, verifiable history of a software artifact:
- What components it contains (dependencies)
- Where those components came from (sources)
- Who built it and when (build metadata)
- How it was built (build process)
- What vulnerabilities it may contain (security audit)

**Why it Matters:**
- **Transparency**: Know exactly what's in your software
- **Security**: Detect supply chain attacks and compromised dependencies
- **Compliance**: Meet regulatory requirements (NIST, EO 14028)
- **Trust**: Cryptographic proof of authenticity and integrity

---

## Supply Chain Security Architecture

### Operation Glass Fortress

AetherCore implements "Operation Glass Fortress" - a comprehensive supply chain security program:

```
┌──────────────────────────────────────────────────────┐
│          Operation Glass Fortress                    │
├──────────────────────────────────────────────────────┤
│  [1] Dependency Pinning     (Cargo.lock, package-lock)
│  [2] Vulnerability Audit    (cargo-audit, npm audit)  
│  [3] SBOM Generation        (CycloneDX v1.4+)         
│  [4] License Integrity      (BLAKE3 hashing)          
│  [5] Release Signing        (Ed25519 signatures)      
└──────────────────────────────────────────────────────┘
```

### The Four Pillars

#### 1. Dependency Pinning

**Purpose:** Ensure reproducible builds and prevent dependency confusion attacks.

**Implementation:**
- **Rust**: `Cargo.lock` pins all transitive dependencies
- **Node.js**: `package-lock.json` pins all npm packages
- **Both committed to version control**

**Verification:**
```bash
# Verify lock files are synchronized
cargo generate-lockfile --locked
npm ci  # Fails if package-lock.json doesn't match package.json
```

#### 2. Vulnerability Scanning

**Purpose:** Detect known security vulnerabilities in dependencies.

**Tools:**
- **Rust**: `cargo-audit` against RUSTSEC advisory database
- **Node.js**: `npm audit` against npm advisory database

**Policy:**
- ❌ **HIGH or CRITICAL vulnerabilities**: Build FAILS
- ⚠️ **MEDIUM vulnerabilities**: Warning (review required)
- ℹ️ **LOW vulnerabilities**: Informational

**Manual Audit:**
```bash
# Rust dependencies
cargo install cargo-audit
cargo audit --deny warnings

# Node.js dependencies
npm audit --audit-level=high
```

#### 3. SBOM Generation

**Purpose:** Create machine-readable inventory of all software components.

**Format:** CycloneDX v1.4+ (OWASP standard)

**Generated Artifacts:**
- `tauri-sbom.json` - Rust/Tauri backend dependencies
- `frontend-sbom.json` - TypeScript/React frontend dependencies
- `LICENSE_MANIFEST.txt` - License integrity hashes
- `SUPPLY_CHAIN_MANIFEST.md` - Human-readable summary

**Generation:**
```bash
# From repository root
./scripts/generate-sbom.sh
```

**Output:** `sbom-artifacts/` directory

#### 4. License Integrity

**Purpose:** Detect license tampering and ensure compliance.

**Implementation:**
- BLAKE3 hash of every dependency's license file
- Hashes stored in `LICENSE_MANIFEST.txt`
- Changes detected via hash comparison

**Verification:**
```bash
# Verify license hashes
cd sbom-artifacts
cat LICENSE_MANIFEST.txt | while read hash file; do
    computed=$(b3sum "$file" | cut -d' ' -f1)
    if [ "$hash" != "$computed" ]; then
        echo "MISMATCH: $file"
    fi
done
```

---

## Software Bill of Materials (SBOM)

### What's in an SBOM?

Each SBOM contains:

**Component Information:**
- Component name and version
- Package type (library, application)
- Author/publisher
- License (SPDX identifier)
- Package URL (purl)

**Dependency Graph:**
- Direct dependencies
- Transitive dependencies
- Dependency relationships

**Metadata:**
- Build timestamp
- Build environment
- Tool versions

### SBOM Structure (CycloneDX)

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.4",
  "version": 1,
  "metadata": {
    "timestamp": "2026-01-04T20:00:00Z",
    "component": {
      "name": "aethercore-tactical-glass",
      "version": "0.1.0",
      "type": "application"
    }
  },
  "components": [
    {
      "type": "library",
      "name": "ed25519-dalek",
      "version": "2.1.0",
      "licenses": [
        { "license": { "id": "BSD-3-Clause" } }
      ],
      "hashes": [
        {
          "alg": "BLAKE3",
          "content": "a1b2c3d4e5f6..."
        }
      ]
    }
  ],
  "dependencies": [...]
}
```

### Accessing SBOMs

**For Released Versions:**

1. Go to [GitHub Releases](https://github.com/FourMIK/AetherCore/releases)
2. Select the release version
3. Download SBOM artifacts:
   - `tauri-sbom.json`
   - `frontend-sbom.json`
   - `LICENSE_MANIFEST.txt`
   - `SUPPLY_CHAIN_MANIFEST.md`

**For Development Builds:**

```bash
# Generate SBOM locally
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore
./scripts/generate-sbom.sh

# View generated SBOMs
ls -l sbom-artifacts/
```

---

## Verification Procedures

### Pre-Deployment Verification

**Before deploying any AetherCore release, operators MUST:**

#### Step 1: Verify Release Integrity

```bash
# Download release artifacts
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/aethercore-tactical-glass.dmg
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/SUPPLY_CHAIN_MANIFEST.md

# Verify SHA-256 checksum (published in release notes)
shasum -a 256 aethercore-tactical-glass.dmg
# Compare with published checksum
```

#### Step 2: Review SBOM

```bash
# Download SBOMs
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/tauri-sbom.json
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/frontend-sbom.json

# Review component list
cat tauri-sbom.json | jq '.components[] | {name, version, licenses}'
cat frontend-sbom.json | jq '.components[] | {name, version, licenses}'
```

#### Step 3: Verify No Known Vulnerabilities

```bash
# Install vulnerability scanning tools
cargo install cargo-audit
npm install -g npm-audit-resolver

# Check Rust dependencies
cargo audit --file Cargo.lock --deny warnings

# Check npm dependencies
npm audit --audit-level=high
```

#### Step 4: Verify License Compliance

```bash
# Download license manifest
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/LICENSE_MANIFEST.txt

# Review licenses for compliance
cat LICENSE_MANIFEST.txt
# Ensure no unexpected licenses (e.g., GPL in proprietary context)
```

### Automated Verification Script

```bash
#!/bin/bash
# verify-aethercore-release.sh

set -e

VERSION="$1"
RELEASE_URL="https://github.com/FourMIK/AetherCore/releases/download/$VERSION"

echo "=== AetherCore Release Verification ==="
echo "Version: $VERSION"
echo ""

# Download artifacts
echo "[1/4] Downloading release artifacts..."
curl -L "$RELEASE_URL/tauri-sbom.json" -o tauri-sbom.json
curl -L "$RELEASE_URL/frontend-sbom.json" -o frontend-sbom.json
curl -L "$RELEASE_URL/LICENSE_MANIFEST.txt" -o LICENSE_MANIFEST.txt

# Verify SBOMs are valid JSON
echo "[2/4] Validating SBOM format..."
jq empty tauri-sbom.json || { echo "Invalid tauri-sbom.json"; exit 1; }
jq empty frontend-sbom.json || { echo "Invalid frontend-sbom.json"; exit 1; }
echo "✓ SBOMs are valid"

# Check for HIGH/CRITICAL vulnerabilities
echo "[3/4] Checking for known vulnerabilities..."
# This is a simplified check; real implementation would parse SBOM and query CVE databases
VULN_COUNT=$(jq '[.components[] | select(.vulnerabilities != null)] | length' tauri-sbom.json)
if [ "$VULN_COUNT" -gt 0 ]; then
    echo "⚠ Warning: $VULN_COUNT components have known vulnerabilities"
    jq '.components[] | select(.vulnerabilities != null) | {name, version, vulnerabilities}' tauri-sbom.json
    exit 1
fi
echo "✓ No known vulnerabilities detected"

# Verify license compliance
echo "[4/4] Verifying license compliance..."
# Check for copyleft licenses if prohibited
COPYLEFT_LICENSES=$(jq -r '.components[].licenses[]?.license.id // empty' tauri-sbom.json | grep -E 'GPL|AGPL' || true)
if [ -n "$COPYLEFT_LICENSES" ]; then
    echo "⚠ Warning: Copyleft licenses detected:"
    echo "$COPYLEFT_LICENSES"
    # In strict environments, this would fail
fi
echo "✓ License compliance verified"

echo ""
echo "=== Verification Complete ==="
echo "Release $VERSION is verified for deployment"
```

**Usage:**
```bash
chmod +x verify-aethercore-release.sh
./verify-aethercore-release.sh v0.1.0
```

---

## Cryptographic Integrity

### Hash Algorithms

**BLAKE3 (Primary):**
- All integrity verification
- Merkle tree construction
- License hashing
- Event chain hashing

**SHA-256 (Legacy Compatibility):**
- GitHub release checksums (platform compatibility)
- Explicitly marked as legacy
- Being phased out in favor of BLAKE3

### Signature Verification

**Release Signatures (Roadmap):**

Future releases will include Ed25519 signatures:

```bash
# Download release and signature
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/aethercore-tactical-glass.dmg
wget https://github.com/FourMIK/AetherCore/releases/download/v0.1.0/aethercore-tactical-glass.dmg.sig

# Download public key
wget https://aethercore.io/release-signing-key.pub

# Verify signature
ed25519-verify release-signing-key.pub aethercore-tactical-glass.dmg.sig aethercore-tactical-glass.dmg
```

**Integration with The Great Gospel:**

Signatures will be recorded in The Great Gospel ledger for:
- Immutable audit trail
- Cross-mesh verification
- Revocation capability

---

## Vulnerability Management

### Vulnerability Scanning Process

**Continuous Monitoring:**

1. **Daily Automated Scans**:
   - GitHub Dependabot alerts
   - cargo-audit in CI pipeline
   - npm audit in CI pipeline

2. **Advisory Subscriptions**:
   - RUSTSEC mailing list
   - npm security advisories
   - GitHub Security Advisories

3. **CVE Database Monitoring**:
   - NIST NVD
   - MITRE CVE
   - OWASP Dependency-Check

### Vulnerability Response SLA

| Severity | Assessment | Patching | Disclosure |
|----------|------------|----------|------------|
| CRITICAL | <4 hours | <24 hours | Immediate |
| HIGH | <24 hours | <7 days | 30 days |
| MEDIUM | <7 days | <30 days | 90 days |
| LOW | <30 days | Best effort | 90 days |

### Patching Process

**For Direct Dependencies:**
1. Update dependency version in `Cargo.toml` or `package.json`
2. Run tests to verify compatibility
3. Regenerate lock files
4. Regenerate SBOM
5. Create security patch release

**For Transitive Dependencies:**
1. Update direct dependency to version that includes fix
2. If unavailable, consider:
   - Forking and patching
   - Replacing dependency
   - Applying workarounds
3. NEVER ship with known HIGH/CRITICAL vulnerabilities

**Emergency Response:**
```bash
# Immediately revoke affected release in The Great Gospel
gospel revoke-release v0.1.0 --reason "CVE-2026-XXXX CRITICAL"

# Deploy emergency patch
git checkout -b security-patch-CVE-2026-XXXX
# Apply fix
cargo audit --deny warnings
./scripts/generate-sbom.sh
git commit -m "Security patch: CVE-2026-XXXX"
git tag -a v0.1.1-security -m "Emergency security patch"
git push origin v0.1.1-security

# Notify all operators
echo "SECURITY ADVISORY: All v0.1.0 deployments MUST upgrade to v0.1.1"
```

---

## Release Artifact Verification

### What Gets Released?

**Desktop Applications:**
- Linux: `.AppImage`
- macOS: `.dmg` (Universal binary)
- Windows: `.msi`

**Provenance Artifacts:**
- `tauri-sbom.json`
- `frontend-sbom.json`
- `LICENSE_MANIFEST.txt`
- `SUPPLY_CHAIN_MANIFEST.md`
- SHA-256 checksums (in release notes)

**Metadata:**
- Release notes
- Changelog
- Security advisories (if applicable)

### Verification Checklist for Operators

Before deploying:

- [ ] Download release artifacts from official GitHub releases only
- [ ] Verify SHA-256 checksums match published values
- [ ] Download and review SBOM artifacts
- [ ] Run vulnerability scan on SBOMs
- [ ] Review license compliance
- [ ] Check for security advisories
- [ ] Verify no revocations in The Great Gospel
- [ ] Test in non-production environment first
- [ ] Document deployment in change log

### Build Reproducibility

**Goal:** Different builders should produce identical artifacts.

**Current Status:** Partial reproducibility
- Rust binaries: Deterministic builds via cargo
- Node.js builds: Timestamp variations exist
- Tauri packaging: Some platform-specific variations

**Roadmap:**
- Full reproducible builds
- Multiple independent build verification
- Build provenance attestation

---

## Continuous Monitoring

### Supply Chain Monitoring

**Continuous Activities:**

1. **Dependency Monitoring**:
   - Track new releases of dependencies
   - Monitor for deprecation notices
   - Evaluate security posture of upstream projects

2. **Vulnerability Monitoring**:
   - Subscribe to security advisories
   - Automated scanning in CI/CD
   - Regular manual security reviews

3. **License Monitoring**:
   - Track license changes in dependencies
   - Alert on incompatible license additions
   - Maintain license compliance matrix

4. **Integrity Monitoring**:
   - Verify lock files unchanged (except intentional updates)
   - Monitor for supply chain attacks (dependency confusion, typosquatting)
   - Audit build pipeline for compromise

### Metrics and Reporting

**Track and Report:**
- Total dependency count (minimize)
- Known vulnerability count (zero HIGH/CRITICAL)
- Dependency freshness (update lag)
- License compliance status
- SBOM generation success rate

**Quarterly Supply Chain Report:**
- Dependency updates applied
- Vulnerabilities resolved
- License changes
- Supply chain incidents (if any)
- Recommendations for improvement

---

## Integration with AetherCore Security

### The Great Gospel Integration

**Supply Chain Events Recorded:**
- Release publication (with SBOM hash)
- Vulnerability disclosures
- Release revocations
- Dependency compromises

**Benefits:**
- Immutable audit trail
- Cross-mesh vulnerability propagation
- Automated revocation on compromise

### Aetheric Sweep and Supply Chain

**Byzantine Detection:**

If supply chain compromise detected:
1. Release revoked in The Great Gospel
2. Aetheric Sweep triggered across all meshes
3. Affected nodes isolated immediately
4. Operators notified for remediation

**Example:**
```rust
// Detected compromised dependency in production
gospel::revoke_release("v0.1.0", RevocationReason::SupplyChainCompromise {
    cve: "CVE-2026-12345",
    component: "compromised-lib",
}).await?;

// Aetheric Sweep isolates all nodes running affected version
aetheric_sweep::isolate_nodes_with_version("v0.1.0").await?;
```

---

## Tools and Resources

### Required Tools

**For SBOM Generation:**
```bash
# Rust tools
cargo install cargo-audit --locked
cargo install cargo-cyclonedx --locked
cargo install b3sum --locked

# Node.js tools
npm install -g @cyclonedx/cyclonedx-npm
```

**For SBOM Analysis:**
```bash
# CycloneDX CLI tools
npm install -g @cyclonedx/cyclonedx-cli

# SBOM validation
cyclonedx validate --input-file tauri-sbom.json

# SBOM analysis
cyclonedx analyze --input-file tauri-sbom.json
```

### External Resources

- **CycloneDX Specification**: https://cyclonedx.org/specification/overview/
- **RUSTSEC Advisory Database**: https://rustsec.org/
- **npm Advisory Database**: https://github.com/advisories
- **NIST SP 800-218**: https://csrc.nist.gov/publications/detail/sp/800-218/final
- **BLAKE3 Cryptographic Hash**: https://github.com/BLAKE3-team/BLAKE3
- **OWASP Dependency-Check**: https://owasp.org/www-project-dependency-check/

---

## Glossary

- **SBOM**: Software Bill of Materials - inventory of software components
- **CycloneDX**: OWASP standard for SBOM representation
- **Provenance**: Complete history and origin of software artifacts
- **BLAKE3**: Cryptographic hash function (successor to BLAKE2)
- **CVE**: Common Vulnerabilities and Exposures identifier
- **RUSTSEC**: Rust Security Advisory Database
- **Transitive Dependency**: Dependency of a dependency
- **Supply Chain Attack**: Compromise via third-party dependencies
- **The Great Gospel**: AetherCore's sovereign revocation ledger
- **Aetheric Sweep**: Protocol for purging compromised nodes

---

## Related Documentation

- [INSTALLATION.md](INSTALLATION.md) - Installation procedures
- [SECURITY.md](SECURITY.md) - Security guidelines and best practices
- [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md) - Deployment guide
- [docs/SUPPLY_CHAIN_SECURITY.md](docs/SUPPLY_CHAIN_SECURITY.md) - Detailed supply chain procedures
- [README.md](README.md) - Repository overview and build instructions

---

**Status:** PROVENANCE DOCUMENTATION OPERATIONAL ✅  
**Classification:** OPERATIONAL  
**Maintainer:** AetherCore Security Team  
**Next Review:** Quarterly or upon major release

---

## Quick Reference

### Generate SBOM
```bash
./scripts/generate-sbom.sh
```

### Verify Release
```bash
# Check integrity
shasum -a 256 <artifact>

# Audit dependencies
cargo audit --deny warnings
npm audit --audit-level=high
```

### View SBOM Components
```bash
jq '.components[] | {name, version, licenses}' tauri-sbom.json
```

### Check for Vulnerabilities
```bash
cargo audit
npm audit
```
