#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WS_MODULE="${WS_MODULE:-$ROOT_DIR/services/gateway/node_modules/ws}"
GATEWAY_WS="${GATEWAY_WS:-ws://127.0.0.1:3000}"
BRIDGE_LOG="${BRIDGE_LOG:-/tmp/aethercore-heltech-meshtastic.log}"
TIMEOUT_SEC="${TIMEOUT_SEC:-12}"
LOG_LINES="${LOG_LINES:-80}"
DEVICE_ID=""
REQUIRE_GPS=1

usage() {
  cat <<'EOF'
Usage:
  scripts/ops/check-heltech-telemetry.sh [options]

Purpose:
  Validate that Heltech Meshtastic auto-telemetry is alive and reaching
  the local AetherCore gateway websocket stream.

Options:
  --device-id <id>         Node id to validate (auto-detected if omitted)
  --gateway-ws <ws-url>    Gateway websocket URL (default: ws://127.0.0.1:3000)
  --bridge-log <path>      Bridge log path (default: /tmp/aethercore-heltech-meshtastic.log)
  --timeout-sec <n>        Websocket validation timeout in seconds (default: 12)
  --log-lines <n>          Tail this many bridge log lines (default: 80)
  --no-require-gps         Do not fail if GPS lat/lon are missing
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --gateway-ws)
      GATEWAY_WS="${2:-}"
      shift 2
      ;;
    --bridge-log)
      BRIDGE_LOG="${2:-}"
      shift 2
      ;;
    --timeout-sec)
      TIMEOUT_SEC="${2:-}"
      shift 2
      ;;
    --log-lines)
      LOG_LINES="${2:-}"
      shift 2
      ;;
    --no-require-gps)
      REQUIRE_GPS=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "$TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SEC" -lt 3 ]]; then
  echo "ERROR: --timeout-sec must be integer >= 3" >&2
  exit 1
fi

if ! [[ "$LOG_LINES" =~ ^[0-9]+$ ]] || [[ "$LOG_LINES" -lt 1 ]]; then
  echo "ERROR: --log-lines must be integer >= 1" >&2
  exit 1
fi

echo "== Heltech auto-bridge process =="
BRIDGE_PROC_LINE="$(pgrep -af "bridge-heltech-meshtastic.py" 2>/dev/null | head -n 1 || true)"
if [[ -z "$BRIDGE_PROC_LINE" ]]; then
  BRIDGE_PROC_LINE="$(ps -ax -o pid= -o command= 2>/dev/null | awk '
    /bridge-heltech-meshtastic.py/ && $0 !~ /awk/ {
      print $0;
      exit;
    }' || true)"
fi
if [[ -z "$BRIDGE_PROC_LINE" ]]; then
  echo "FAIL: bridge-heltech-meshtastic.py is not running"
  exit 2
fi
echo "$BRIDGE_PROC_LINE"

BRIDGE_PID="$(printf '%s\n' "$BRIDGE_PROC_LINE" | awk '{print $1}')"
if [[ -n "$BRIDGE_PID" ]] && [[ "$BRIDGE_PID" =~ ^[0-9]+$ ]]; then
  FULL_CMD_FROM_PID="$(ps -p "$BRIDGE_PID" -o command= 2>/dev/null | head -n 1 || true)"
  if [[ -n "$FULL_CMD_FROM_PID" ]]; then
    BRIDGE_PROC_LINE="$BRIDGE_PID $FULL_CMD_FROM_PID"
  fi
fi

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(printf '%s\n' "$BRIDGE_PROC_LINE" | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i == "--device-id" && (i + 1) <= NF) {
        print $(i + 1);
        exit;
      }
    }
  }')"
fi

if [[ -z "$DEVICE_ID" ]] && [[ -f "$BRIDGE_LOG" ]]; then
  DEVICE_ID="$(awk -F= '/device_id=/{id=$2} END{if(id!="") print id}' "$BRIDGE_LOG" | tr -d '[:space:]' || true)"
fi

if [[ -z "$DEVICE_ID" ]] && [[ -f "$WS_MODULE/index.js" || -d "$WS_MODULE" ]]; then
  DEVICE_ID="$(WS_MODULE="$WS_MODULE" GATEWAY_WS="$GATEWAY_WS" node - <<'NODE'
const WebSocket = require(process.env.WS_MODULE);
const ws = new WebSocket(process.env.GATEWAY_WS || "ws://127.0.0.1:3000");
const timer = setTimeout(() => process.exit(0), 5000);

function done(value) {
  clearTimeout(timer);
  if (value) process.stdout.write(value);
  process.exit(0);
}

function pickFromNodes(nodes) {
  const ids = (nodes || [])
    .map((n) => n?.identity?.device_id)
    .filter((id) => typeof id === "string" && id.length > 0);
  const heltech = ids.filter((id) => id.startsWith("heltech-v4-"));
  if (heltech.length === 1) return heltech[0];
  if (heltech.length > 1) return heltech[0];
  if (ids.length === 1) return ids[0];
  return "";
}

