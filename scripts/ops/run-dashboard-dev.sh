#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Stopping stale desktop/control-plane processes..."
pkill -9 -f "tactical-glass-desktop" || true
pkill -9 -f "local-control-plane/.*/services/gateway/dist/index.js" || true
pkill -9 -f "local-control-plane/.*/services/collaboration/dist/index.js" || true

echo "Launching dashboard in tauri dev (source-of-truth frontend)..."
cd "$ROOT_DIR/packages/dashboard"
AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP="${AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP:-1}" \
AETHERCORE_SEP_ALLOW_EPHEMERAL="${AETHERCORE_SEP_ALLOW_EPHEMERAL:-1}" \
pnpm tauri dev
