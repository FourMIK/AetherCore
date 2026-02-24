#!/bin/bash
# preflight-macos.sh
# macOS preflight checks for AetherCore development environment
# Exit codes: 0 = all checks passed, 1 = one or more checks failed

ERRORS=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

error() {
  echo -e "${RED}ERROR: $1${NC}" >&2
  ERRORS=$((ERRORS + 1))
}

warning() {
  echo -e "${YELLOW}WARNING: $1${NC}" >&2
  WARNINGS=$((WARNINGS + 1))
}

success() {
  echo -e "${GREEN}OK: $1${NC}"
}

# Check for required tools
check_tool() {
  local tool=$1
  local install_cmd=$2
  
  if command -v "$tool" >/dev/null 2>&1; then
    success "$tool is installed"
    return 0
  else
    error "$tool is not installed"
    if [ -n "$install_cmd" ]; then
      echo "  Install with: $install_cmd"
    fi
    return 1
  fi
}

echo "=========================================="
echo "AetherCore macOS Preflight Checks"
echo "=========================================="
echo ""

# Check for Xcode Command Line Tools
echo "Checking Xcode Command Line Tools..."
if xcode-select -p >/dev/null 2>&1; then
  success "Xcode Command Line Tools are installed"
else
  error "Xcode Command Line Tools are not installed"
  echo "  Install with: xcode-select --install"
fi

echo ""
echo "Checking required tools..."
echo ""

# Check Rust
check_tool "rustc" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
check_tool "cargo" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"

# Check Node.js
check_tool "node" "Install from https://nodejs.org/ or use nvm"

# Check pnpm
check_tool "pnpm" "corepack enable"

# Check for Homebrew
echo ""
echo "Checking Homebrew..."
if command -v brew >/dev/null 2>&1; then
  success "Homebrew is installed"
else
  warning "Homebrew is not installed (recommended for dependencies)"
  echo "  Install Homebrew from: https://brew.sh/"
  echo "  Run: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi

echo ""
echo "=========================================="
echo "Preflight Summary"
echo "=========================================="

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}FAILED: $ERRORS error(s) found${NC}"
  echo ""
  echo "Required steps to fix errors:"
  echo "1. Install Xcode Command Line Tools if missing"
  echo "2. Install Rust toolchain from https://rustup.rs/"
  echo "3. Install Node.js 20.x from https://nodejs.org/"
  echo "4. Enable pnpm with: corepack enable"
  echo ""
  exit 1
else
  echo -e "${GREEN}PASSED: All preflight checks successful${NC}"
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Note: $WARNINGS warning(s) found${NC}"
  fi
  exit 0
fi
