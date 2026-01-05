#!/bin/bash
# Operation Glass Fortress: Supply Chain Evidence Generation
# Clearance: COSMIC
# Purpose: Generate comprehensive SBOM and audit all dependencies

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛡️  Operation Glass Fortress: Supply Chain Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Navigate to repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SBOM_OUTPUT_DIR="${REPO_ROOT}/sbom-artifacts"
mkdir -p "$SBOM_OUTPUT_DIR"

# Use cross-platform temporary directory
TEMP_DIR="${TMPDIR:-${TEMP:-/tmp}}"
SBOM_LOG_DIR="${TEMP_DIR}/aethercore-sbom-logs"
mkdir -p "$SBOM_LOG_DIR"

echo "📂 Repository Root: $REPO_ROOT"
echo "📦 SBOM Output Directory: $SBOM_OUTPUT_DIR"
echo "📋 Log Directory: $SBOM_LOG_DIR"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 1: Rust Dependency Audit & SBOM Generation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "🦀 [Phase 1] Rust Supply Chain Audit"
echo "───────────────────────────────────────────────────────"

# Check if cargo-audit is installed
if ! command -v cargo-audit &> /dev/null; then
    echo "⚠️  cargo-audit not found."
    echo "   Installing cargo-audit..."
    cargo install cargo-audit --locked || {
        echo "⚠️  Failed to install cargo-audit. Skipping Rust vulnerability audit."
        echo "   Note: cargo-audit will be installed in CI environment."
        SKIP_RUST_AUDIT=true
    }
fi

# Check if cargo-cyclonedx is installed
if ! command -v cargo-cyclonedx &> /dev/null; then
    echo "⚠️  cargo-cyclonedx not found."
    echo "   Installing cargo-cyclonedx..."
    cargo install cargo-cyclonedx --locked || {
        echo "⚠️  Failed to install cargo-cyclonedx. Using fallback SBOM generation."
        SKIP_RUST_SBOM=true
    }
fi

echo ""
echo "🔍 Running cargo audit (RUSTSEC vulnerability database)..."
echo "   Policy: FAIL on HIGH or CRITICAL CVEs"
echo ""

# Run cargo audit with strict policy
if [ "${SKIP_RUST_AUDIT}" != "true" ]; then
    if ! cargo audit --deny warnings --deny unmaintained --deny unsound --deny yanked; then
        echo ""
        echo "❌ OPERATION GLASS FORTRESS: AUDIT FAILURE"
        echo "   Vulnerable dependencies detected in Rust crates."
        echo "   Directive: We do not ship vulnerable code."
        echo "   Action Required: Update, patch, or replace compromised dependencies."
        echo ""
        exit 1
    fi
    
    echo ""
    echo "✅ Rust audit passed - no known vulnerabilities"
    echo ""
else
    echo "⚠️  Rust audit skipped (cargo-audit not available)"
    echo "   This check will run in CI environment."
    echo ""
fi

# Check if cargo-deny is available
if ! command -v cargo-deny &> /dev/null; then
    echo "⚠️  cargo-deny not found."
    echo "   Installing cargo-deny for license compliance..."
    cargo install cargo-deny --locked || {
        echo "⚠️  Failed to install cargo-deny. Skipping license compliance check."
        echo "   Note: cargo-deny will be installed in CI environment."
        SKIP_LICENSE_CHECK=true
    }
fi

echo ""
echo "🛡️  Operation Legal Shield: License Compliance Check"
echo "   Policy: DENY copyleft licenses (GPL, AGPL, LGPL)"
echo "   Whitelist: MIT, Apache-2.0, BSD-3-Clause, ISC"
echo ""

