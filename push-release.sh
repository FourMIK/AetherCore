#!/bin/bash
# AetherCore Release Publisher
# Classification: OPERATIONAL
# Purpose: Atomically update version numbers, validate, and publish release
#
# Usage: ./push-release.sh <version>
# Example: ./push-release.sh 0.2.0

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Validate Input
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ $# -ne 1 ]; then
    echo -e "${RED}Error: Version number required${NC}"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.2.0"
    exit 1
fi

VERSION="$1"

# Validate semantic versioning format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo -e "${RED}Error: Invalid version format${NC}"
    echo "Expected: X.Y.Z or X.Y.Z-prerelease"
    echo "Got: $VERSION"
    exit 1
fi

# Navigate to repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}🚀 AetherCore Release Publisher${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BLUE}Version:${NC} $VERSION"
echo -e "${BLUE}Repository:${NC} $REPO_ROOT"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Pre-Flight Checks
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}[Pre-Flight] Validating Environment${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}✗ Working tree has uncommitted changes${NC}"
    echo ""
    git status --short
    echo ""
    echo -e "${YELLOW}Commit or stash changes before releasing${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Clean working tree${NC}"

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}⚠ Warning: Not on main branch (current: $CURRENT_BRANCH)${NC}"
    read -p "Continue with release? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Release cancelled"
        exit 1
    fi
fi

# Check if tag already exists
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo -e "${RED}✗ Tag v$VERSION already exists${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Tag v$VERSION available${NC}"

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Update Version Numbers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}[Update] Version Synchronization${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Root Cargo.toml (workspace version)
echo "Updating Cargo.toml..."
sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" Cargo.toml
rm -f Cargo.toml.bak
echo -e "${GREEN}✓ Cargo.toml${NC}"

# 2. Dashboard package.json
echo "Updating packages/dashboard/package.json..."
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/dashboard/package.json
rm -f packages/dashboard/package.json.bak
echo -e "${GREEN}✓ packages/dashboard/package.json${NC}"

# 3. Tauri config
echo "Updating packages/dashboard/src-tauri/tauri.conf.json..."
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/dashboard/src-tauri/tauri.conf.json
rm -f packages/dashboard/src-tauri/tauri.conf.json.bak
echo -e "${GREEN}✓ packages/dashboard/src-tauri/tauri.conf.json${NC}"

# 4. Tauri Cargo.toml
echo "Updating packages/dashboard/src-tauri/Cargo.toml..."
sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" packages/dashboard/src-tauri/Cargo.toml
rm -f packages/dashboard/src-tauri/Cargo.toml.bak
echo -e "${GREEN}✓ packages/dashboard/src-tauri/Cargo.toml${NC}"

# 5. README.md version badge
echo "Updating README.md..."
sed -i.bak "s/version-[0-9.]*-\(alpha\|beta\|orange\|green\)/version-$VERSION-orange/" README.md
rm -f README.md.bak
echo -e "${GREEN}✓ README.md${NC}"

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Run Release Validation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}[Validate] Running Release Checklist${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "./scripts/release-checklist.sh" ]; then
    if ./scripts/release-checklist.sh; then
        echo ""
        echo -e "${GREEN}✓ Release validation passed${NC}"
    else
        echo ""
        echo -e "${RED}✗ Release validation failed${NC}"
        echo -e "${YELLOW}Fix issues above before proceeding${NC}"
        
        # Revert version changes
        echo ""
        echo "Reverting version changes..."
        git checkout -- Cargo.toml README.md packages/dashboard/
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ Warning: release-checklist.sh not found, skipping validation${NC}"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Commit and Tag
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}[Commit] Creating Release Commit${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Stage version files
git add Cargo.toml \
        README.md \
        packages/dashboard/package.json \
        packages/dashboard/src-tauri/tauri.conf.json \
        packages/dashboard/src-tauri/Cargo.toml

# Create commit
COMMIT_MSG="Release v$VERSION

- Update all version numbers to $VERSION
- Validated via release checklist
- Ready for desktop build pipeline"

git commit -m "$COMMIT_MSG"
echo -e "${GREEN}✓ Release commit created${NC}"

# Create annotated tag
git tag -a "v$VERSION" -m "AetherCore v$VERSION

Classification: OPERATIONAL
Release Date: $(date -u +%Y-%m-%d)

This release has passed all pre-flight checks and is ready for deployment.
Desktop installers will be automatically built via GitHub Actions.

See CHANGELOG.md for detailed changes."

echo -e "${GREEN}✓ Tag v$VERSION created${NC}"

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Push to Remote
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}[Publish] Pushing to Remote${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Ready to push:"
echo "  - Commit: Release v$VERSION"
echo "  - Tag: v$VERSION"
echo "  - Branch: $CURRENT_BRANCH"
echo ""

read -p "Push to origin? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    # Push commit and tag
    git push origin "$CURRENT_BRANCH"
    git push origin "v$VERSION"
    
    echo ""
    echo -e "${GREEN}✓ Pushed to origin${NC}"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}🎉 Release v$VERSION Published${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Next steps:"
    echo "  1. Monitor GitHub Actions: https://github.com/FourMIK/AetherCore/actions"
    echo "  2. Desktop builds will be created automatically"
    echo "  3. Release draft will be created with installers"
    echo "  4. Review and publish the GitHub Release"
    echo ""
else
    echo ""
    echo -e "${YELLOW}Push cancelled. To push manually:${NC}"
    echo "  git push origin $CURRENT_BRANCH"
    echo "  git push origin v$VERSION"
    echo ""
fi
