#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRIDGE_SCRIPT="$ROOT_DIR/scripts/ops/bridge-heltech-presence.sh"
AUTO_BRIDGE_SCRIPT="$ROOT_DIR/scripts/ops/bridge-heltech-meshtastic.py"
RESTART_SCRIPT="$ROOT_DIR/scripts/ops/clean-restart-app.sh"
CHECK_SCRIPT="$ROOT_DIR/scripts/ops/check-mac-mesh.sh"
BRIDGE_LOG="${BRIDGE_LOG:-/tmp/aethercore-heltech-bridge.log}"
AUTO_BRIDGE_LOG="${AUTO_BRIDGE_LOG:-/tmp/aethercore-heltech-meshtastic.log}"

DEVICE_ID=""
PORT=""
HOST=""
TCP_PORT="${TCP_PORT:-4403}"
INTERVAL_SEC="${INTERVAL_SEC:-30}"
TRUST_SCORE="${TRUST_SCORE:-0.35}"
RESTART_APP=1
BACKGROUND=1
ONESHOT=0
MESH_ENDPOINT=""
GATEWAY_HTTP="${GATEWAY_HTTP:-http://127.0.0.1:3000}"
GPS_LAT=""
GPS_LON=""
GPS_ALT_M=""
BATTERY_PCT=""
VOLTAGE_V=""
SNR_DB=""
RSSI_DBM=""
AUTO_TELEMETRY=1

usage() {
  cat <<'EOF'
Usage:
  scripts/ops/connect-heltech-v4.sh [options]

Purpose:
  One-command Heltech WiFi LoRa 32 V4 onboarding into AetherCore local mesh.

Defaults:
  - auto-detects Heltech USB serial port and serial number
  - OR accepts Meshtastic TCP host/IP for Wi-Fi mode
  - restarts AetherCore app/control-plane for a clean state
  - starts automatic Meshtastic serial telemetry bridge in background (if available)
  - uses ws://<mac-ip>:3000 as Heltech endpoint metadata

Options:
  --device-id <id>         Override derived node id (default: heltech-v4-<usb-serial>)
  --port <path>            Override serial port (default: auto-detect)
  --host <ip-or-name>      Use Meshtastic TCP host/IP (Wi-Fi mode, skips USB detection)
  --tcp-port <port>        Meshtastic TCP port for --host mode (default: 4403)
  --interval-sec <n>       Heartbeat interval in seconds (default: 30)
  --trust-score <0..1>     Presence trust score for non-TPM node (default: 0.35)
  --mesh-endpoint <ws>     Endpoint value to publish in presence payload
  --gateway-http <url>     Gateway API URL (default: http://127.0.0.1:3000)
  --lat <decimal-deg>      Optional GPS latitude to publish
  --lon <decimal-deg>      Optional GPS longitude to publish
  --alt-m <meters>         Optional GPS altitude to publish
  --battery-pct <0..100>   Optional battery percentage to publish
  --voltage-v <volts>      Optional voltage to publish
  --snr-db <db>            Optional SNR to publish
  --rssi-dbm <dbm>         Optional RSSI to publish
  --no-auto-telemetry      Disable Meshtastic auto-telemetry bridge and use manual bridge mode
  --no-restart             Skip clean app restart
  --foreground             Run bridge in foreground
  --oneshot                Publish startup once and exit
  -h, --help               Show this help

Examples:
  scripts/ops/connect-heltech-v4.sh

  scripts/ops/connect-heltech-v4.sh --device-id heltech-v4-alpha --foreground
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --tcp-port)
      TCP_PORT="${2:-}"
      shift 2
      ;;
    --interval-sec)
      INTERVAL_SEC="${2:-}"
      shift 2
      ;;
    --trust-score)
      TRUST_SCORE="${2:-}"
      shift 2
      ;;
    --mesh-endpoint)
      MESH_ENDPOINT="${2:-}"
      shift 2
      ;;
    --gateway-http)
      GATEWAY_HTTP="${2:-}"
      shift 2
      ;;
    --lat)
      GPS_LAT="${2:-}"
      shift 2
      ;;
    --lon)
      GPS_LON="${2:-}"
      shift 2
      ;;
    --alt-m)
      GPS_ALT_M="${2:-}"
      shift 2
      ;;
    --battery-pct)
      BATTERY_PCT="${2:-}"
      shift 2
      ;;
    --voltage-v)
      VOLTAGE_V="${2:-}"
      shift 2
      ;;
    --snr-db)
      SNR_DB="${2:-}"
      shift 2
      ;;
    --rssi-dbm)
      RSSI_DBM="${2:-}"
      shift 2
      ;;
    --no-auto-telemetry)
      AUTO_TELEMETRY=0
      shift
      ;;
    --no-restart)
      RESTART_APP=0
      shift
      ;;
    --foreground)
      BACKGROUND=0
      shift
      ;;
    --oneshot)
      ONESHOT=1
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