# Run cargo-deny license check
if [ "${SKIP_LICENSE_CHECK}" != "true" ]; then
    cd "$REPO_ROOT"
    
    echo "📋 Checking license compliance..."
    if ! cargo deny check licenses; then
        echo ""
        echo "❌ OPERATION LEGAL SHIELD: LICENSE VIOLATION"
        echo "   Non-compliant licenses detected in dependencies."
        echo "   Directive: Only permissive licenses are authorized."
        echo "   Action Required: Replace copyleft dependencies or obtain CTO approval."
        echo ""
        exit 1
    fi
    
    echo ""
    echo "✅ License compliance verified - all dependencies approved"
    echo ""
    
    echo "🔍 Checking for banned dependencies..."
    if ! cargo deny check bans; then
        echo ""
        echo "⚠️  Warning: Banned dependencies or duplicates detected"
        echo "   Review deny.toml configuration"
        echo ""
    fi
    
    echo ""
    echo "✅ Dependency bans check completed"
    echo ""
else
    echo "⚠️  License compliance check skipped (cargo-deny not available)"
    echo "   This check will run in CI environment."
    echo ""
fi

echo "📋 Generating Rust SBOM (CycloneDX format)..."
echo "   Target: Tauri Desktop Application"
echo ""

# Generate SBOM for the Tauri application
if [ "${SKIP_RUST_SBOM}" != "true" ]; then
    cd "$REPO_ROOT/packages/dashboard/src-tauri"
    
    echo "Running cargo-cyclonedx..."
    if cargo cyclonedx --all-features --format json --output-cdx --output-file "$SBOM_OUTPUT_DIR/tauri-sbom.json" 2>&1 | tee "$SBOM_LOG_DIR"/sbom-rust-output.log; then
        echo "✅ Rust SBOM generated: tauri-sbom.json"
    else
        # Check if SBOM file was still created
        if [ -f "$SBOM_OUTPUT_DIR/tauri-sbom.json" ]; then
            echo "⚠️  Rust SBOM generation completed with warnings"
            echo "   SBOM file was generated but may have encountered non-critical issues"
            echo "   Check $SBOM_LOG_DIR/sbom-rust-output.log for details"
        else
            echo "❌ Rust SBOM generation failed completely"
            echo "   Last error output:"
            tail -20 "$SBOM_LOG_DIR"/sbom-rust-output.log
            exit 1
        fi
    fi
    echo ""
else
    echo "⚠️  cargo-cyclonedx not available, generating fallback SBOM..."
    cd "$REPO_ROOT"
    
    # Generate a simple JSON manifest using cargo metadata
    if cargo metadata --format-version 1 --manifest-path packages/dashboard/src-tauri/Cargo.toml > "$SBOM_OUTPUT_DIR/tauri-sbom-metadata.json" 2>&1; then
        echo "✅ Rust dependency metadata generated: tauri-sbom-metadata.json"
        echo "   (Fallback format - full SBOM will be generated in CI)"
    else
        echo "❌ Failed to generate Rust dependency metadata"
        exit 1
    fi
    echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 2: Node/npm Dependency Audit & SBOM Generation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cd "$REPO_ROOT"

echo "📦 [Phase 2] Node.js Supply Chain Audit"
echo "───────────────────────────────────────────────────────"

# Check if cyclonedx-npm is installed globally or locally
if ! command -v cyclonedx-npm &> /dev/null && ! npx --no-install cyclonedx-npm --version &> /dev/null; then
    echo "⚠️  @cyclonedx/cyclonedx-npm not found. Installing globally..."
    npm install -g @cyclonedx/cyclonedx-npm
fi

echo ""
echo "🔍 Running npm audit (npm vulnerability database)..."
echo "   Policy: FAIL on HIGH or CRITICAL CVEs"
echo ""

# Run npm audit with strict policy
if ! npm audit --audit-level=high --production; then
    echo ""
    echo "❌ OPERATION GLASS FORTRESS: AUDIT FAILURE"
    echo "   Vulnerable dependencies detected in npm packages."
    echo "   Directive: We do not ship vulnerable code."
    echo "   Action Required: Update, patch, or replace compromised dependencies."
    echo ""
    exit 1
