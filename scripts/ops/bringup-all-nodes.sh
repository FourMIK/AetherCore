#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PI_SSH="${PI_SSH:-duskone@192.168.1.125}"
MAC_IP="${MAC_IP:-}"
HELTECH_PORT="${HELTECH_PORT:-}"
HELTECH_HOST="${HELTECH_HOST:-}"
HELTECH_TCP_PORT="${HELTECH_TCP_PORT:-4403}"
HELTECH_DEVICE_ID="${HELTECH_DEVICE_ID:-}"
PROBE_SECONDS="${PROBE_SECONDS:-8}"
PROFILE=""

SET_PI_SSH=0
SET_MAC_IP=0
SET_HELTECH_PORT=0
SET_HELTECH_HOST=0
SET_HELTECH_TCP_PORT=0
SET_HELTECH_DEVICE_ID=0
SET_PROBE_SECONDS=0

usage() {
  cat <<'EOF'
Usage:
  scripts/ops/bringup-all-nodes.sh [options]

Purpose:
  One-command bring-up for local AetherCore + Heltech V4 + Pi CodeRalphie.

What it runs:
  1) connect-heltech-v4.sh
  2) configure-pi-c2.sh
  3) force-pi-presence.sh
  4) check-heltech-telemetry.sh
  5) check-mac-mesh.sh
  6) check-pi-mesh.sh

Options:
  --profile <name>           Apply preset defaults (currently: home)
  --pi-ssh <user@host>       Pi SSH target (default: duskone@192.168.1.125)
  --mac-ip <ip>              Mac IP to advertise/use (default: auto-detect)
  --heltech-port <path>      Heltech serial port (example: /dev/cu.usbmodem...)
  --heltech-host <ip/name>   Heltech Meshtastic TCP host (Wi-Fi mode)
  --heltech-tcp-port <n>     Meshtastic TCP port for --heltech-host (default: 4403)
  --heltech-device-id <id>   Heltech device id override (default: derived by connect script)
  --probe-seconds <n>        Probe timeout seconds for check-mac-mesh (default: 8)
  -h, --help                 Show this help

Environment equivalents:
  PI_SSH, MAC_IP, HELTECH_PORT, HELTECH_HOST, HELTECH_TCP_PORT, HELTECH_DEVICE_ID, PROBE_SECONDS

Example:
  scripts/ops/bringup-all-nodes.sh --profile home

  scripts/ops/bringup-all-nodes.sh \
    --pi-ssh duskone@192.168.1.125 \
    --heltech-host 192.168.1.33 \
    --heltech-tcp-port 4403

  scripts/ops/bringup-all-nodes.sh \
    --pi-ssh duskone@192.168.1.125 \
    --heltech-port /dev/cu.usbmodem9070698426501
EOF
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --pi-ssh)
      PI_SSH="${2:-}"
      SET_PI_SSH=1
      shift 2
      ;;
    --mac-ip)
      MAC_IP="${2:-}"
      SET_MAC_IP=1
      shift 2
      ;;
    --heltech-port)
      HELTECH_PORT="${2:-}"
      SET_HELTECH_PORT=1
      shift 2
      ;;
    --heltech-host)
      HELTECH_HOST="${2:-}"
      SET_HELTECH_HOST=1
      shift 2
      ;;
    --heltech-tcp-port)
      HELTECH_TCP_PORT="${2:-}"
      SET_HELTECH_TCP_PORT=1
      shift 2
      ;;
    --heltech-device-id)
      HELTECH_DEVICE_ID="${2:-}"
      SET_HELTECH_DEVICE_ID=1
      shift 2
      ;;
    --probe-seconds)
      PROBE_SECONDS="${2:-}"
      SET_PROBE_SECONDS=1
      shift 2
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

if [[ -n "$PROFILE" ]]; then
  case "$PROFILE" in
    home)
      if [[ "$SET_PI_SSH" -eq 0 ]]; then
        PI_SSH="duskone@192.168.1.125"
      fi
      if [[ "$SET_MAC_IP" -eq 0 ]]; then
        MAC_IP="192.168.1.51"
      fi
      if [[ "$SET_HELTECH_HOST" -eq 0 && "$SET_HELTECH_PORT" -eq 0 ]]; then
        HELTECH_HOST="192.168.1.33"
      fi
      if [[ "$SET_HELTECH_TCP_PORT" -eq 0 ]]; then
        HELTECH_TCP_PORT="4403"
      fi
      if [[ "$SET_PROBE_SECONDS" -eq 0 ]]; then
        PROBE_SECONDS="8"
      fi
      ;;
    *)
      echo "ERROR: unknown profile: $PROFILE (supported: home)" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$PI_SSH" ]]; then
  echo "ERROR: --pi-ssh cannot be empty" >&2
  exit 1