if [[ ! -x "$BRIDGE_SCRIPT" ]]; then
  echo "ERROR: bridge script missing: $BRIDGE_SCRIPT" >&2
  exit 1
fi

detect_heltech_usb_serial() {
  ioreg -p IOUSB -l -w 0 2>/dev/null | awk -F'"' '
    /heltec_wifi_lora_32 v4/ { in_dev=1 }
    in_dev && /USB Serial Number/ { print $4; exit }
  '
}

detect_heltech_port() {
  local serial="$1"
  local candidates=()
  local candidate

  if [[ -n "$serial" ]]; then
    while IFS= read -r candidate; do
      candidates+=("$candidate")
    done < <(ls -1 /dev/cu.usbmodem"${serial}"* 2>/dev/null || true)
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    while IFS= read -r candidate; do
      candidates+=("$candidate")
    done < <(ls -1 /dev/cu.usbmodem* /dev/cu.usbserial* 2>/dev/null || true)
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi

  printf '%s\n' "${candidates[@]}" | head -n 1
}

detect_mac_ip() {
  local iface ip
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
  if [[ -n "$iface" ]]; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  fi
  ipconfig getifaddr en0 2>/dev/null || true
}

has_meshtastic_python() {
  python3 - <<'PY' >/dev/null 2>&1
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("meshtastic") else 1)
PY
}

start_background_bridge() {
  local log_path="$1"
  shift
  nohup "$@" >"$log_path" 2>&1 &
  local bridge_pid=$!
  disown "$bridge_pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$bridge_pid" 2>/dev/null; then
    echo "$bridge_pid"
    return 0
  fi
  return 1
}

if ! [[ "$TCP_PORT" =~ ^[0-9]+$ ]] || [[ "$TCP_PORT" -lt 1 ]] || [[ "$TCP_PORT" -gt 65535 ]]; then
  echo "ERROR: --tcp-port must be integer between 1 and 65535" >&2
  exit 1
fi

USB_SERIAL=""
CONNECT_MODE="serial"
if [[ -n "$HOST" ]]; then
  CONNECT_MODE="tcp"
else
  USB_SERIAL="$(detect_heltech_usb_serial || true)"
  if [[ -z "$PORT" ]]; then
    PORT="$(detect_heltech_port "$USB_SERIAL" || true)"
  fi
fi

if [[ "$CONNECT_MODE" == "serial" && -z "$PORT" ]]; then
  echo "ERROR: no USB modem serial port found for Heltech V4" >&2
  echo "Try replugging USB and rerun. Current cu ports:" >&2
  ls -1 /dev/cu.* 2>/dev/null | sed -n '1,120p' >&2 || true
  exit 1
fi

