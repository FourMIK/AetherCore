#!/bin/bash
# 4MIK AetherCore // Release Automation: Operation Beacon
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
    echo "Usage: ./push-release.sh <VERSION_NUMBER> (e.g., 1.0.0)"
    exit 1
fi

echo "[1/4] Synchronizing AetherCore Version $VERSION..."
# Update package.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/dashboard/package.json
# Update tauri.conf.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/dashboard/src-tauri/tauri.conf.json
# Update src-tauri Cargo.toml
sed -i "0,/version = \".*\"/s//version = \"$VERSION\"/" packages/dashboard/src-tauri/Cargo.toml

echo "[2/4] Verifying Monorepo Continuity..."
./verify-monorepo.sh

echo "[3/4] Committing Release Materia..."
git add .
git commit -m "chore: Release v$VERSION - Operation Beacon"
git tag -a "v$VERSION" -m "AetherCore V$VERSION Gold Master Release"

echo "[4/4] Pushing to Sovereign Repository..."
git push origin main
git push origin "v$VERSION"

echo "=================================================="
echo "   RELEASE PUSHED. MONITORING WORKFLOW..."
echo "=================================================="
gh run watch