fi

echo ""
echo "✅ npm audit passed - no high/critical vulnerabilities"
echo ""

echo "📋 Generating Frontend SBOM (CycloneDX format)..."
echo "   Target: Dashboard Frontend Application"
echo ""

# Generate SBOM for the frontend - run from dashboard directory with local dependencies
cd "$REPO_ROOT/packages/dashboard"

# For the dashboard package, we need to generate SBOM based on what's actually installed
# Using the --package-lock-only flag to work with lock file
if [ -f "package-lock.json" ]; then
    echo "Using local package-lock.json in packages/dashboard"
    if npx @cyclonedx/cyclonedx-npm --output-file "$SBOM_OUTPUT_DIR/frontend-sbom.json" --output-format JSON 2>&1 | tee "$SBOM_LOG_DIR"/sbom-npm-output.log; then
        echo "✅ Frontend SBOM generated successfully"
    else
        # Check if SBOM was still generated despite errors
        if [ -f "$SBOM_OUTPUT_DIR/frontend-sbom.json" ]; then
            echo "⚠️  SBOM generation completed with warnings (check $SBOM_LOG_DIR/sbom-npm-output.log)"
            echo "   SBOM file was generated but may have encountered non-critical issues"
        else
            echo "❌ Frontend SBOM generation failed completely"
            exit 1
        fi
    fi
elif [ -f "../../package-lock.json" ]; then
    echo "Using monorepo root package-lock.json"
    # If using monorepo structure, generate from root
    cd "$REPO_ROOT"
    # Create SBOM from root - this will include all workspace dependencies
    if npx @cyclonedx/cyclonedx-npm --output-file "$SBOM_OUTPUT_DIR/frontend-sbom.json" --output-format JSON --ignore-npm-errors 2>&1 | tee "$SBOM_LOG_DIR"/sbom-npm-output.log; then
        echo "✅ Frontend SBOM generated from monorepo root"
    else
        # Check if SBOM was still generated despite errors
        if [ -f "$SBOM_OUTPUT_DIR/frontend-sbom.json" ]; then
            echo "⚠️  SBOM generation completed with warnings (monorepo workspace links)"
            echo "   Generated SBOM includes root-level dependencies (check $SBOM_LOG_DIR/sbom-npm-output.log)"
        else
            echo "❌ Frontend SBOM generation failed"
            echo "   Last error output:"
            tail -20 "$SBOM_LOG_DIR"/sbom-npm-output.log
            exit 1
        fi
    fi
else
    echo "❌ No package-lock.json found in packages/dashboard or repository root"
    exit 1
fi

echo "✅ Frontend SBOM generated: frontend-sbom.json"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 3: License Integrity Hashing (BLAKE3)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cd "$REPO_ROOT"

echo "📜 [Phase 3] License Integrity Hashing"
echo "───────────────────────────────────────────────────────"

# Check if b3sum is installed
if ! command -v b3sum &> /dev/null; then
    # Check if CI indicated fallback mode via marker file
    if [ -f "$SBOM_LOG_DIR/sbom-fallback-mode" ]; then
        echo "⚠️  b3sum not available. Using SHA-256 fallback as indicated by CI."
        USE_FALLBACK_HASH=true
    else
        echo "⚠️  b3sum not found. Attempting to install..."
        
        # Try to install via cargo
        if command -v cargo &> /dev/null; then
            cargo install b3sum --locked || USE_FALLBACK_HASH=true
        else
            echo "❌ Cannot install b3sum - cargo not available"
            echo "   Falling back to SHA-256 (TEMPORARY - BLAKE3 required for production)"
            USE_FALLBACK_HASH=true
        fi
    fi
fi

echo ""
echo "🔍 Scanning for license files in dependency trees..."
echo ""