if [[ "$CONNECT_MODE" == "serial" && -z "$USB_SERIAL" ]]; then
  USB_SERIAL="$(basename "$PORT" | sed -E 's/^cu\.usb(modem|serial)//' | tr -cd '[:alnum:]')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  if [[ "$CONNECT_MODE" == "tcp" ]]; then
    safe_host="$(printf '%s' "$HOST" | tr -cs 'a-zA-Z0-9._-' '-')"
    DEVICE_ID="heltech-v4-${safe_host}"
  elif [[ -n "$USB_SERIAL" ]]; then
    DEVICE_ID="heltech-v4-${USB_SERIAL}"
  else
    safe_port="$(basename "$PORT" | tr -cs 'a-zA-Z0-9._-' '-')"
    DEVICE_ID="heltech-v4-${safe_port}"
  fi
fi

if [[ -z "$MESH_ENDPOINT" ]]; then
  MAC_IP="$(detect_mac_ip || true)"
  if [[ -n "${MAC_IP:-}" ]]; then
    MESH_ENDPOINT="ws://${MAC_IP}:3000"
  else
    MESH_ENDPOINT="ws://localhost:3000"
  fi
fi

echo "Detected Heltech V4:"
echo "  mode=$CONNECT_MODE"
echo "  usb_serial=${USB_SERIAL:-unknown}"
if [[ "$CONNECT_MODE" == "tcp" ]]; then
  echo "  tcp_host=$HOST"
  echo "  tcp_port=$TCP_PORT"
else
  echo "  serial_port=$PORT"
fi
echo "  device_id=$DEVICE_ID"
echo "  mesh_endpoint=$MESH_ENDPOINT"
echo "  gateway_http=$GATEWAY_HTTP"
echo "  interval_sec=$INTERVAL_SEC"
echo

if [[ "$RESTART_APP" -eq 1 ]]; then
  if [[ ! -x "$RESTART_SCRIPT" ]]; then
    echo "ERROR: restart script missing: $RESTART_SCRIPT" >&2
    exit 1
  fi
  "$RESTART_SCRIPT"
fi

pkill -f "bridge-heltech-presence.sh" || true
pkill -f "bridge-heltech-meshtastic.py" || true

BRIDGE_CMD=(
  "$BRIDGE_SCRIPT"
  --device-id "$DEVICE_ID"
  --hardware-serial "${USB_SERIAL:-$DEVICE_ID}"
  --mesh-endpoint "$MESH_ENDPOINT"
  --gateway-http "$GATEWAY_HTTP"
  --trust-score "$TRUST_SCORE"
  --tpm-backed false
  --interval-sec "$INTERVAL_SEC"
)

if [[ -n "$GPS_LAT" ]]; then
  BRIDGE_CMD+=(--lat "$GPS_LAT")
fi
if [[ -n "$GPS_LON" ]]; then
  BRIDGE_CMD+=(--lon "$GPS_LON")
fi
if [[ -n "$GPS_ALT_M" ]]; then
  BRIDGE_CMD+=(--alt-m "$GPS_ALT_M")
fi
if [[ -n "$BATTERY_PCT" ]]; then
  BRIDGE_CMD+=(--battery-pct "$BATTERY_PCT")
fi
if [[ -n "$VOLTAGE_V" ]]; then
  BRIDGE_CMD+=(--voltage-v "$VOLTAGE_V")
fi
if [[ -n "$SNR_DB" ]]; then
  BRIDGE_CMD+=(--snr-db "$SNR_DB")
fi
if [[ -n "$RSSI_DBM" ]]; then
  BRIDGE_CMD+=(--rssi-dbm "$RSSI_DBM")
fi

if [[ "$ONESHOT" -eq 1 ]]; then
  BRIDGE_CMD+=(--oneshot)
fi

MANUAL_TELEMETRY_OVERRIDES=0
if [[ -n "$GPS_LAT" || -n "$GPS_LON" || -n "$GPS_ALT_M" || -n "$BATTERY_PCT" || -n "$VOLTAGE_V" || -n "$SNR_DB" || -n "$RSSI_DBM" ]]; then
  MANUAL_TELEMETRY_OVERRIDES=1
fi

