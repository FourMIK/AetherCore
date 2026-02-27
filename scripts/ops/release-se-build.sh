#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READINESS_SCRIPT="$ROOT_DIR/scripts/ops/check-macos-se-readiness.sh"
VERIFY_SCRIPT="$ROOT_DIR/scripts/ops/verify-se-required.sh"
PROFILE_ARG="${1:-}"

if [[ ! -x "$READINESS_SCRIPT" ]]; then
  echo "ERROR: readiness script missing: $READINESS_SCRIPT" >&2
  exit 1
fi

if [[ ! -x "$VERIFY_SCRIPT" ]]; then
  echo "ERROR: verify script missing: $VERIFY_SCRIPT" >&2
  exit 1
fi

echo "== Step 1/4: Secure Enclave readiness check =="
if [[ -n "$PROFILE_ARG" ]]; then
  READINESS_OUTPUT="$("$READINESS_SCRIPT" "$PROFILE_ARG" 2>&1)" || {
    echo "$READINESS_OUTPUT"
    exit 1
  }
else
  READINESS_OUTPUT="$("$READINESS_SCRIPT" 2>&1)" || {
    echo "$READINESS_OUTPUT"
    exit 1
  }
fi
echo "$READINESS_OUTPUT"

TEAM_ID="$(echo "$READINESS_OUTPUT" | awk -F': ' '/^Team ID: /{print $2; exit}')"
IDENTITY_SHA1="$(echo "$READINESS_OUTPUT" | awk -F': ' '/^Team-matching Identity SHA1: /{print $2; exit}')"
IDENTITY_NAME="$(echo "$READINESS_OUTPUT" | awk -F': ' '/^Team-matching Identity: /{print $2; exit}')"

if [[ -z "$TEAM_ID" || "$TEAM_ID" == "<missing>" ]]; then
  echo "ERROR: unable to resolve Team ID from readiness output" >&2
  exit 1
fi

SIGNING_IDENTITY="$IDENTITY_SHA1"
if [[ -z "$SIGNING_IDENTITY" || "$SIGNING_IDENTITY" == "<missing>" ]]; then
  SIGNING_IDENTITY="$IDENTITY_NAME"
fi

if [[ -z "$SIGNING_IDENTITY" || "$SIGNING_IDENTITY" == "<missing>" ]]; then
  echo "ERROR: unable to resolve signing identity from readiness output" >&2
  exit 1
fi

echo
echo "== Step 2/4: Signed release bundle build =="
export APPLE_TEAM_ID="$TEAM_ID"
export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
cd "$ROOT_DIR"
pnpm --dir packages/dashboard tauri build --bundles app --ignore-version-mismatches

APP_BIN="$ROOT_DIR/target/release/bundle/macos/AetherCore Commander.app/Contents/MacOS/tactical-glass-desktop"
if [[ ! -x "$APP_BIN" ]]; then
  echo "ERROR: expected app binary missing after build: $APP_BIN" >&2
  exit 1
fi

echo
echo "== Step 3/4: Direct Secure Enclave probe =="
PROBE_LOG="/tmp/aethercore-se-probe-release.log"
NONCE="$(openssl rand -hex 32)"
if AETHERCORE_SEP_ALLOW_EPHEMERAL="${AETHERCORE_SEP_ALLOW_EPHEMERAL:-1}" \
  "$APP_BIN" --sentinel-se-probe "$NONCE" >"$PROBE_LOG" 2>&1; then
  echo "PASS: direct probe exited 0"
else
  exit_code=$?
  echo "FAIL: direct probe exited $exit_code"
  echo "Probe log: $PROBE_LOG"
  tail -n 120 "$PROBE_LOG" || true
  exit "$exit_code"
fi

echo
echo "== Step 4/4: Required-mode startup verification =="
AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP=0 \
AETHERCORE_SEP_ALLOW_EPHEMERAL="${AETHERCORE_SEP_ALLOW_EPHEMERAL:-1}" \
"$VERIFY_SCRIPT"

echo
echo "DONE: release SE build + verification completed successfully"
echo "Team: $APPLE_TEAM_ID"
echo "Signing identity: $APPLE_SIGNING_IDENTITY"

