# Operation Legal Shield: License Compliance Documentation

**Classification:** COSMIC  
**Purpose:** License compliance verification for AetherCore desktop releases  
**Mission:** Ensure legal provenance of all dependencies in the Truth Layer

---

## Overview

Operation Legal Shield is the comprehensive license compliance enforcement system for AetherCore. It provides automated auditing, cryptographic verification, and fail-visible reporting of all software dependencies included in desktop releases.

### Objectives

1. **Enforce License Whitelist**: Only permissive licenses (MIT, Apache-2.0, BSD-3-Clause) are authorized
2. **Block Copyleft Dependencies**: Automatically reject GPL, AGPL, and LGPL licensed packages
3. **Cryptographic License Invariant**: BLAKE3 hash all license files to detect drift
4. **SBOM Integration**: Generate comprehensive Software Bill of Materials (CycloneDX format)
5. **Fail-Visible Reporting**: Surface compliance status in Tactical Glass dashboard
6. **The Great Gospel Integration**: Record all compliance proofs in the distributed ledger

---

## Architecture

### Components

#### 1. cargo-deny Configuration (`deny.toml`)

The primary enforcement mechanism for Rust dependencies. Located at repository root.

**Key Features:**
- License whitelist enforcement
- Copyleft license blocking
- Security advisory checking
- Ban on ambiguous/unknown licenses
- Multiple version detection

**Approved Licenses:**
- MIT
- Apache-2.0 (with LLVM exception)
- BSD-3-Clause
- BSD-2-Clause
- ISC
- 0BSD
- Zlib
- Unicode-DFS-2016

**Denied Licenses:**
- GPL-2.0, GPL-3.0
- AGPL-3.0
- LGPL-2.1, LGPL-3.0
- MPL-2.0
- EPL-1.0, EPL-2.0
- CDDL-1.0
- EUPL-1.2

#### 2. Trust Mesh Ledger Integration

License compliance proofs are recorded in `crates/trust_mesh/src/ledger.rs`:

```rust
pub struct ComplianceProof {
    pub timestamp: u64,
    pub verifier_id: String,
    pub status: String, // "COMPLIANT", "NON_COMPLIANT", "UNVERIFIED"
    pub total_dependencies: u64,
    pub approved_licenses: u64,
    pub flagged_dependencies: Vec<String>,
    pub manifest_hash: String, // BLAKE3 hash of LICENSE_MANIFEST.txt
    pub notes: Option<String>,
}
```

#### 3. Tauri Backend Commands

License inventory accessible via Tauri commands in `packages/dashboard/src-tauri/src/commands.rs`:

- `get_license_inventory()`: Returns current compliance status
- `record_license_compliance()`: Records verification event in ledger

#### 4. SBOM Generation (`scripts/generate-sbom.sh`)

Comprehensive supply chain evidence generation:
- `tauri-sbom.json`: CycloneDX SBOM for Rust backend
- `frontend-sbom.json`: CycloneDX SBOM for TypeScript frontend
- `LICENSE_MANIFEST.txt`: BLAKE3 hashes of all dependency licenses
- `SUPPLY_CHAIN_MANIFEST.md`: Unified compliance summary

#### 5. CI/CD Integration

**CI Workflow (`.github/workflows/ci.yml`):**
- New `license-compliance` job runs on all PRs
- Blocks merge if non-compliant licenses detected
- Runs `cargo deny check` on all workspaces

**Desktop Release Workflow (`.github/workflows/desktop-release.yml`):**
- License compliance check before build
- SBOM artifacts attached to GitHub releases
- Compliance proof recorded in The Great Gospel

---

## Usage

### For Developers

#### Adding a New Dependency

Before adding any new dependency:

1. **Check the license:**
   ```bash
   # For Rust crates
   cargo license | grep <crate-name>
   
   # For npm packages
   npm info <package-name> license
   ```

2. **Verify it's on the whitelist:**
   - MIT, Apache-2.0, BSD-3-Clause: ✅ Approved
   - GPL, AGPL, LGPL: ❌ Blocked
   - Unknown/Ambiguous: ⚠️ Requires manual review

3. **Add the dependency and test:**
   ```bash
   # Add to Cargo.toml or package.json
   
   # Run compliance check
   cargo deny check licenses
   ```

4. **If blocked:**
   - Find an alternative with a permissive license
   - Or request CTO approval for exception (rare)

#### Running Local Compliance Check

```bash
# Quick check
cargo deny check licenses

# Full supply chain audit (includes SBOM generation)
./scripts/generate-sbom.sh

# Full release validation
./scripts/release-checklist.sh
```

### For Release Engineers

#### Pre-Release Checklist

1. **Run release checklist script:**
   ```bash
   ./scripts/release-checklist.sh
   ```

2. **Verify SBOM artifacts are generated:**
   ```bash
   ls -la sbom-artifacts/
   # Should contain:
   # - tauri-sbom.json
   # - frontend-sbom.json
   # - LICENSE_MANIFEST.txt
   # - SUPPLY_CHAIN_MANIFEST.md
   ```

3. **Check for compliance violations:**
   ```bash
   # Any output here means violations exist
   cargo deny check licenses | grep "DENIED"
   ```

4. **Record compliance proof:**
   - Compliance proof is automatically recorded during CI/CD
   - Manual recording available via Tauri command

