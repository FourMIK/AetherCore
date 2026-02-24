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
│  [1] Dependency Pinning     (Cargo.lock, pnpm-lock.yaml)
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
    pnpm add -g @cyclonedx/cyclonedx-npm
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
   b3sum pnpm-lock.yaml
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