USE_AUTO_TELEMETRY=0
if [[ "$AUTO_TELEMETRY" -eq 1 && "$MANUAL_TELEMETRY_OVERRIDES" -eq 0 ]]; then
  if [[ ! -f "$AUTO_BRIDGE_SCRIPT" ]]; then
    echo "WARN: auto-telemetry script missing: $AUTO_BRIDGE_SCRIPT"
  elif ! has_meshtastic_python; then
    echo "WARN: meshtastic Python package not installed; falling back to manual bridge mode."
    echo "Install: python3 -m pip install --user meshtastic"
  else
    USE_AUTO_TELEMETRY=1
  fi
fi

if [[ "$USE_AUTO_TELEMETRY" -eq 1 ]]; then
  AUTO_CMD=(
    python3 "$AUTO_BRIDGE_SCRIPT"
    --device-id "$DEVICE_ID"
    --hardware-serial "${USB_SERIAL:-$DEVICE_ID}"
    --mesh-endpoint "$MESH_ENDPOINT"
    --gateway-http "$GATEWAY_HTTP"
    --trust-score "$TRUST_SCORE"
    --interval-sec "$INTERVAL_SEC"
  )
  if [[ "$CONNECT_MODE" == "tcp" ]]; then
    AUTO_CMD+=(--host "$HOST" --tcp-port "$TCP_PORT")
  else
    AUTO_CMD+=(--port "$PORT")
  fi
  if [[ "$ONESHOT" -eq 1 ]]; then
    AUTO_CMD+=(--oneshot)
  fi

  if [[ "$BACKGROUND" -eq 1 && "$ONESHOT" -eq 0 ]]; then
    echo "Starting Heltech Meshtastic auto-telemetry bridge in background..."
    if BRIDGE_PID="$(start_background_bridge "$AUTO_BRIDGE_LOG" "${AUTO_CMD[@]}")"; then
      echo "Auto-bridge pid: $BRIDGE_PID"
      echo "Auto-bridge log: $AUTO_BRIDGE_LOG"
      echo "Tail: tail -f $AUTO_BRIDGE_LOG"
    else
      echo "WARN: auto-telemetry bridge exited immediately. Falling back to manual bridge mode."
      tail -n 40 "$AUTO_BRIDGE_LOG" 2>/dev/null || true
      if BRIDGE_PID="$(start_background_bridge "$BRIDGE_LOG" "${BRIDGE_CMD[@]}")"; then
        echo "Fallback manual bridge pid: $BRIDGE_PID"
        echo "Bridge log: $BRIDGE_LOG"
        echo "Tail: tail -f $BRIDGE_LOG"
      else
        echo "ERROR: fallback manual bridge also exited immediately."
        tail -n 60 "$BRIDGE_LOG" 2>/dev/null || true
        exit 1
      fi
    fi
  else
    echo "Starting Heltech Meshtastic auto-telemetry bridge in foreground..."
    "${AUTO_CMD[@]}"
  fi
else
  if [[ "$BACKGROUND" -eq 1 && "$ONESHOT" -eq 0 ]]; then
    echo "Starting Heltech manual bridge in background..."
    if BRIDGE_PID="$(start_background_bridge "$BRIDGE_LOG" "${BRIDGE_CMD[@]}")"; then
      echo "Bridge pid: $BRIDGE_PID"
      echo "Bridge log: $BRIDGE_LOG"
      echo "Tail: tail -f $BRIDGE_LOG"
    else
      echo "ERROR: manual bridge exited immediately."
      tail -n 60 "$BRIDGE_LOG" 2>/dev/null || true
      exit 1
    fi
  else
    echo "Starting Heltech manual bridge in foreground..."
    "${BRIDGE_CMD[@]}"
  fi
fi

if [[ -x "$CHECK_SCRIPT" ]]; then
  echo
  PROBE_SECONDS=8 "$CHECK_SCRIPT" || true
fi

echo
echo "DONE: Heltech V4 onboarding flow completed"