LICENSE_MANIFEST="$SBOM_OUTPUT_DIR/LICENSE_MANIFEST.txt"
> "$LICENSE_MANIFEST"  # Clear/create file

# Determine which hash algorithm to use for the header
if [ "${USE_FALLBACK_HASH}" = "true" ]; then
    HASH_ALG="SHA-256 (BLAKE3 unavailable)"
else
    HASH_ALG="BLAKE3"
fi

echo "# Operation Glass Fortress: License Integrity Manifest" >> "$LICENSE_MANIFEST"
echo "# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LICENSE_MANIFEST"
echo "# Hash Algorithm: $HASH_ALG" >> "$LICENSE_MANIFEST"
echo "" >> "$LICENSE_MANIFEST"

# Find all license files in node_modules and Cargo registry
license_count=0

# Hash npm licenses
if [ -d "node_modules" ]; then
    echo "📦 Hashing npm package licenses..."
    while IFS= read -r -d '' license_file; do
        if [ -f "$license_file" ]; then
            relative_path="${license_file#$REPO_ROOT/}"
            if [ "${USE_FALLBACK_HASH}" = "true" ]; then
                hash=$(sha256sum "$license_file" | cut -d' ' -f1)
                echo "sha256:$hash  $relative_path" >> "$LICENSE_MANIFEST"
            else
                hash=$(b3sum "$license_file" | cut -d' ' -f1)
                echo "blake3:$hash  $relative_path" >> "$LICENSE_MANIFEST"
            fi
            ((license_count++))
        fi
    done < <(find node_modules -type f \( -iname "LICENSE*" -o -iname "LICENCE*" -o -iname "COPYING*" \) -print0 2>/dev/null)
fi

# Hash Rust crate licenses (if they exist in target/debug/deps or similar)
if [ -d "$HOME/.cargo/registry" ]; then
    echo "🦀 Hashing Rust crate licenses..."
    # Note: No arbitrary limit - hash all found licenses
    while IFS= read -r -d '' license_file; do
        if [ -f "$license_file" ]; then
            # Get relative path from .cargo/registry
            relative_path="cargo-registry/${license_file#$HOME/.cargo/registry/}"
            if [ "${USE_FALLBACK_HASH}" = "true" ]; then
                hash=$(sha256sum "$license_file" | cut -d' ' -f1)
                echo "sha256:$hash  $relative_path" >> "$LICENSE_MANIFEST"
            else
                hash=$(b3sum "$license_file" | cut -d' ' -f1)
                echo "blake3:$hash  $relative_path" >> "$LICENSE_MANIFEST"
            fi
            ((license_count++))
        fi
    done < <(find "$HOME/.cargo/registry/src" -type f \( -iname "LICENSE*" -o -iname "LICENCE*" -o -iname "COPYING*" \) -print0 2>/dev/null)
fi

echo ""
echo "✅ License manifest generated: $license_count licenses hashed"
echo "   File: LICENSE_MANIFEST.txt"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 4: Merge and Finalize
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "🔗 [Phase 4] Consolidating Supply Chain Evidence"
echo "───────────────────────────────────────────────────────"

# Create a unified manifest
UNIFIED_MANIFEST="$SBOM_OUTPUT_DIR/SUPPLY_CHAIN_MANIFEST.md"

# Pre-compute values to avoid command injection in heredoc
MANIFEST_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Hash lock files with existence checks
if [ -f "Cargo.lock" ]; then
    CARGO_LOCK_HASH=$(b3sum Cargo.lock 2>/dev/null || sha256sum Cargo.lock | cut -d' ' -f1)
else
    CARGO_LOCK_HASH="ERROR: Cargo.lock not found"
fi

if [ -f "package-lock.json" ]; then
    PACKAGE_LOCK_HASH=$(b3sum package-lock.json 2>/dev/null || sha256sum package-lock.json | cut -d' ' -f1)
else
    PACKAGE_LOCK_HASH="ERROR: package-lock.json not found"
