#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-$ROOT_DIR/target/release/bundle/macos/AetherCore Commander.app}"
BIN_PATH="${BIN_PATH:-$APP_PATH/Contents/MacOS/tactical-glass-desktop}"
LOG_PATH="${LOG_PATH:-/tmp/aethercore-se-launch.log}"

if [[ ! -x "$BIN_PATH" ]]; then
  echo "ERROR: app binary not found or not executable: $BIN_PATH" >&2
  echo "Build first: pnpm --dir packages/dashboard tauri build --bundles app --ignore-version-mismatches" >&2
  exit 1
fi

echo "Stopping stale app/control-plane processes..."
pkill -9 -f "tactical-glass-desktop" || true
pkill -9 -f "local-control-plane/.*/services/gateway/dist/index.js" || true
pkill -9 -f "local-control-plane/.*/services/collaboration/dist/index.js" || true

echo "Launching app with Secure Enclave attestation forced ON..."
AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP=0 \
AETHERCORE_SEP_ALLOW_EPHEMERAL="${AETHERCORE_SEP_ALLOW_EPHEMERAL:-1}" \
"$BIN_PATH" >"$LOG_PATH" 2>&1 & disown

sleep 2
echo "Active process:"
pgrep -fl tactical-glass-desktop || true

echo
echo "== Recent Sentinel logs =="
if [[ -f "$LOG_PATH" ]]; then
  tail -n 120 "$LOG_PATH" | grep -Ei "SENTINEL|Secure Enclave|attestation|Hardware Optional|Boot verification|probe" || true
else
  echo "No launch log yet at $LOG_PATH"
fi

echo
echo "Full log: $LOG_PATH"
echo "Follow live: tail -f $LOG_PATH"
