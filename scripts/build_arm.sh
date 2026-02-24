#!/bin/bash
# scripts/build_arm.sh
# Builds AetherCore Edge binaries for ARM64 (aarch64-unknown-linux-gnu)
# Target: Raspberry Pi 64-bit and similar ARM64 devices
# Static linking with musl for maximum portability

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TARGET="aarch64-unknown-linux-gnu"
BINARY_NAME="edge"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_PATH="${PROJECT_ROOT}/crates/edge"
OUTPUT_DIR="${PROJECT_ROOT}/target/${TARGET}/release"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AetherCore Edge ARM64 Build Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Target: ${YELLOW}${TARGET}${NC}"
echo -e "Crate: ${YELLOW}aethercore-edge${NC}"
echo -e "Source: ${YELLOW}${CRATE_PATH}${NC}"
echo ""

# Check if cross is installed
if ! command -v cross &> /dev/null; then
    echo -e "${YELLOW}Installing cross for cross-compilation...${NC}"
    cargo install cross --git https://github.com/cross-rs/cross
fi

# Ensure target is added
echo -e "${YELLOW}Adding rust target ${TARGET}...${NC}"
rustup target add ${TARGET} || true

# Build the edge library for ARM64
echo -e "${GREEN}Building aethercore-edge for ${TARGET}...${NC}"
cd "${CRATE_PATH}"

# Use cross for cross-compilation
# Features:
# - Release mode with optimizations
# - Cross-platform compatible
cross build \
    --target ${TARGET} \
    --release \
    --lib

# Check if build was successful
if [ ! -f "${OUTPUT_DIR}/libaethercore_edge.rlib" ]; then
    echo -e "${RED}Build failed: Library not found${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build successful!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Library location: ${YELLOW}${OUTPUT_DIR}/libaethercore_edge.rlib${NC}"
echo ""

# Show output directory contents
echo -e "${YELLOW}ARM64 build artifacts:${NC}"
ls -lh "${OUTPUT_DIR}" | grep aethercore || echo "No artifacts found"

echo ""
echo -e "${GREEN}ARM64 build complete!${NC}"
echo -e "${YELLOW}Note:${NC} This is a library crate. To create a binary, add a main.rs or bin target."
echo ""
