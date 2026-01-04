#!/bin/bash

# Desktop Integration Test Runner
# Runs both Rust and TypeScript integration tests for the Tactical Glass desktop app

set -e

echo "=========================================="
echo "Desktop Integration Test Suite"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
RUST_EXIT=0
TS_EXIT=0

echo "📦 Building Rust integration tests..."
cargo build -p aethercore-integration-tests 2>&1 | grep -E "(Compiling|Finished|error)" || true
echo ""

echo "🦀 Running Rust integration tests..."
echo "----------------------------------------"
if cargo test -p aethercore-integration-tests 2>&1; then
    echo -e "${GREEN}✓ Rust integration tests PASSED${NC}"
else
    RUST_EXIT=$?
    echo -e "${RED}✗ Rust integration tests FAILED${NC}"
fi
echo ""

echo "📦 Installing TypeScript test dependencies..."
cd packages/dashboard
npm list vitest > /dev/null 2>&1 || npm install --save-dev vitest @vitest/ui happy-dom > /dev/null 2>&1
cd ../..
echo ""

echo "📝 Running TypeScript integration tests..."
echo "----------------------------------------"
cd packages/dashboard
if npm test 2>&1; then
    echo -e "${GREEN}✓ TypeScript integration tests PASSED${NC}"
else
    TS_EXIT=$?
    echo -e "${RED}✗ TypeScript integration tests FAILED${NC}"
fi
cd ../..
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="

if [ $RUST_EXIT -eq 0 ] && [ $TS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ All integration tests PASSED${NC}"
    echo ""
    echo "Coverage:"
    echo "  - Rust: 18 tests (desktop + red cell)"
    echo "  - TypeScript: 26 tests"
    echo "  - Total: 44 tests"
    echo ""
    echo "Tested boundaries:"
    echo "  - FFI/Tauri command invocations"
    echo "  - Ed25519 signature verification"
    echo "  - BLAKE3 hashing"
    echo "  - Merkle Vine stream integrity"
    echo "  - Identity management"
    echo "  - Audit event generation"
    exit 0
else
    echo -e "${RED}✗ Some integration tests FAILED${NC}"
    [ $RUST_EXIT -ne 0 ] && echo -e "  ${RED}✗ Rust tests failed (exit code: $RUST_EXIT)${NC}"
    [ $TS_EXIT -ne 0 ] && echo -e "  ${RED}✗ TypeScript tests failed (exit code: $TS_EXIT)${NC}"
    exit 1
fi