fi

if [[ -z "$MAC_IP" ]]; then
  MAC_IP="$(detect_mac_ip || true)"
fi
if [[ -z "$MAC_IP" ]]; then
  echo "ERROR: failed to auto-detect MAC_IP. Pass --mac-ip explicitly." >&2
  exit 1
fi

if ! [[ "$PROBE_SECONDS" =~ ^[0-9]+$ ]] || [[ "$PROBE_SECONDS" -lt 3 ]]; then
  echo "ERROR: --probe-seconds must be integer >= 3" >&2
  exit 1
fi

if ! [[ "$HELTECH_TCP_PORT" =~ ^[0-9]+$ ]] || [[ "$HELTECH_TCP_PORT" -lt 1 ]] || [[ "$HELTECH_TCP_PORT" -gt 65535 ]]; then
  echo "ERROR: --heltech-tcp-port must be integer between 1 and 65535" >&2
  exit 1
fi

if [[ -n "$HELTECH_HOST" && -n "$HELTECH_PORT" ]]; then
  echo "ERROR: use either --heltech-host (Wi-Fi) or --heltech-port (USB), not both" >&2
  exit 1
fi

echo "== Bringup Parameters =="
echo "profile=${PROFILE:-none}"
echo "pi_ssh=$PI_SSH"
echo "mac_ip=$MAC_IP"
echo "heltech_mode=$([[ -n "$HELTECH_HOST" ]] && echo tcp || echo serial)"
echo "heltech_port=${HELTECH_PORT:-auto}"
echo "heltech_host=${HELTECH_HOST:-n/a}"
echo "heltech_tcp_port=$HELTECH_TCP_PORT"
echo "heltech_device_id=${HELTECH_DEVICE_ID:-auto}"
echo "probe_seconds=$PROBE_SECONDS"
echo

CONNECT_CMD=("$ROOT_DIR/scripts/ops/connect-heltech-v4.sh")
if [[ -n "$HELTECH_PORT" ]]; then
  CONNECT_CMD+=(--port "$HELTECH_PORT")
fi
if [[ -n "$HELTECH_HOST" ]]; then
  CONNECT_CMD+=(--host "$HELTECH_HOST" --tcp-port "$HELTECH_TCP_PORT")
fi
if [[ -n "$HELTECH_DEVICE_ID" ]]; then
  CONNECT_CMD+=(--device-id "$HELTECH_DEVICE_ID")
fi

echo "== Step 1/6: Bring up local app + Heltech bridge =="
"${CONNECT_CMD[@]}"
echo

echo "== Step 2/6: Configure Pi C2 endpoint =="
"$ROOT_DIR/scripts/ops/configure-pi-c2.sh" "$PI_SSH" "$MAC_IP"
echo

echo "== Step 3/6: Force one Pi presence publish =="
"$ROOT_DIR/scripts/ops/force-pi-presence.sh" "$PI_SSH" "$MAC_IP"
echo

echo "== Step 4/6: Verify Heltech telemetry =="
HELTECH_CHECK_CMD=("$ROOT_DIR/scripts/ops/check-heltech-telemetry.sh")
if [[ -n "$HELTECH_DEVICE_ID" ]]; then
  HELTECH_CHECK_CMD+=(--device-id "$HELTECH_DEVICE_ID")
fi
"${HELTECH_CHECK_CMD[@]}"
echo

echo "== Step 5/6: Verify local Mac mesh state =="
PROBE_SECONDS="$PROBE_SECONDS" "$ROOT_DIR/scripts/ops/check-mac-mesh.sh"
echo

echo "== Step 6/6: Verify Pi mesh state =="
"$ROOT_DIR/scripts/ops/check-pi-mesh.sh" "$PI_SSH" "$MAC_IP"
echo

echo "DONE: all node bring-up checks completed"
