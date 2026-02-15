#!/bin/bash
###############################################################################
# Build Warhead Binary
# Creates self-contained executable for ARM64 deployment
###############################################################################

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "${SCRIPT_DIR}"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         WARHEAD BUILD - CodeRalphie ARM64 Binary               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "[Build] Step 1: Installing dependencies..."
pnpm install --frozen-lockfile

echo "[Build] Step 2: Building TypeScript..."
pnpm run build

echo "[Build] Step 3: Creating self-contained binary with pkg..."
# Note: pkg may not work in all environments. For production, run on appropriate build machine.
if command -v pkg &> /dev/null || [ -x "./node_modules/.bin/pkg" ]; then
    echo "[Build] Using pkg to create ARM64 binary..."
    npx pkg dist/index.js --targets node18-linux-arm64 --output dist/coderalphie-linux-arm64 --compress GZip
    
    if [ -f "dist/coderalphie-linux-arm64" ]; then
        chmod +x dist/coderalphie-linux-arm64
        echo "[Build] ✓ Binary created: dist/coderalphie-linux-arm64"
        ls -lh dist/coderalphie-linux-arm64
    else
        echo "[Build] ERROR: Binary creation failed"
        exit 1
    fi
else
    echo "[Build] WARNING: pkg not available. Creating placeholder binary..."
    echo "[Build] In production, this should be built on an appropriate build server."
    
    # Create a placeholder script that shows what would be packaged
    cat > dist/coderalphie-linux-arm64 << 'EOF'
#!/bin/bash
# PLACEHOLDER: This is a development placeholder
# In production, this would be a self-contained Node.js binary created with pkg
echo "ERROR: This is a placeholder binary. Build on production build server with pkg support."
exit 1
EOF
    chmod +x dist/coderalphie-linux-arm64
    echo "[Build] ⚠️  Placeholder binary created (not functional)"
fi

echo ""
echo "[Build] Step 4: Copying payloads to dashboard resources..."
pnpm run package:payloads

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                 WARHEAD BUILD COMPLETE                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Artifacts:"
echo "  • Binary:     dist/coderalphie-linux-arm64"
echo "  • Installer:  install.sh"
echo "  • Dashboard:  ../../packages/dashboard/src-tauri/resources/payloads/"
echo ""