#### Handling License Violations

If a violation is detected:

1. **Identify the violating dependency:**
   ```bash
   cargo deny check licenses
   # Note the crate name and license
   ```

2. **Find alternatives:**
   ```bash
   # Search for alternatives on crates.io
   # Filter by license: MIT, Apache-2.0
   ```

3. **Replace the dependency:**
   - Update `Cargo.toml` or `package.json`
   - Update imports/usage in code
   - Re-run compliance check

4. **If no alternative exists:**
   - Contact CTO with justification
   - Document in `deny.toml` as exception (requires approval)
   - Add manual review note to compliance proof

### For Operators (Tactical Glass)

#### Accessing Compliance HUD

The System Admin View in Tactical Glass provides real-time compliance status:

1. **Open Tactical Glass dashboard**
2. **Navigate to System Admin → Compliance HUD**
3. **View current license inventory:**
   - Total dependencies
   - Approved count
   - Flagged count
   - Individual license details

#### Interpreting Compliance Status

**Status Indicators:**
- 🟢 **COMPLIANT**: All dependencies approved, system cleared for operations
- 🟡 **UNVERIFIED**: License manifest not found or outdated
- 🔴 **NON_COMPLIANT**: Copyleft licenses detected, system quarantined

**Quarantine Protocol:**

If a node shows `NON_COMPLIANT` status:
1. The node is marked as "Quarantined: Legal Risk"
2. Blocked from kinetic C2 operations
3. Administrator alert generated
4. Aetheric Sweep protocol may purge node from mesh

---

## Cryptographic Verification

### LICENSE_MANIFEST.txt

Every license file is hashed using BLAKE3:

```
# Operation Glass Fortress: License Integrity Manifest
# Generated: 2026-01-04T21:57:00Z
# Hash Algorithm: BLAKE3

blake3:abc123...  node_modules/tokio/LICENSE
blake3:def456...  node_modules/serde/LICENSE-MIT
blake3:789xyz...  cargo-registry/src/blake3-1.5.0/LICENSE
```

### Verification Workflow

1. **License Drift Detection:**
   - Compare current hash with recorded hash
   - Mismatch indicates license terms changed
   - Trigger re-audit and manual review

2. **Supply Chain Integrity:**
   - SBOM artifacts signed and distributed with releases
   - Field operators can verify provenance
   - Hash chain links to The Great Gospel

---

## Configuration Reference

### deny.toml

```toml
[licenses]
unlicensed = "deny"
copyleft = "deny"
default = "deny"

allow = [
    "MIT",
    "Apache-2.0",
    "BSD-3-Clause",
    # ... see deny.toml for full list
]

deny = [
    "GPL-2.0",
    "GPL-3.0",
    "AGPL-3.0",
    # ... see deny.toml for full list
]
```

### Exceptions

To add a manual exception (requires CTO approval):

```toml
[[licenses.exceptions]]
name = "special-crate"
version = "1.0.0"
allow = ["GPL-3.0"]
reason = "Critical functionality, no alternative, CTO approved 2026-01-04"
```

---

## Troubleshooting

### Common Issues

#### 1. "License not found" error

**Cause:** Dependency doesn't include a LICENSE file

**Solution:**
```bash
# Check crate metadata
cargo metadata | jq '.packages[] | select(.name == "problematic-crate")'

# If license field exists but file missing, may be acceptable
# Add clarification to deny.toml
```

#### 2. "Ambiguous license" warning

**Cause:** Multiple licenses specified (e.g., "MIT OR Apache-2.0")

**Solution:** Usually acceptable if all options are on whitelist. Verify in deny.toml.

#### 3. CI failing but local check passes

**Cause:** Cached dependency tree mismatch

**Solution:**
```bash
cargo clean
rm -rf ~/.cargo/registry/cache
cargo update
cargo deny check licenses
```

---

## Threat Model

### Attack Vectors

1. **License Drift**: Dependency update changes license terms without notice
   - **Mitigation**: BLAKE3 hash verification in LICENSE_MANIFEST.txt

2. **Supply Chain Injection**: Malicious package with viral license clause
   - **Mitigation**: Automated cargo-deny blocking, CI gate enforcement

3. **Transitive Dependencies**: Copyleft dependency pulled in indirectly
   - **Mitigation**: cargo-deny checks entire dependency tree

4. **Build-time Compromise**: License check bypassed during build
   - **Mitigation**: Immutable CI configuration, compliance proof recording

---

## References

- [cargo-deny Documentation](https://embarkstudios.github.io/cargo-deny/)
- [CycloneDX SBOM Standard](https://cyclonedx.org/)
- [SPDX License List](https://spdx.org/licenses/)
- AetherCore Architectural Invariants (README.md)
- The Great Gospel Ledger (`crates/trust_mesh/src/ledger.rs`)

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-04 | 1.0 | AetherCore Team | Initial Operation Legal Shield implementation |

---

**Directive:** This compliance system is mandatory for all desktop releases. Any attempt to bypass or disable license checking is a security violation and will be logged in The Great Gospel.

**Aetheric Sweep Protocol:** Dependencies with non-compliant licenses are Byzantine nodes and must be purged from the mesh. No exceptions without explicit CTO authorization.

**Status:** LEGAL SHIELD ACTIVE ✅
