#!/bin/bash
# preflight-linux.sh
# Linux preflight checks for AetherCore development environment
# Exit codes: 0 = all checks passed, 1 = one or more checks failed

set -e

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

# Detect Linux distribution
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="$ID"
    DISTRO_LIKE="$ID_LIKE"
  elif [ -f /etc/redhat-release ]; then
    DISTRO_ID="rhel"
  elif [ -f /etc/arch-release ]; then
    DISTRO_ID="arch"
  else
    DISTRO_ID="unknown"
  fi
}

# Print install commands for current distro
print_install_commands() {
  echo ""
  echo "Install required dependencies with:"
  echo ""
  
  case "$DISTRO_ID" in
    ubuntu|debian)
      echo "sudo apt-get update && sudo apt-get install -y \\"
      echo "  libwebkit2gtk-4.1-dev \\"
      echo "  libgtk-3-dev \\"
      echo "  libssl-dev \\"
      echo "  pkg-config \\"
      echo "  libayatana-appindicator3-dev \\"
      echo "  librsvg2-dev \\"
      echo "  build-essential"
      ;;
    fedora|rhel|centos)
      echo "sudo dnf install -y \\"
      echo "  webkit2gtk4.1-devel \\"
      echo "  gtk3-devel \\"
      echo "  openssl-devel \\"
      echo "  pkgconfig \\"
      echo "  libappindicator-gtk3-devel \\"
      echo "  librsvg2-devel \\"
      echo "  gcc \\"
      echo "  gcc-c++ \\"
      echo "  make"
      ;;
    arch|manjaro)
      echo "sudo pacman -S --needed \\"
      echo "  webkit2gtk-4.1 \\"
      echo "  gtk3 \\"
      echo "  openssl \\"
      echo "  pkg-config \\"
      echo "  libappindicator-gtk3 \\"
      echo "  librsvg \\"
      echo "  base-devel"
      ;;
    *)
      echo "Unknown distribution. Please install the following:"
      echo "  - WebKit2GTK 4.1"
      echo "  - GTK3"
      echo "  - OpenSSL"
      echo "  - pkg-config"
      echo "  - libayatana-appindicator3"
      echo "  - librsvg2"
      echo "  - build essentials (gcc, g++, make)"
      ;;
  esac
  echo ""
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

# Check for required library using pkg-config
check_lib() {
  local lib=$1
  local min_version=$2
  
  if pkg-config --exists "$lib" 2>/dev/null; then
    local version=$(pkg-config --modversion "$lib" 2>/dev/null || echo "unknown")
    success "$lib is installed (version: $version)"
    return 0
  else
    error "$lib library not found"
    return 1
  fi
}

echo "=========================================="
echo "AetherCore Linux Preflight Checks"
echo "=========================================="
echo ""

# Detect distribution
detect_distro
echo "Detected distribution: $DISTRO_ID"
echo ""

# Check required tools
echo "Checking required tools..."
echo ""

check_tool "rustc" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
check_tool "cargo" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
check_tool "node" "Install from https://nodejs.org/ or use nvm"
check_tool "pnpm" "corepack enable"
check_tool "pkg-config" "(included in system dependencies)"
check_tool "git" "Install via your package manager"

echo ""
echo "Checking required libraries..."
echo ""

# Check for pkg-config first
if ! command -v pkg-config >/dev/null 2>&1; then
  error "pkg-config not found - cannot check library dependencies"
  print_install_commands
else
  check_lib "webkit2gtk-4.1"
  check_lib "gtk+-3.0"
  check_lib "openssl"
  
  # Optional: check for libsoup-3.0 if needed
  if pkg-config --exists "libsoup-3.0" 2>/dev/null; then
    success "libsoup-3.0 is installed (optional)"
  fi
fi

echo ""
echo "=========================================="
echo "Preflight Summary"
echo "=========================================="

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}FAILED: $ERRORS error(s) found${NC}"
  print_install_commands
  exit 1
else
  echo -e "${GREEN}PASSED: All preflight checks successful${NC}"
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Note: $WARNINGS warning(s) found${NC}"
  fi
  exit 0
fi
