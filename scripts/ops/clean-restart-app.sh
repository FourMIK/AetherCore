#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-$ROOT_DIR/target/release/bundle/macos/AetherCore Commander.app}"
BIN_PATH="${BIN_PATH:-$APP_PATH/Contents/MacOS/tactical-glass-desktop}"
LOG_PATH="${LOG_PATH:-/tmp/aethercore-launch.log}"
C2_MOCK_DIR="${C2_MOCK_DIR:-$ROOT_DIR/infra/docker/c2-router-mock}"
C2_MOCK_ENTRY="${C2_MOCK_ENTRY:-$C2_MOCK_DIR/server.js}"
C2_MOCK_LOG="${C2_MOCK_LOG:-/tmp/aethercore-c2-router-mock.log}"
C2_MOCK_PORT="${C2_MOCK_PORT:-50051}"
AUTO_START_C2_MOCK="${AUTO_START_C2_MOCK:-1}"
LAUNCH_SENTINEL_SKIP="${AETHERCORE_LAUNCH_SENTINEL_SKIP:-1}"
LAUNCH_SEP_ALLOW_EPHEMERAL="${AETHERCORE_LAUNCH_SEP_ALLOW_EPHEMERAL:-1}"
LAUNCH_MODE="${AETHERCORE_LAUNCH_MODE:-auto}" # auto|binary|open
STACK_WAIT_SECS="${AETHERCORE_STACK_WAIT_SECS:-12}"
FORCE_OPTIONAL_TRUST_POLICY="${AETHERCORE_FORCE_OPTIONAL_TRUST_POLICY:-1}"
ALLOW_DEV_STACK_FALLBACK="${AETHERCORE_ALLOW_DEV_STACK_FALLBACK:-1}"
SKIP_APP_RESTART=0

if [[ ! -x "$BIN_PATH" ]]; then
  if [[ "$ALLOW_DEV_STACK_FALLBACK" != "1" ]]; then
    echo "ERROR: app binary not found or not executable: $BIN_PATH" >&2
    exit 1
  fi

  if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    SKIP_APP_RESTART=1
    echo "WARN: app binary missing at $BIN_PATH"
    if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "      Reusing existing local stack listeners on :3000 and :8080 (dev mode fallback)."
    else
      echo "      Reusing existing gateway listener on :3000 (dev mode fallback)."
      echo "      Collaboration listener :8080 is not active yet."
    fi
  else
    echo "ERROR: app binary not found or not executable: $BIN_PATH" >&2
    echo "       No active gateway listener detected on :3000 for dev fallback." >&2
    echo "       Start dev app in another terminal with:" >&2
    echo "       ./scripts/ops/run-dashboard-dev.sh" >&2
    exit 1
  fi
fi

start_mock_c2_backend() {
  if [[ "$AUTO_START_C2_MOCK" != "1" ]]; then
    echo "Skipping mock C2 backend startup (AUTO_START_C2_MOCK=$AUTO_START_C2_MOCK)"
    return 0
  fi

  if lsof -nP -iTCP:"$C2_MOCK_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Mock C2 backend already listening on :$C2_MOCK_PORT"
    return 0
  fi

  if [[ ! -d "$C2_MOCK_DIR" ]]; then
    echo "WARN: mock C2 backend directory missing: $C2_MOCK_DIR"
    return 0
  fi

  if [[ ! -f "$C2_MOCK_ENTRY" ]]; then
    echo "WARN: mock C2 backend entrypoint missing: $C2_MOCK_ENTRY"
    echo "      Skipping mock C2 startup."
    return 0
  fi

  echo "Ensuring mock C2 backend dependencies are installed..."
  (
    cd "$C2_MOCK_DIR"
    npm install >/dev/null
  )

  echo "Starting mock C2 backend on :$C2_MOCK_PORT ..."
  (
    cd "$C2_MOCK_DIR"
    pkill -f "$C2_MOCK_ENTRY" || true
    nohup node "$C2_MOCK_ENTRY" >"$C2_MOCK_LOG" 2>&1 &
  )

  sleep 1
  if lsof -nP -iTCP:"$C2_MOCK_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Mock C2 backend is listening on :$C2_MOCK_PORT"
  else
    echo "WARN: mock C2 backend failed to bind :$C2_MOCK_PORT"
    echo "      Check log: $C2_MOCK_LOG"
    tail -n 40 "$C2_MOCK_LOG" || true
  fi
}

