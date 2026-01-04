#!/bin/bash
# Operation Ironclad: Desktop Release Checklist
# Clearance: COSMIC
# Purpose: Comprehensive pre-release validation for desktop builds
# 
# This script verifies ALL requirements before allowing a desktop release:
# - Documentation completeness
# - Code signing configuration
# - Test suite execution
# - SBOM generation
# - Version consistency
# - Lock file integrity

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛡️  Operation Ironclad: Desktop Release Checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Classification: COSMIC"
echo "Mission: TRL-8 Desktop Application Release Validation"
echo ""

# Navigate to repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "📂 Repository Root: $REPO_ROOT"
echo ""

# Track overall status
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

# Array to store failure messages
declare -a FAILURES
declare -a WARNINGS

# Helper function to report check status
check_status() {
    local check_name="$1"
    local status="$2"
    local message="$3"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $check_name"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    elif [ "$status" = "FAIL" ]; then
        echo -e "${RED}✗${NC} $check_name"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        FAILURES+=("$check_name: $message")
    elif [ "$status" = "WARN" ]; then
        echo -e "${YELLOW}⚠${NC} $check_name"
        WARNING_CHECKS=$((WARNING_CHECKS + 1))
        WARNINGS+=("$check_name: $message")
    fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 1: Environment Validation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 [Phase 1] Environment Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check required tools
if command -v cargo &> /dev/null; then
    check_status "Rust toolchain installed" "PASS"
else
    check_status "Rust toolchain installed" "FAIL" "cargo not found"
fi

if command -v npm &> /dev/null; then
    check_status "Node.js/npm installed" "PASS"
else
    check_status "Node.js/npm installed" "FAIL" "npm not found"
fi

if command -v git &> /dev/null; then
    check_status "Git installed" "PASS"
else
    check_status "Git installed" "FAIL" "git not found"
fi

# Check if we're on a clean git state
if [ -n "$(git status --porcelain)" ]; then
    check_status "Clean git working tree" "WARN" "Uncommitted changes present"
else
    check_status "Clean git working tree" "PASS"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 2: Documentation Verification
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 [Phase 2] Documentation Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "./scripts/verify-docs.sh" ]; then
    if bash ./scripts/verify-docs.sh > /tmp/verify-docs-output.log 2>&1; then
        check_status "Documentation completeness check" "PASS"
    else
        check_status "Documentation completeness check" "FAIL" "See /tmp/verify-docs-output.log"
        echo "Documentation verification output:"
        cat /tmp/verify-docs-output.log | tail -20
        echo ""
    fi
else
    check_status "Documentation completeness check" "FAIL" "verify-docs.sh not found"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 3: Code Signing Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 [Phase 3] Code Signing Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# In CI environment, check for signing secrets
if [ -n "$CI" ]; then
    # macOS signing
    if [ "$(uname)" = "Darwin" ]; then
        if [ -n "$APPLE_CERTIFICATE" ] && [ -n "$APPLE_SIGNING_IDENTITY" ]; then
            check_status "macOS code signing configured" "PASS"
        else
            check_status "macOS code signing configured" "FAIL" "APPLE_CERTIFICATE or APPLE_SIGNING_IDENTITY not set"
        fi
    fi
    
    # Windows signing
    if [ "$(uname -s | cut -c 1-5)" = "MINGW" ] || [ "$(uname -s | cut -c 1-10)" = "MINGW32_NT" ] || [ "$(uname -s | cut -c 1-10)" = "MINGW64_NT" ]; then
        if [ -n "$WINDOWS_CERTIFICATE" ]; then
            check_status "Windows code signing configured" "PASS"
        else
            check_status "Windows code signing configured" "FAIL" "WINDOWS_CERTIFICATE not set"
        fi
    fi
else
    # Local development - just warn
    check_status "Code signing configuration" "WARN" "Not in CI environment, skipping signing check"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 4: Test Suite Execution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 [Phase 4] Test Suite Execution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run Rust tests
