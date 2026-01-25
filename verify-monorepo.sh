#!/bin/bash
# Monorepo structure and rules verification script

set -e

echo "==================================="
echo "AetherCore MonoRepo Verification"
echo "==================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILED=0

# Check directory structure
echo "1. Checking directory structure..."
REQUIRED_DIRS=("crates" "services" "packages" "legacy")
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "  ${GREEN}✓${NC} /$dir exists"
    else
        echo -e "  ${RED}✗${NC} /$dir is missing"
        FAILED=1
    fi
done
echo ""

# Check Rust workspace
echo "2. Checking Rust workspace..."
if [ -f "Cargo.toml" ]; then
    echo -e "  ${GREEN}✓${NC} Cargo.toml exists"
    
    # Verify all crates are in workspace
    RUST_CRATES=("core" "crypto" "identity" "domain" "mesh" "stream" "edge" "isr" "rf" "radio" "trust_mesh" "h2-domain")
    for crate in "${RUST_CRATES[@]}"; do
        if [ -d "crates/$crate" ]; then
            echo -e "  ${GREEN}✓${NC} crates/$crate exists"
        else
            echo -e "  ${RED}✗${NC} crates/$crate is missing"
            FAILED=1
        fi
    done
    
    # Note: Build verification is handled by the rust-workspace CI job
    # which installs all necessary system dependencies for GTK/Tauri.
    # This script only verifies structure, not buildability.
else
    echo -e "  ${RED}✗${NC} Cargo.toml is missing"
    FAILED=1
fi
echo ""

# Check Node.js workspace
echo "3. Checking Node.js workspace..."
if [ -f "package.json" ]; then
    echo -e "  ${GREEN}✓${NC} package.json exists"
    
    # Verify services
    SERVICES=("gateway" "auth" "fleet" "h2-ingest" "operator")
    for service in "${SERVICES[@]}"; do
        if [ -d "services/$service" ]; then
            echo -e "  ${GREEN}✓${NC} services/$service exists"
        else
            echo -e "  ${RED}✗${NC} services/$service is missing"
            FAILED=1
        fi
    done
    
    # Verify packages
    PACKAGES=("dashboard" "h2-glass" "canonical-schema" "shared")
    for package in "${PACKAGES[@]}"; do
        if [ -d "packages/$package" ]; then
            echo -e "  ${GREEN}✓${NC} packages/$package exists"
        else
            echo -e "  ${RED}✗${NC} packages/$package is missing"
            FAILED=1
        fi
    done
else
    echo -e "  ${RED}✗${NC} package.json is missing"
    FAILED=1
fi
echo ""

# Check legacy directory rules
echo "4. Checking legacy directory rules..."
if [ -f "legacy/README.md" ]; then
    echo -e "  ${GREEN}✓${NC} legacy/README.md exists"
else
    echo -e "  ${YELLOW}!${NC} legacy/README.md is missing (should document rules)"
fi

# Check for illegal legacy imports (basic check)
echo "  Checking for illegal legacy imports..."
ALLOWED_LEGACY_REFS=("crates/h2-domain" "packages/h2-glass")
ILLEGAL_IMPORTS=0

# Search for 'legacy' references in source files (excluding allowed paths and this script)
for file in $(find crates packages services -name "*.rs" -o -name "*.ts" 2>/dev/null | grep -v "h2-domain" | grep -v "h2-glass" | head -100); do
    if grep -q "legacy" "$file" 2>/dev/null; then
        echo -e "  ${YELLOW}!${NC} Potential legacy reference in $file"
        ILLEGAL_IMPORTS=$((ILLEGAL_IMPORTS + 1))
    fi
done

if [ $ILLEGAL_IMPORTS -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} No obvious illegal legacy imports found"
else
    echo -e "  ${YELLOW}!${NC} Found $ILLEGAL_IMPORTS potential legacy references (review required)"
fi
echo ""

# Check for documentation
echo "5. Checking documentation..."
REQUIRED_DOCS=("README.md" "MONOREPO_RULES.md")
for doc in "${REQUIRED_DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo -e "  ${GREEN}✓${NC} $doc exists"
    else
        echo -e "  ${YELLOW}!${NC} $doc is missing"
    fi
done
echo ""

# Summary
echo "==================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "==================================="
    exit 0
else
    echo -e "${RED}✗ Some checks failed!${NC}"
    echo "==================================="
    exit 1
fi