normalize_runtime_policy() {
  if [[ "$FORCE_OPTIONAL_TRUST_POLICY" != "1" ]]; then
    return 0
  fi

  local cfg1="$HOME/Library/Application Support/com.aethercore.commander/runtime-config.json"
  local cfg2="$HOME/Library/Application Support/com.aethercore.commander.dev/runtime-config.json"
  local cfg

  for cfg in "$cfg1" "$cfg2"; do
    [[ -f "$cfg" ]] || continue
    python3 - "$cfg" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    doc = json.loads(path.read_text())
except Exception:
    print(f"WARN: unable to parse runtime config: {path}")
    raise SystemExit(0)

tpm = doc.get("tpm_policy")
if not isinstance(tpm, dict):
    tpm = {}

changed = False
if tpm.get("mode") != "optional":
    tpm["mode"] = "optional"
    changed = True
if tpm.get("enforce_hardware") is not False:
    tpm["enforce_hardware"] = False
    changed = True

if changed:
    doc["tpm_policy"] = tpm
    path.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"Updated runtime trust policy to optional: {path}")
PY
  done
}

if [[ "$SKIP_APP_RESTART" -eq 0 ]]; then
  echo "Stopping stale app processes..."
  pkill -9 -f "tactical-glass-desktop" || true

  echo "Stopping stale local control-plane node services..."
  pkill -9 -f "local-control-plane/.*/services/gateway/dist/index.js" || true
  pkill -9 -f "local-control-plane/.*/services/collaboration/dist/index.js" || true
else
  echo "Skipping app restart; preserving currently running local stack."
fi

start_mock_c2_backend
normalize_runtime_policy

launch_via_binary() {
  : >"$LOG_PATH"
  AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP="$LAUNCH_SENTINEL_SKIP" \
  AETHERCORE_SEP_ALLOW_EPHEMERAL="$LAUNCH_SEP_ALLOW_EPHEMERAL" \
  "$BIN_PATH" >"$LOG_PATH" 2>&1 & disown
}

launch_via_open() {
  # open(1) is often more robust for AppKit startup under LaunchServices.
  AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP="$LAUNCH_SENTINEL_SKIP" \
  AETHERCORE_SEP_ALLOW_EPHEMERAL="$LAUNCH_SEP_ALLOW_EPHEMERAL" \
  open -n "$APP_PATH"
}

is_app_running() {
  pgrep -fl "AetherCore Commander.app/Contents/MacOS/tactical-glass-desktop" >/dev/null 2>&1
}

wait_for_listener() {
  local port="$1"
  local timeout_sec="$2"
  local waited=0
  while (( waited < timeout_sec )); do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

verify_or_recover_stack() {
  local gateway_ready=0
  local collaboration_ready=0

  if wait_for_listener 3000 "$STACK_WAIT_SECS"; then
    gateway_ready=1
  fi
  if wait_for_listener 8080 "$STACK_WAIT_SECS"; then
    collaboration_ready=1
  fi

  if [[ "$gateway_ready" -eq 1 && "$collaboration_ready" -eq 1 ]]; then
    return 0
  fi

  if [[ "$LAUNCH_MODE" == "open" ]]; then
    echo "WARN: local stack listeners not detected after open launch; retrying via direct binary launch..."
    pkill -9 -f "AetherCore Commander.app/Contents/MacOS/tactical-glass-desktop" || true
    launch_via_binary
    sleep 1
  fi

  if [[ "$gateway_ready" -eq 0 ]] && ! wait_for_listener 3000 "$STACK_WAIT_SECS"; then
    echo "WARN: gateway listener (:3000) is still missing"
  else
    gateway_ready=1
  fi

  if [[ "$collaboration_ready" -eq 0 ]] && ! wait_for_listener 8080 "$STACK_WAIT_SECS"; then
    echo "WARN: collaboration listener (:8080) is still missing"
  else
    collaboration_ready=1
  fi

  if [[ "$gateway_ready" -eq 0 ]]; then
    return 1
  fi

  return 0
}

if [[ "$SKIP_APP_RESTART" -eq 0 ]]; then
  echo "Launching with sentinel flags: skip=$LAUNCH_SENTINEL_SKIP, allow_ephemeral=$LAUNCH_SEP_ALLOW_EPHEMERAL"

  case "$LAUNCH_MODE" in
    binary)
      echo "Launching app binary..."
      launch_via_binary
      ;;
    open)
      echo "Launching app via LaunchServices (open)..."
      launch_via_open
      ;;
    auto)
      echo "Launching app binary..."
      launch_via_binary
      sleep 2
      if ! is_app_running; then
        echo "WARN: binary launch did not stay up; retrying via LaunchServices (open)..."
        launch_via_open
      fi
      ;;
    *)
      echo "ERROR: invalid AETHERCORE_LAUNCH_MODE='$LAUNCH_MODE' (expected auto|binary|open)" >&2
      exit 2
      ;;
  esac

  sleep 1
  echo "Active process:"
  pgrep -fl tactical-glass-desktop || true
  echo "Launch log: $LOG_PATH"
  echo "Tip: tail -n 120 $LOG_PATH"
fi

verify_or_recover_stack
