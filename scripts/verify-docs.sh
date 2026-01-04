#!/bin/bash
# verify-docs.sh
# Documentation Completeness Verification Script
# Ensures all required documentation exists and is properly formatted

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Documentation Completeness Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Track failures
FAILURES=0

# Required documentation files for desktop release
REQUIRED_DOCS=(
    "INSTALLATION.md"
    "DEPLOYMENT_DESKTOP.md"
    "SECURITY.md"
    "PROVENANCE.md"
    "README.md"
    "docs/SUPPLY_CHAIN_SECURITY.md"
)

# Minimum file sizes (in bytes) to ensure docs aren't empty stubs
MIN_SIZES=(
    10000  # INSTALLATION.md
    8000   # DEPLOYMENT_DESKTOP.md
    15000  # SECURITY.md
    15000  # PROVENANCE.md
    3000   # README.md
    8000   # docs/SUPPLY_CHAIN_SECURITY.md
)

echo "[1/4] Checking for required documentation files..."
echo ""

for i in "${!REQUIRED_DOCS[@]}"; do
    DOC="${REQUIRED_DOCS[$i]}"
    MIN_SIZE="${MIN_SIZES[$i]}"
    
    if [ -f "$DOC" ]; then
        # Check file size
        FILE_SIZE=$(stat -f%z "$DOC" 2>/dev/null || stat -c%s "$DOC" 2>/dev/null)
        
        if [ "$FILE_SIZE" -ge "$MIN_SIZE" ]; then
            echo "✓ $DOC (${FILE_SIZE} bytes)"
        else
            echo "✗ $DOC exists but is too small (${FILE_SIZE} bytes, minimum ${MIN_SIZE} bytes)"
            FAILURES=$((FAILURES + 1))
        fi
    else
        echo "✗ $DOC is missing"
        FAILURES=$((FAILURES + 1))
    fi
done

echo ""
echo "[2/4] Verifying documentation cross-references..."
echo ""

# Check that key documents reference each other
check_reference() {
    local file=$1
    local reference=$2
    local reference_file=$3
    
    if grep -q "$reference" "$file" 2>/dev/null; then
        echo "✓ $file references $reference_file"
        return 0
    else
        echo "⚠ $file should reference $reference_file"
        # Warning only, not a failure
        return 0
    fi
}

# INSTALLATION.md should reference SECURITY.md, PROVENANCE.md, DEPLOYMENT_DESKTOP.md
if [ -f "INSTALLATION.md" ]; then
    check_reference "INSTALLATION.md" "SECURITY.md" "SECURITY.md"
    check_reference "INSTALLATION.md" "PROVENANCE.md" "PROVENANCE.md"
    check_reference "INSTALLATION.md" "DEPLOYMENT_DESKTOP.md" "DEPLOYMENT_DESKTOP.md"
fi

# SECURITY.md should reference PROVENANCE.md, INSTALLATION.md
if [ -f "SECURITY.md" ]; then
    check_reference "SECURITY.md" "PROVENANCE.md" "PROVENANCE.md"
    check_reference "SECURITY.md" "INSTALLATION.md" "INSTALLATION.md"
fi

# PROVENANCE.md should reference SECURITY.md, SUPPLY_CHAIN_SECURITY.md
if [ -f "PROVENANCE.md" ]; then
    check_reference "PROVENANCE.md" "SECURITY.md" "SECURITY.md"
    check_reference "PROVENANCE.md" "SUPPLY_CHAIN_SECURITY.md" "SUPPLY_CHAIN_SECURITY.md"
fi

echo ""
echo "[3/4] Checking documentation formatting..."
echo ""

# Check for proper markdown headers
for DOC in "${REQUIRED_DOCS[@]}"; do
    if [ -f "$DOC" ]; then
        # Check for title (# heading)
        if head -n 20 "$DOC" | grep -q "^# "; then
            echo "✓ $DOC has proper title"
        else
            echo "⚠ $DOC may be missing title (# heading)"
            # Warning only
        fi
        
        # Check for table of contents in longer docs
        if [ "$DOC" = "INSTALLATION.md" ] || [ "$DOC" = "SECURITY.md" ] || [ "$DOC" = "PROVENANCE.md" ]; then
            if grep -qi "table of contents" "$DOC"; then
                echo "✓ $DOC has table of contents"
            else
                echo "⚠ $DOC may be missing table of contents"
                # Warning only
            fi
        fi
    fi
done

echo ""
echo "[4/4] Verifying documentation metadata..."
echo ""

# Check for required metadata in key docs
check_metadata() {
    local file=$1
    local pattern=$2
    local description=$3
    
    if grep -qi "$pattern" "$file" 2>/dev/null; then
        echo "✓ $file contains $description"
        return 0
    else
        echo "⚠ $file may be missing $description"
        return 0
    fi
}

if [ -f "SECURITY.md" ]; then
    check_metadata "SECURITY.md" "Last Updated" "last updated date"
    check_metadata "SECURITY.md" "Classification" "classification level"
fi

if [ -f "PROVENANCE.md" ]; then
    check_metadata "PROVENANCE.md" "Last Updated" "last updated date"
fi

if [ -f "INSTALLATION.md" ]; then
    check_metadata "INSTALLATION.md" "Last Updated" "last updated date"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILURES -eq 0 ]; then
    echo "✅ Documentation verification PASSED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "All required documentation is present and meets minimum requirements."
    exit 0
else
    echo "❌ Documentation verification FAILED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Found $FAILURES critical issue(s)."
    echo ""
    echo "Required actions:"
    echo "  1. Ensure all required documentation files exist"
    echo "  2. Verify documentation is complete (meets minimum size)"
    echo "  3. Add proper cross-references between documents"
    echo ""
    echo "See https://github.com/FourMIK/AetherCore/blob/main/CONTRIBUTING.md for documentation guidelines."
    exit 1
fi