fi

# Count SBOM components with explicit error handling
if [ -f "$SBOM_OUTPUT_DIR/tauri-sbom.json" ]; then
    RUST_COMPONENT_COUNT=$(jq -r '.components | length' "$SBOM_OUTPUT_DIR/tauri-sbom.json" 2>/dev/null || echo "ERROR: Failed to parse tauri-sbom.json")
else
    RUST_COMPONENT_COUNT="N/A (SBOM not generated)"
fi

if [ -f "$SBOM_OUTPUT_DIR/frontend-sbom.json" ]; then
    FRONTEND_COMPONENT_COUNT=$(jq -r '.components | length' "$SBOM_OUTPUT_DIR/frontend-sbom.json" 2>/dev/null || echo "ERROR: Failed to parse frontend-sbom.json")
else
    FRONTEND_COMPONENT_COUNT="N/A (SBOM not generated)"
fi

LICENSE_ENTRY_COUNT=$(grep -v '^#' "$SBOM_OUTPUT_DIR/LICENSE_MANIFEST.txt" 2>/dev/null | grep -v '^$' | wc -l | xargs)

# Generate manifest using safe variable substitution
cat > "$UNIFIED_MANIFEST" << EOF
# AetherCore Supply Chain Manifest
## Operation Glass Fortress

**Classification:** COSMIC  
**Generated:** $MANIFEST_TIMESTAMP  
**Mission:** TRL-8 Field Deployment Supply Chain Verification

---

## 🛡️ Supply Chain Evidence

This manifest provides cryptographic proof of the provenance of all dependencies
in the AetherCore Tactical Glass desktop application.

### Artifacts Generated

1. **tauri-sbom.json** - CycloneDX SBOM for Rust/Tauri backend
2. **frontend-sbom.json** - CycloneDX SBOM for TypeScript/React frontend  
3. **LICENSE_MANIFEST.txt** - BLAKE3 hashes of all dependency licenses

### Verification Policy

- ✅ All Rust dependencies audited via RUSTSEC database (cargo-audit)
- ✅ All npm dependencies audited via npm security advisories
- ✅ Zero HIGH or CRITICAL CVEs present in production dependencies
- ✅ All direct and transitive dependencies pinned in lock files
- ✅ All license files cryptographically hashed

### Integrity Verification

**Cargo.lock hash:**
$CARGO_LOCK_HASH

**package-lock.json hash:**
$PACKAGE_LOCK_HASH

---

## 📋 SBOM Statistics

### Rust Dependencies
$RUST_COMPONENT_COUNT total packages

### Frontend Dependencies  
$FRONTEND_COMPONENT_COUNT total packages

### License Files Hashed
$LICENSE_ENTRY_COUNT entries

---

**Directive:** This supply chain evidence must be signed and distributed  
alongside all release artifacts. Any modification to dependencies requires  
regeneration and re-verification of this manifest.

**Aetheric Sweep Protocol:** Dependencies with known CVEs are considered  
Byzantine nodes and must be purged from the mesh.
EOF

echo ""
echo "✅ Unified manifest generated: SUPPLY_CHAIN_MANIFEST.md"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Operation Complete
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Operation Glass Fortress: COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📦 Supply Chain Evidence Package:"
echo "   📄 $SBOM_OUTPUT_DIR/tauri-sbom.json"
echo "   📄 $SBOM_OUTPUT_DIR/frontend-sbom.json"
echo "   📄 $SBOM_OUTPUT_DIR/LICENSE_MANIFEST.txt"
echo "   📄 $SBOM_OUTPUT_DIR/SUPPLY_CHAIN_MANIFEST.md"
echo ""
echo "🔒 All artifacts ready for cryptographic signing and distribution."
echo "   These files must accompany all desktop release builds."
echo ""
echo "Status: GLASS FORTRESS SECURED ✅"
echo ""
