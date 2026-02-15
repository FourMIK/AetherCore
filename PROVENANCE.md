# AetherCore Provenance & Build Attestation

**Classification:** COSMIC  
**Last Updated:** 2026-02-15  
**Scope:** Field-test production release validation artifacts and provenance policy.

## Table of Contents
- [Purpose](#purpose)
- [Provenance Model](#provenance-model)
- [Build Inputs](#build-inputs)
- [Dependency Integrity](#dependency-integrity)
- [Release Attestation Workflow](#release-attestation-workflow)
- [Environment Constraints](#environment-constraints)
- [Cross References](#cross-references)
- [Appendix A: Security Excerpts](#appendix-a-security-excerpts)
- [Appendix B: Supply Chain Excerpts](#appendix-b-supply-chain-excerpts)

## Purpose
This document records how AetherCore establishes provenance for source, dependencies, build outputs, and release artifacts. It complements `SECURITY.md` and `docs/SUPPLY_CHAIN_SECURITY.md` by providing operational controls and attestation checkpoints for release gates.

## Provenance Model
- Source provenance is tied to Git commit history and signed release tags.
- Dependency provenance is tied to lock files (`Cargo.lock`, `pnpm-lock.yaml` or `package-lock.json`) and SBOM manifests.
- Build provenance is tied to deterministic scripts in `scripts/` with CI-run verification.
- Artifact provenance is tied to generated SBOM outputs, signed hash manifests (`SHA256SUMS-macos.txt`/`SHA256SUMS-windows.txt` and `.sig`), and per-platform provenance JSON (`provenance-macos.json`, `provenance-windows.json`).

## Build Inputs
A production candidate release requires immutable build inputs: exact Rust crate versions, exact JS package graph, pinned toolchain versions, and explicit configuration manifests. Any mutable or unpinned dependency source is disallowed for clean release promotion.

## Dependency Integrity
1. Rust dependency checks: `cargo audit`, `cargo deny`, CycloneDX generation.
2. JS dependency checks: npm/pnpm audit policy, CycloneDX generation or metadata fallback when the generator is unavailable.
3. License integrity: hashing all discovered license files and storing evidence in `LICENSE_MANIFEST.txt`.
4. Unified evidence: `SUPPLY_CHAIN_MANIFEST.md` includes lock file hashes and counts for generated SBOM components.

## Release Attestation Workflow
- Run `scripts/release-checklist.sh` for go/no-go decisioning.
- Enforce platform trust-chain gates in `.github/workflows/desktop-release.yml`:
  - macOS: Developer ID signature verification, notarization success, and stapling validation.
  - Windows: Authenticode signature verification with trusted timestamp validation.
- Execute post-build clean-runner validation on macOS and Windows by installing produced artifacts, launching with `--bootstrap`, and asserting first-run bootstrap reaches ready-state persistence.
- Publish release integrity artifacts for each tag:
  - `SHA256SUMS-macos.txt`
  - `SHA256SUMS-macos.txt.sig`
  - `SHA256SUMS-windows.txt`
  - `SHA256SUMS-windows.txt.sig`
  - `provenance-macos.json`
  - `provenance-windows.json`
- Attach SBOM evidence and GitHub build provenance attestations to the release.
- Ensure documentation completeness (including this file), test health, supply-chain evidence, and manifest consistency.
- For field tests where TPM is disabled, document TPM mode and ensure non-TPM controls remain fully active.
- Produce release commit and PR traceability with summary of all checks and known environment constraints.

## Environment Constraints
Some development environments lack system GUI dependencies (e.g., `glib-2.0`) required by desktop-linked crates. In those constrained contexts, the release checklist records warning status for unavailable system-level runtime prerequisites while maintaining strict failures for logic, type safety, documentation, and supply-chain integrity controls.

## Cross References
- Security controls and threat model: `SECURITY.md`
- Supply chain hardening policy: `docs/SUPPLY_CHAIN_SECURITY.md`
- Deployment readiness and field execution: `DEPLOYMENT_DESKTOP.md`
- Installation and setup details: `INSTALLATION.md`
- Release workflow implementation: `.github/workflows/desktop-release.yml`

## Appendix A: Security Excerpts

```markdown
# AetherCore Security Guidelines

**Classification:** CRITICAL  
**Mission:** Comprehensive Security Procedures and Best Practices  
**Last Updated:** 2025-01-23

---

## ⚠️ Dev Mode Security Scope

**This document describes production security architecture.** The current Windows desktop application runs in **Dev Mode**, which implements only a subset of these security features.

**For Dev Mode security boundaries and limitations, see:**
- **[DEV_MODE.md](DEV_MODE.md)** - Dev Mode capabilities and limitations
- **[SECURITY_SCOPE.md](SECURITY_SCOPE.md)** - Detailed security boundaries and threat model

**Key Dev Mode Limitations:**
- ❌ No TPM/Secure Enclave integration
- ❌ No hardware-backed identity
- ❌ No remote attestation
- ❌ Software-only cryptography

**Do NOT deploy Dev Mode builds to production environments.**

---

## Overview

This document outlines security architecture, best practices, and operational procedures for AetherCore production deployments. All personnel must adhere to these guidelines for production use.

## Table of Contents

- [Security Architecture](#security-architecture)
- [Cryptographic Standards](#cryptographic-standards)
- [Identity and Authentication](#identity-and-authentication)
- [Network Security](#network-security)
- [Production Deployment Security](#production-deployment-security)
- [Zero-Touch Enrollment Security](#zero-touch-enrollment-security)
- [Trust Mesh Security](#trust-mesh-security)
- [Incident Response](#incident-response)
- [Security Audit and Compliance](#security-audit-and-compliance)

---

## Security Architecture

### Defense-in-Depth Philosophy

AetherCore implements multi-layered security:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Hardware Root of Trust (TPM/Enclave) │
├─────────────────────────────────────────────────┤
│  Layer 2: Cryptographic Primitives (Ed25519)   │
├─────────────────────────────────────────────────┤
│  Layer 3: Trust Mesh (Byzantine Detection)     │
├─────────────────────────────────────────────────┤
│  Layer 4: Network Security (TLS 1.3/WSS)       │
├─────────────────────────────────────────────────┤
│  Layer 5: Application Security (Input Validation)
└─────────────────────────────────────────────────┘
```

### Zero-Trust Principles

**Fundamental Assumptions:**
1. **Never Trust, Always Verify**: Every operation requires cryptographic proof
2. **Assume Breach**: Design for compromise; enable rapid detection and recovery
3. **Minimize Blast Radius**: Isolate components to limit cascade failures
4. **Fail Securely**: Security failures halt operations; no graceful degradation

---

## Cryptographic Standards

### Mandatory Standards

**Hashing:**
- ✅ **BLAKE3**: All integrity verification, Merkle trees, and checksums
- ❌ **SHA-256**: Deprecated; legacy compatibility only (explicitly marked)
- ❌ **MD5**: Prohibited; immediate security failure

**Signing:**
- ✅ **Ed25519**: All digital signatures (TPM-backed in production)
- ❌ **RSA**: Not used; key size and performance concerns
- ❌ **ECDSA**: Not used; complexity and side-channel risks

**Key Storage:**
- ✅ **TPM 2.0**: Hardware-backed private key storage (production)
- ✅ **Secure Enclave**: Apple Silicon/Intel SGX (production)
- ❌ **System Memory**: Prohibited; private keys never in RAM
- ❌ **Disk Storage**: Prohibited; no private keys in files

**Transport Encryption:**
- ✅ **TLS 1.3**: All authenticated network communication
- ✅ **WSS (WebSocket Secure)**: Real-time mesh communication
- ❌ **TLS 1.2 or earlier**: Prohibited; known vulnerabilities
- ❌ **Unencrypted WebSocket**: Development only; never production

### Implementation Requirements

**Rust Crates:**
```rust
// MANDATORY: Use approved cryptographic crates
use blake3;           // Hashing
use ed25519_dalek;    // Signing
use tpm2_tss;         // TPM integration (CodeRalphie)

// PROHIBITED: Do not use these
// use sha2;          // Deprecated
// use openssl;       // Use tpm2_tss instead for production
```

**TypeScript Libraries:**
```typescript
// MANDATORY: Use approved libraries
import { blake3 } from '@noble/hashes/blake3';
import * as ed from '@noble/ed25519';

// PROHIBITED
// import sha256 from 'crypto-js/sha256';  // Deprecated
```

### CodeRalphie: TPM Integration

**Production Requirement:** All private key operations MUST use TPM 2.0.

**Implementation:**
```rust
use tpm2_tss::{TpmContext, TpmSigningKey};
use crate::error::CryptoError;

pub fn sign_with_tpm(message: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let context = TpmContext::new()?;
    let key = TpmSigningKey::load_from_tpm(context)?;
    
    // Private key never enters system memory
    let signature = key.sign(message)?;
    
    Ok(signature)
}

// PROHIBITED: Never do this in production
// fn sign_with_memory_key(message: &[u8], private_key: &[u8]) -> Signature {
//     // This exposes private keys in memory - security violation
// }
```

**Key Generation:**
```rust
// Generate key INSIDE TPM
let tpm_key = TpmContext::generate_ed25519_key()?;
let public_key = tpm_key.export_public_key()?; // Safe to export
// Private key remains in TPM, never exported
```

### Key Rotation Policy

- **Operational Keys**: Rotate every 90 days
- **Emergency Rotation**: Immediate upon suspected compromise
- **Revocation**: Use The Great Gospel ledger for instant invalidation

---

## Identity and Authentication

### Identity Hierarchy

```
┌─────────────────────────────────────────┐
│  The Great Gospel (Sovereign Ledger)   │
│  - Root of trust for all identities     │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │  Operator IDs   │
       │  (Human users)  │
       └───────┬─────────┘
               │
       ┌───────┴─────────┐
       │   Unit IDs      │
       │   (IoT devices) │
       └─────────────────┘
```

### Operator Identity Requirements

**Production Operator Accounts:**
- TPM-backed Ed25519 key pair
- Multi-factor authentication (MFA) mandatory
- Biometric verification recommended
- Regular re-authentication (24-hour sessions)

**Development/Testing:**
- Ephemeral keys acceptable
- Clearly marked in UI as "DEVELOPMENT MODE"
- No access to production meshes

### Unit Identity (IoT Devices)

**Zero-Touch Enrollment:**
1. Operator generates Genesis Bundle (signed with TPM key)
2. QR code contains:
   - Operator public key
   - Squad assignment
   - Enrollment timestamp
   - BLAKE3 hash of bundle
   - Ed25519 signature
3. Unit scans QR, verifies signature
4. Unit generates own TPM-backed key pair
5. Unit registers with mesh using Genesis Bundle proof

**Identity Verification:**
```rust
pub fn verify_genesis_bundle(bundle: &GenesisBundleQR) -> Result<(), SecurityError> {
    // 1. Verify signature using operator's public key
    let signature_valid = verify_ed25519(
        &bundle.operator_public_key,
        &bundle.payload,
        &bundle.signature,
    )?;
    
    if !signature_valid {
        return Err(SecurityError::InvalidSignature);
    }
    
    // 2. Verify hash integrity
    let computed_hash = blake3::hash(&bundle.payload);
    if computed_hash != bundle.hash {
        return Err(SecurityError::HashMismatch);
    }
    
    // 3. Check timestamp (prevent replay attacks)
    if bundle.timestamp.elapsed()? > Duration::from_secs(300) {
        return Err(SecurityError::BundleExpired);
    }
    
    Ok(())
}
```

### Authentication Failures

**Policy:** Fail immediately and loudly. No silent fallbacks.

```rust
// CORRECT: Fail-secure authentication
match authenticate_operator(credentials) {
    Ok(session) => proceed_with_session(session),
    Err(e) => {
        audit_log_failure(&e);
        terminate_connection();
        // Do NOT provide detailed error to client (leak prevention)
        return Err(SecurityError::AuthenticationFailed);
    }
}

// PROHIBITED: Silent fallback
// if let Ok(session) = authenticate_operator(credentials) {
//     proceed_with_session(session)
// } else {
//     // Silently using anonymous session - SECURITY VIOLATION
//     proceed_with_anonymous()
// }
```

---

## Network Security

### Transport Layer Security

**Mandatory Configuration:**
- **Protocol**: TLS 1.3 only
- **Cipher Suites**: 
  - `TLS_AES_256_GCM_SHA384`
  - `TLS_CHACHA20_POLY1305_SHA256`
- **Certificate Validation**: Always verify; no self-signed in production

**WebSocket Security:**
```typescript
// CORRECT: Secure WebSocket configuration
const ws = new WebSocket('wss://testnet.aethercore.local:8443', {
  rejectUnauthorized: true,  // Enforce certificate validation
  minVersion: 'TLSv1.3',
});

// PROHIBITED: Insecure configuration
// const ws = new WebSocket('ws://testnet.aethercore.local:8080');
// const ws = new WebSocket('wss://...', { rejectUnauthorized: false });
```

### Firewall Configuration

**Required Ports:**

| Port | Protocol | Purpose | Access Control |
|------|----------|---------|----------------|
| 8443 | TCP (TLS) | Testnet WebSocket | Authenticated operators only |
| 70
```

## Appendix B: Supply Chain Excerpts

```markdown
# Supply Chain Security Documentation
## Operation Glass Fortress

**Classification:** COSMIC  
**Mission:** TRL-8 Field Deployment Supply Chain Hardening  
**Last Updated:** 2026-01-04

---

## Overview

AetherCore implements comprehensive Software Bill of Materials (SBOM) generation and supply chain verification for all desktop release builds. This ensures cryptographic proof of provenance for every dependency in the Tactical Glass application.

## Architecture

### Defense-in-Depth Strategy

1. **Dependency Pinning**: All direct and transitive dependencies are locked
2. **Vulnerability Scanning**: Automated audit against RUSTSEC and npm advisory databases
3. **SBOM Generation**: Machine-readable CycloneDX format for both Rust and Node.js
4. **License Integrity**: BLAKE3 cryptographic hashing of all license files
5. **Fail-Visible Policy**: Build fails immediately on HIGH or CRITICAL CVEs

### The Four Pillars

```
┌──────────────────────────────────────────────────────┐
│          Operation Glass Fortress                    │
├──────────────────────────────────────────────────────┤
│  [1] Dependency Pinning     (Cargo.lock, package-lock)
│  [2] Vulnerability Audit    (cargo-audit, npm audit)  
│  [3] SBOM Generation        (CycloneDX v1.4+)         
│  [4] License Hashing        (BLAKE3)                  
└──────────────────────────────────────────────────────┘
```

---

## SBOM Generation

### Manual Execution

Generate SBOM artifacts locally:

```bash
# From repository root
./scripts/generate-sbom.sh
```

**Output Location:** `sbom-artifacts/`

### Generated Artifacts

| File | Description | Format |
|------|-------------|--------|
| `tauri-sbom.json` | Rust/Tauri backend dependencies | CycloneDX JSON |
| `frontend-sbom.json` | TypeScript/React frontend dependencies | CycloneDX JSON |
| `LICENSE_MANIFEST.txt` | BLAKE3 hashes of all license files | Plain text |
| `SUPPLY_CHAIN_MANIFEST.md` | Unified human-readable summary | Markdown |

### Tool Requirements

The script automatically installs required tools:

- **Rust**: `cargo-audit`, `cargo-cyclonedx`, `b3sum`
- **Node.js**: `@cyclonedx/cyclonedx-npm`

### Fallback Behavior

If tools are unavailable:
- **cargo-audit**: Skips with warning (will run in CI)
- **cargo-cyclonedx**: Generates `cargo metadata` fallback
- **b3sum**: Falls back to SHA-256 (with warning)

---

## CI/CD Integration

### Desktop Release Workflow

The SBOM generation is integrated into `.github/workflows/desktop-release.yml` as a mandatory step:

```yaml
- name: "🛡️ Operation Glass Fortress: Supply Chain Verification"
  run: |
    # Install SBOM tools
    cargo install cargo-audit --locked
    cargo install cargo-cyclonedx --locked
    npm install -g @cyclonedx/cyclonedx-npm
    cargo install b3sum --locked
    
    # Execute supply chain verification
    bash ./scripts/generate-sbom.sh
```

### Build Failure Policy

**The build FAILS if:**
- ❌ HIGH or CRITICAL CVE detected in Rust dependencies
- ❌ HIGH or CRITICAL CVE detected in npm dependencies  
- ❌ Unpinned dependencies found (e.g., `*` or `latest`)
- ❌ SBOM generation fails

**Directive:** We do not ship vulnerable code. Fork or replace compromised dependencies.

### Artifact Distribution

SBOM artifacts are:
1. Uploaded as GitHub Actions artifacts (90-day retention)
2. Attached to GitHub releases alongside `.msi` and `.dmg` installers
3. Available for download by field operators for verification

---

## Verification Procedures

### For Field Operators

**Before deploying a Tactical Glass release:**

1. Download the SBOM artifacts from the GitHub release
2. Verify the integrity of lock files:
   ```bash
   b3sum Cargo.lock
   b3sum package-lock.json
   ```
3. Compare hashes with those in `SUPPLY_CHAIN_MANIFEST.md`
4. Review `tauri-sbom.json` and `frontend-sbom.json` for known vulnerabilities
5. Audit `LICENSE_MANIFEST.txt` for unauthorized license changes

### Automated Verification

```bash
# Verify no vulnerabilities in Rust dependencies
cargo audit --deny warnings

# Verify no vulnerabilities in npm dependencies  
npm audit --audit-level=high

# Re-generate and compare SBOM
./scripts/generate-sbom.sh
diff sbom-artifacts/tauri-sbom.json <expected-sbom>
```

---

## Security Properties

### Zero Trust Assumptions

- **Assumption**: Any dependency can be compromised at any time
- **Mitigation**: Continuous monitoring + cryptographic verification
- **Recovery**: Aetheric Sweep Protocol purges Byzantine nodes

### Merkle Vine Integration

All SBOMs are structured for future integration into The Great Gospel ledger. Each release's supply chain evidence forms a cryptographic link in the sovereignty chain.

### TPM-Backed Signing (Future)

**Roadmap:**
- Sign SBOM artifacts with CodeRalphie (TPM-backed Ed25519)
- Store signatures in The Great Gospel
- Enable operator-side verification without GitHub dependency

---

## Compliance & Audit Trail

### CycloneDX Standard

AetherCore SBOMs conform to **CycloneDX v1.4+** specification:
- NTIA minimum elements for SBOM
- Machine-readable JSON format
- Transitive dependency inclusion
- License and copyright information

### Regulatory Alignment

- ✅ **NIST SP 800-218** (Secure Software Development Framework)
- ✅ **EO 14028** (Cybersecurity Supply Chain Security)
- ✅ **OWASP Dependency-Check** integration ready

---

## Troubleshooting

### Common Issues

**Issue:** `cargo-audit` or `cargo-cyclonedx` not found  
**Solution:** The script auto-installs. If it fails, install manually:
```bash
cargo install cargo-audit cargo-cyclonedx b3sum --locked
```

**Issue:** npm workspace errors during SBOM generation  
**Solution:** This is expected in monorepos. The `--ignore-npm-errors` flag handles it.

**Issue:** BLAKE3 tool (`b3sum`) not available  
**Solution:** Script falls back to SHA-256. For production, install b3sum:
```bash
cargo install b3sum --locked
```

**Issue:** CI build fails with vulnerability  
**Solution:** 
1. Review the vulnerability details
2. Update the affected dependency
3. If no patch available, fork and patch or replace dependency
4. DO NOT override the check - vulnerabilities are adversaries

---

## Threat Model

### Attack Vectors Mitigated

1. **Dependency Confusion**: Lock files prevent version confusion
2. **Typosquatting**: SBOM review catches unexpected packages
3. **License Poisoning**: BLAKE3 hashing detects license tampering
4. **Supply Chain Injection**: Vulnerability scanning blocks compromised deps
5. **Version Rollback**: Lock file hashing prevents downgrade attacks

### Residual Risks

- **Zero-day vulnerabilities**: Not in advisory databases yet
- **Malicious maintainer**: Clean package becomes compromised
- **Build system compromise**: CI environment itself is attacked

**Mitigation:** Regular audits, minimal dependency philosophy, Aetheric Sweep Protocol.

---

## Operational Directives

### For Developers

**Before merging code:**
1. Run `./scripts/generate-sbom.sh` locally
2. Review any new dependencies in the SBOM
3. Ensure all vulnerabilities are resolved
4. Update lock files: `cargo update` / `npm update`

### For Release Engineers

**Before cutting a release:**
1. Verify CI passed supply chain checks
2. Download and archive SBOM artifacts
3. Sign release notes with reference to SBOM
4. Distribute SBOM with installer artifacts

### For Security Team

**Continuous monitoring:**
1. Subscribe to RUSTSEC advisories
2. Monitor npm security feed
3. Re-run audits on released versions
4. Initiate Aetheric Sweep if vulnerability found

---

## References

- [CycloneDX Specification](https://cyclonedx.org/specification/overview/)
- [RUSTSEC Advisory Database](https://rustsec.org/)
- [npm Advisory Database](https://github.com/advisories)
- [BLAKE3 Cryptographic Hash](https://github.com/BLAKE3-team/BLAKE3)
- [NIST SP 800-218 SSDF](https://csrc.nist.gov/publications/detail/sp/800-218/final)

---

## Glossary

- **SBOM**: Software Bill of Materials - inventory of software components
- **CycloneDX**: OWASP standard for SBOM representation
- **BLAKE3**: Cryptographic hash function (successor to BLAKE2)
- **Aetheric Sweep**: Protocol for purging compromised nodes
- **The Great Gospel**: System-wide sovereign revocation ledger
- **TRL-8**: Technology Readiness Level 8 (field deployment ready)
- **Byzantine Node**: Compromised or adversarial system component

---

**Status:** GLASS FORTRESS OPERATIONAL ✅  
**Next Review:** Quarterly or upon critical vulnerability disclosure

```