ws.on("message", (buf) => {
  let msg;
  try {
    msg = JSON.parse(String(buf));
  } catch {
    return;
  }
  if (msg?.type === "RALPHIE_PRESENCE_SNAPSHOT" && Array.isArray(msg.nodes)) {
    done(pickFromNodes(msg.nodes));
  } else if (msg?.type === "RALPHIE_PRESENCE" && msg?.data?.identity?.device_id) {
    done(String(msg.data.identity.device_id));
  }
});
ws.on("open", () => {});
ws.on("error", () => done(""));
NODE
)"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "FAIL: could not determine device_id automatically."
  echo "Try: scripts/ops/check-heltech-telemetry.sh --device-id heltech-v4-<serial>"
  exit 3
fi

echo
echo "== Parameters =="
echo "device_id=$DEVICE_ID"
echo "gateway_ws=$GATEWAY_WS"
echo "require_gps=$REQUIRE_GPS"
echo "timeout_sec=$TIMEOUT_SEC"

echo
echo "== Bridge log tail =="
if [[ -f "$BRIDGE_LOG" ]]; then
  tail -n "$LOG_LINES" "$BRIDGE_LOG" || true
else
  echo "WARN: log file not found: $BRIDGE_LOG"
fi

echo
echo "== Websocket telemetry validation =="
if [[ ! -f "$WS_MODULE/index.js" && ! -d "$WS_MODULE" ]]; then
  echo "FAIL: ws module not found at $WS_MODULE"
  exit 4
fi

WS_MODULE="$WS_MODULE" \
DEVICE_ID="$DEVICE_ID" \
GATEWAY_WS="$GATEWAY_WS" \
TIMEOUT_MS="$(( TIMEOUT_SEC * 1000 ))" \
REQUIRE_GPS="$REQUIRE_GPS" \
node - <<'NODE'
const WebSocket = require(process.env.WS_MODULE);
const deviceId = process.env.DEVICE_ID;
const gatewayWs = process.env.GATEWAY_WS;
const timeoutMs = Number(process.env.TIMEOUT_MS || "12000");
const requireGps = Number(process.env.REQUIRE_GPS || "1") === 1;

function firstFinite(...values) {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function evaluate(node) {
  const telemetry = node?.telemetry || {};
  const gps = telemetry.gps || {};
  const power = telemetry.power || {};
  const radio = telemetry.radio || {};
  const device = telemetry.device || {};

  const lat = firstFinite(gps.lat, gps.latitude);
  const lon = firstFinite(gps.lon, gps.longitude);
  const alt = firstFinite(gps.alt_m, gps.altitude_m);
  const hasGps = Number.isFinite(lat) && Number.isFinite(lon);
  const hasPower =
    Number.isFinite(firstFinite(power.battery_pct)) ||
    Number.isFinite(firstFinite(power.voltage_v));
  const hasRadio =
    Number.isFinite(firstFinite(radio.snr_db, radio.lora_snr_db)) ||
    Number.isFinite(firstFinite(radio.rssi_dbm, radio.lora_rssi_dbm));
  const hasDevice = typeof device.model === "string" || typeof device.transport === "string";

  return {
    hasTelemetry: telemetry && Object.keys(telemetry).length > 0,
    hasGps,
    hasPower,
    hasRadio,
    hasDevice,
    lat,
    lon,
    alt
  };
}

const ws = new WebSocket(gatewayWs);
let finished = false;

const timer = setTimeout(() => {
  if (!finished) {
    console.error(`FAIL: timeout waiting for telemetry for ${deviceId}`);
    process.exit(6);
  }
}, timeoutMs);

function finishOk(msg) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.log(msg);
  process.exit(0);
}

function finishFail(msg, code = 7) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.error(msg);
  process.exit(code);
}

function inspectNode(node, source) {
  if (!node || node?.identity?.device_id !== deviceId) return false;
  const verdict = evaluate(node);
  console.log(`found_node source=${source} telemetry=${JSON.stringify(verdict)}`);
  if (!verdict.hasTelemetry) {
    finishFail(`FAIL: node ${deviceId} found but telemetry missing`, 8);
    return true;
  }
  if (requireGps && !verdict.hasGps) {
    finishFail(`FAIL: node ${deviceId} found but GPS lat/lon missing`, 9);
    return true;
  }
  finishOk(`PASS: telemetry stream validated for ${deviceId}`);
  return true;
}

ws.on("open", () => {
  console.log(`ws_open ${gatewayWs}`);
});

ws.on("message", (buf) => {
  let msg;
  try {
    msg = JSON.parse(String(buf));
  } catch {
    return;
  }

  if (msg?.type === "RALPHIE_PRESENCE" && msg?.data) {
    inspectNode(msg.data, "live");
    return;
  }

  if (msg?.type === "RALPHIE_PRESENCE_SNAPSHOT" && Array.isArray(msg.nodes)) {
    for (const n of msg.nodes) {
      if (inspectNode(n, "snapshot")) return;
    }
  }
});

ws.on("error", (err) => {
  finishFail(`FAIL: websocket error: ${err.message}`, 5);
});
NODE

echo
echo "DONE: heltech telemetry checks complete"
