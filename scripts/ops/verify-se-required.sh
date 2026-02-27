#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-$ROOT_DIR/target/release/bundle/macos/AetherCore Commander.app}"
BIN_PATH="${BIN_PATH:-$APP_PATH/Contents/MacOS/tactical-glass-desktop}"
LOG_PATH="${LOG_PATH:-/tmp/aethercore-se-required.log}"
WAIT_SECS="${WAIT_SECS:-8}"

CFG1="$HOME/Library/Application Support/com.aethercore.commander/runtime-config.json"
CFG2="$HOME/Library/Application Support/com.aethercore.commander.dev/runtime-config.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 1
fi

if [[ ! -x "$BIN_PATH" ]]; then
  echo "ERROR: app binary not found or not executable: $BIN_PATH" >&2
  echo "Build first: pnpm --dir packages/dashboard tauri build --bundles app --ignore-version-mismatches" >&2
  exit 1
fi

BACKUP_DIR="$(mktemp -d /tmp/aethercore-secfg.XXXXXX)"
restore_configs() {
  for cfg in "$CFG1" "$CFG2"; do
    base="$(basename "$cfg")"
    backup="$BACKUP_DIR/$base"
    if [[ -f "$backup" ]]; then
      cp "$backup" "$cfg"
    fi
  done
  rm -rf "$BACKUP_DIR"
}
trap restore_configs EXIT

echo "Backing up runtime configs..."
for cfg in "$CFG1" "$CFG2"; do
  if [[ -f "$cfg" ]]; then
    cp "$cfg" "$BACKUP_DIR/$(basename "$cfg")"
  fi
done

echo "Forcing TPM policy to required in runtime configs..."
for cfg in "$CFG1" "$CFG2"; do
  [[ -f "$cfg" ]] || continue
  tmp="$(mktemp)"
  jq '.tpm_policy.mode="required" | .tpm_policy.enforce_hardware=true' "$cfg" >"$tmp"
  mv "$tmp" "$cfg"
done

echo "Stopping stale app/control-plane processes..."
pkill -9 -f "tactical-glass-desktop" || true
pkill -9 -f "local-control-plane/.*/services/gateway/dist/index.js" || true
pkill -9 -f "local-control-plane/.*/services/collaboration/dist/index.js" || true

echo "Launching app with required hardware attestation..."
AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP=0 \
AETHERCORE_SEP_ALLOW_EPHEMERAL=1 \
"$BIN_PATH" >"$LOG_PATH" 2>&1 & disown

sleep "$WAIT_SECS"

if pgrep -f "tactical-glass-desktop" >/dev/null 2>&1; then
  echo "PASS: app is still running with required hardware attestation."
  echo "This confirms Secure Enclave attestation passed at startup."
else
  echo "FAIL: app exited under required hardware attestation."
  echo "Tail of log ($LOG_PATH):"
  tail -n 200 "$LOG_PATH" || true
  exit 2
fi

echo "Runtime configs restored from backup."
echo "Log file: $LOG_PATH"