echo "🦀 Running Rust test suite..."
if cargo test --workspace --no-fail-fast 2>&1 | tee /tmp/rust-test-output.log; then
    check_status "Rust test suite" "PASS"
else
    check_status "Rust test suite" "FAIL" "Tests failed - see /tmp/rust-test-output.log"
    echo ""
    echo "Failed Rust tests:"
    grep -A 5 "FAILED" /tmp/rust-test-output.log || echo "See full log at /tmp/rust-test-output.log"
    echo ""
fi

# Run TypeScript type checking (minimal test for now)
echo "📦 Running TypeScript type checks..."
cd "$REPO_ROOT/packages/dashboard"
if npm run test:types 2>&1 | tee /tmp/ts-test-output.log; then
    check_status "TypeScript type checking" "PASS"
else
    check_status "TypeScript type checking" "FAIL" "Type errors found - see /tmp/ts-test-output.log"
fi

cd "$REPO_ROOT"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 5: Supply Chain Verification
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛡️  [Phase 5] Supply Chain Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "./scripts/generate-sbom.sh" ]; then
    if bash ./scripts/generate-sbom.sh > /tmp/sbom-output.log 2>&1; then
        check_status "SBOM generation" "PASS"
        
        # Verify SBOM artifacts exist
        if [ -f "sbom-artifacts/tauri-sbom.json" ] || [ -f "sbom-artifacts/tauri-sbom-metadata.json" ]; then
            check_status "Rust SBOM artifact present" "PASS"
        else
            check_status "Rust SBOM artifact present" "FAIL" "tauri-sbom.json not found"
        fi
        
        if [ -f "sbom-artifacts/frontend-sbom.json" ]; then
            check_status "Frontend SBOM artifact present" "PASS"
        else
            check_status "Frontend SBOM artifact present" "FAIL" "frontend-sbom.json not found"
        fi
        
        if [ -f "sbom-artifacts/LICENSE_MANIFEST.txt" ]; then
            check_status "License manifest present" "PASS"
        else
            check_status "License manifest present" "FAIL" "LICENSE_MANIFEST.txt not found"
        fi
        
        if [ -f "sbom-artifacts/SUPPLY_CHAIN_MANIFEST.md" ]; then
            check_status "Supply chain manifest present" "PASS"
        else
            check_status "Supply chain manifest present" "FAIL" "SUPPLY_CHAIN_MANIFEST.md not found"
        fi
    else
        check_status "SBOM generation" "FAIL" "generate-sbom.sh failed - see /tmp/sbom-output.log"
        echo ""
        echo "SBOM generation error:"
        tail -30 /tmp/sbom-output.log
        echo ""
    fi
else
    check_status "SBOM generation" "FAIL" "generate-sbom.sh not found"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 6: Version Consistency
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔢 [Phase 6] Version Consistency"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Extract versions from different files
PACKAGE_JSON_VERSION=$(jq -r '.version' package.json 2>/dev/null || echo "N/A")
TAURI_CARGO_VERSION=$(grep -m 1 '^version' packages/dashboard/src-tauri/Cargo.toml | sed 's/version = "\(.*\)"/\1/' || echo "N/A")
TAURI_CONF_VERSION=$(jq -r '.version' packages/dashboard/src-tauri/tauri.conf.json 2>/dev/null || echo "N/A")

echo "Root package.json version: $PACKAGE_JSON_VERSION"
echo "Tauri Cargo.toml version: $TAURI_CARGO_VERSION"
echo "Tauri config version: $TAURI_CONF_VERSION"
echo ""

# Check if all versions match
if [ "$PACKAGE_JSON_VERSION" = "$TAURI_CARGO_VERSION" ] && [ "$PACKAGE_JSON_VERSION" = "$TAURI_CONF_VERSION" ]; then
    check_status "Version consistency across manifests" "PASS"
else
    check_status "Version consistency across manifests" "FAIL" "Version mismatch detected"
fi

# Check if we're on a release tag
if [ -n "$CI" ]; then
    if [ -n "$GITHUB_REF_NAME" ]; then
        GIT_TAG="${GITHUB_REF_NAME#v}"
        if [ "$GIT_TAG" = "$PACKAGE_JSON_VERSION" ]; then
            check_status "Git tag matches version" "PASS"
        else
            check_status "Git tag matches version" "FAIL" "Tag $GITHUB_REF_NAME doesn't match version $PACKAGE_JSON_VERSION"
        fi
    fi
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 7: Lock File Integrity
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔒 [Phase 7] Lock File Integrity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Cargo.lock exists and is up to date
if [ -f "Cargo.lock" ]; then
    check_status "Cargo.lock exists" "PASS"
    
    # Try to verify it's up to date (will fail if out of sync)
    if cargo tree > /dev/null 2>&1; then
        check_status "Cargo.lock is up to date" "PASS"
    else
        check_status "Cargo.lock is up to date" "FAIL" "Run 'cargo update' to sync"
    fi
else
    check_status "Cargo.lock exists" "FAIL" "Cargo.lock not found"
fi

# Check package-lock.json exists
if [ -f "package-lock.json" ]; then
    check_status "package-lock.json exists" "PASS"
else
    check_status "package-lock.json exists" "FAIL" "package-lock.json not found"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 8: Build Artifacts Check
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  [Phase 8] Build Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if Tauri config is valid
if [ -f "packages/dashboard/src-tauri/tauri.conf.json" ]; then
    if jq empty packages/dashboard/src-tauri/tauri.conf.json 2>/dev/null; then
        check_status "Tauri configuration valid JSON" "PASS"
    else
        check_status "Tauri configuration valid JSON" "FAIL" "tauri.conf.json is not valid JSON"
    fi
else
    check_status "Tauri configuration exists" "FAIL" "tauri.conf.json not found"
fi

# Verify critical Rust crates compile
echo "🦀 Verifying Rust compilation..."
if cargo check --workspace > /tmp/cargo-check-output.log 2>&1; then
    check_status "Rust workspace compilation" "PASS"
else
    check_status "Rust workspace compilation" "FAIL" "See /tmp/cargo-check-output.log"
    echo ""
    echo "Compilation errors:"
    tail -30 /tmp/cargo-check-output.log
    echo ""
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Final Report
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Operation Ironclad: Final Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total Checks:   $TOTAL_CHECKS"
echo -e "${GREEN}Passed:         $PASSED_CHECKS${NC}"
echo -e "${RED}Failed:         $FAILED_CHECKS${NC}"
echo -e "${YELLOW}Warnings:       $WARNING_CHECKS${NC}"
echo ""

if [ $FAILED_CHECKS -gt 0 ]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ RELEASE BLOCKED${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "The following critical issues must be resolved:"
    echo ""
    for failure in "${FAILURES[@]}"; do
        echo -e "${RED}  ✗${NC} $failure"
    done
    echo ""
    echo "Directive: We do not ship incomplete or vulnerable releases."
    echo "Action Required: Resolve all failures before proceeding."
    echo ""
    exit 1
fi

if [ $WARNING_CHECKS -gt 0 ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠ WARNINGS DETECTED${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "The following warnings were detected:"
    echo ""
    for warning in "${WARNINGS[@]}"; do
        echo -e "${YELLOW}  ⚠${NC} $warning"
    done
    echo ""
    echo "These warnings do not block the release but should be reviewed."
    echo ""
fi

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ RELEASE VALIDATION PASSED${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "All critical checks passed. Desktop release may proceed."
echo ""
echo "Next Steps:"
echo "  1. Review SBOM artifacts in sbom-artifacts/"
echo "  2. Verify code signing will be applied during build"
echo "  3. Trigger desktop release workflow or run 'npm run tauri:build'"
echo ""
echo "Status: IRONCLAD SECURED ✅"
echo ""

exit 0
