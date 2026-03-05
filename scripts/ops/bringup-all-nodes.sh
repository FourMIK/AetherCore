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
PI_MODE="${PI_MODE:-}"
PI_C2_WS_URL="${PI_C2_WS_URL:-}"
PI_ENDPOINT_PROFILE="${PI_ENDPOINT_PROFILE:-}"
PI_ENROLLMENT_URL="${PI_ENROLLMENT_URL:-}"
PI_ENROLLMENT_CA_CERT_LOCAL_PATH="${PI_ENROLLMENT_CA_CERT_LOCAL_PATH:-}"
PI_ENROLLMENT_CA_CERT_B64="${PI_ENROLLMENT_CA_CERT_B64:-}"
PI_AWS_TESTBED_ALB_HOST="${PI_AWS_TESTBED_ALB_HOST:-aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com}"
PI_AWS_TESTBED_C2_WS_DEFAULT="${PI_AWS_TESTBED_C2_WS_DEFAULT:-wss://${PI_AWS_TESTBED_ALB_HOST}}"
PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT="${PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT:-https://${PI_AWS_TESTBED_ALB_HOST}/api/enrollment}"
PROFILE=""

SET_PI_SSH=0
SET_MAC_IP=0
SET_HELTECH_PORT=0
SET_HELTECH_HOST=0
SET_HELTECH_TCP_PORT=0
SET_HELTECH_DEVICE_ID=0
SET_PROBE_SECONDS=0
SET_PI_MODE=0
SET_PI_C2_WS_URL=0

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
  --profile <name>           Apply preset defaults (currently: home, aws-testbed)
  --pi-ssh <user@host>       Pi SSH target (default: duskone@192.168.1.125)
  --mac-ip <ip>              Mac IP to advertise/use (default: auto-detect)
  --pi-mode <dev|prod>       Pi mode switch for configure-pi-c2 (default: dev)
  --c2-ws-url <url>          Explicit Pi C2 endpoint (ws:// or wss://)
  --heltech-port <path>      Heltech serial port (example: /dev/cu.usbmodem...)
  --heltech-host <ip/name>   Heltech Meshtastic TCP host (Wi-Fi mode)
  --heltech-tcp-port <n>     Meshtastic TCP port for --heltech-host (default: 4403)
  --heltech-device-id <id>   Heltech device id override (default: derived by connect script)
  --probe-seconds <n>        Probe timeout seconds for check-mac-mesh (default: 8)
  -h, --help                 Show this help

Environment equivalents:
  PI_SSH, MAC_IP, PI_MODE, PI_C2_WS_URL, PI_ENDPOINT_PROFILE, PI_ENROLLMENT_URL,
  PI_ENROLLMENT_CA_CERT_LOCAL_PATH, PI_ENROLLMENT_CA_CERT_B64,
  HELTECH_PORT, HELTECH_HOST, HELTECH_TCP_PORT, HELTECH_DEVICE_ID, PROBE_SECONDS

Example:
  scripts/ops/bringup-all-nodes.sh --profile home

  scripts/ops/bringup-all-nodes.sh \
    --pi-ssh duskone@192.168.1.125 \
    --heltech-host 192.168.1.33 \
    --heltech-tcp-port 4403

  scripts/ops/bringup-all-nodes.sh \
    --pi-ssh duskone@192.168.1.125 \
    --heltech-port /dev/cu.usbmodem9070698426501

  scripts/ops/bringup-all-nodes.sh --profile aws-testbed
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
    --pi-mode)
      PI_MODE="${2:-}"
      SET_PI_MODE=1
      shift 2
      ;;
    --c2-ws-url)
      PI_C2_WS_URL="${2:-}"
      SET_PI_C2_WS_URL=1
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
      if [[ "$SET_PI_MODE" -eq 0 ]]; then
        PI_MODE="dev"
      fi
      if [[ -z "$PI_ENDPOINT_PROFILE" ]]; then
        PI_ENDPOINT_PROFILE="dev-local"
      fi
      ;;
    aws-testbed)
      if [[ "$SET_PI_MODE" -eq 0 ]]; then
        PI_MODE="prod"
      fi
      if [[ "$SET_PI_C2_WS_URL" -eq 0 && -z "$PI_C2_WS_URL" ]]; then
        PI_C2_WS_URL="$PI_AWS_TESTBED_C2_WS_DEFAULT"
      fi
      if [[ -z "$PI_ENROLLMENT_URL" ]]; then
        PI_ENROLLMENT_URL="$PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT"
      fi
      if [[ -z "$PI_ENDPOINT_PROFILE" ]]; then
        PI_ENDPOINT_PROFILE="prod-aws-testbed"
      fi
      ;;
    *)
      echo "ERROR: unknown profile: $PROFILE (supported: home, aws-testbed)" >&2
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

if [[ -z "$PI_MODE" ]]; then
  PI_MODE="dev"
fi
case "$PI_MODE" in
  dev|prod)
    ;;
  *)
    echo "ERROR: --pi-mode must be dev or prod (got: $PI_MODE)" >&2
    exit 1
    ;;
esac

if [[ -z "$PI_ENDPOINT_PROFILE" ]]; then
  if [[ "$PI_MODE" == "prod" ]]; then
    PI_ENDPOINT_PROFILE="prod-aws-testbed"
  else
    PI_ENDPOINT_PROFILE="dev-local"
  fi
fi

if [[ -z "$PI_C2_WS_URL" ]]; then
  PI_C2_WS_URL="ws://${MAC_IP}:3000"
fi
if [[ ! "$PI_C2_WS_URL" =~ ^wss?://[^[:space:]]+$ ]]; then
  echo "ERROR: --c2-ws-url must be ws://... or wss://... (got: $PI_C2_WS_URL)" >&2
  exit 1
fi

if [[ "$PI_MODE" == "prod" && -z "$PI_ENROLLMENT_URL" ]]; then
  echo "WARN: --pi-mode prod selected without PI_ENROLLMENT_URL; enrollment may fail." >&2
fi
if [[ "$PI_MODE" == "prod" && ! "$PI_C2_WS_URL" =~ ^wss:// ]]; then
  echo "WARN: --pi-mode prod selected with non-TLS C2 endpoint: $PI_C2_WS_URL" >&2
fi
if [[ "$PI_MODE" == "prod" ]]; then
  PI_AETHERCORE_PRODUCTION_NUM="1"
else
  PI_AETHERCORE_PRODUCTION_NUM="0"
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
echo "pi_mode=$PI_MODE"
echo "pi_endpoint_profile=$PI_ENDPOINT_PROFILE"
echo "pi_c2_ws_url=$PI_C2_WS_URL"
echo "pi_aethercore_production=$PI_AETHERCORE_PRODUCTION_NUM"
echo "pi_enrollment_url=${PI_ENROLLMENT_URL:-none}"
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

STEP_RESULTS=()
STEP_WARNINGS=0

record_step_ok() {
  local label="$1"
  local detail="$2"
  STEP_RESULTS+=("PASS | ${label} | ${detail}")
}

record_step_warn() {
  local label="$1"
  local detail="$2"
  STEP_RESULTS+=("WARN | ${label} | ${detail}")
  STEP_WARNINGS=$((STEP_WARNINGS + 1))
}

record_step_fail() {
  local label="$1"
  local detail="$2"
  STEP_RESULTS+=("FAIL | ${label} | ${detail}")
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

print_summary() {
  echo "== Bringup Summary =="
  for line in "${STEP_RESULTS[@]}"; do
    echo "$line"
  done
  if [[ "$STEP_WARNINGS" -gt 0 ]]; then
    echo "Completed with $STEP_WARNINGS warning(s)."
  fi
}

if [[ "$PI_MODE" == "prod" ]]; then
  echo "NOTE: Pi is configured for production endpoint mode (${PI_C2_WS_URL})."
  echo "      Steps 1/3/4/5 still validate local Mac + Heltech runtime."
  echo
fi

echo "== Step 1/6: Bring up local app + Heltech bridge =="
if "${CONNECT_CMD[@]}"; then
  if ! is_port_listening 3000; then
    record_step_fail "Step 1/6" "gateway listener :3000 is not active after local bring-up"
    print_summary
    exit 1
  fi

  if is_port_listening 8080; then
    record_step_ok "Step 1/6" "local app + Heltech bridge active (gateway :3000, collaboration :8080)"
  else
    record_step_warn "Step 1/6" "local app + Heltech bridge active; collaboration listener :8080 is not active"
    echo "WARN: continuing without collaboration listener :8080"
  fi
else
  record_step_fail "Step 1/6" "local app + Heltech bridge failed"
  print_summary
  exit 1
fi
echo

echo "== Step 2/6: Configure Pi C2 endpoint =="
if PI_ENDPOINT_PROFILE="$PI_ENDPOINT_PROFILE" \
  PI_AETHERCORE_PRODUCTION="$PI_AETHERCORE_PRODUCTION_NUM" \
  PI_ENROLLMENT_URL="$PI_ENROLLMENT_URL" \
  PI_ENROLLMENT_CA_CERT_LOCAL_PATH="$PI_ENROLLMENT_CA_CERT_LOCAL_PATH" \
  PI_ENROLLMENT_CA_CERT_B64="$PI_ENROLLMENT_CA_CERT_B64" \
  "$ROOT_DIR/scripts/ops/configure-pi-c2.sh" "$PI_SSH" "$MAC_IP" "$PI_C2_WS_URL"; then
  record_step_ok "Step 2/6" "Pi C2 endpoint configured"
else
  record_step_fail "Step 2/6" "Pi C2 endpoint configuration failed"
  print_summary
  exit 1
fi
echo

echo "== Step 3/6: Force one Pi presence publish =="
if "$ROOT_DIR/scripts/ops/force-pi-presence.sh" "$PI_SSH" "$MAC_IP"; then
  record_step_ok "Step 3/6" "Pi presence publish triggered"
else
  record_step_fail "Step 3/6" "Pi presence publish failed"
  print_summary
  exit 1
fi
echo

echo "== Step 4/6: Verify Heltech telemetry =="
HELTECH_CHECK_CMD=("$ROOT_DIR/scripts/ops/check-heltech-telemetry.sh")
if [[ -n "$HELTECH_DEVICE_ID" ]]; then
  HELTECH_CHECK_CMD+=(--device-id "$HELTECH_DEVICE_ID")
fi
if "${HELTECH_CHECK_CMD[@]}"; then
  record_step_ok "Step 4/6" "Heltech telemetry verified"
else
  record_step_fail "Step 4/6" "Heltech telemetry verification failed"
  print_summary
  exit 1
fi
echo

echo "== Step 5/6: Verify local Mac mesh state =="
if PROBE_SECONDS="$PROBE_SECONDS" "$ROOT_DIR/scripts/ops/check-mac-mesh.sh"; then
  record_step_ok "Step 5/6" "local Mac mesh checks completed"
else
  record_step_fail "Step 5/6" "local Mac mesh check failed"
  print_summary
  exit 1
fi
echo

echo "== Step 6/6: Verify Pi mesh state =="
if EXPECT_C2_WS_URL="$PI_C2_WS_URL" \
  EXPECT_AETHERCORE_PRODUCTION="$PI_AETHERCORE_PRODUCTION_NUM" \
  "$ROOT_DIR/scripts/ops/check-pi-mesh.sh" "$PI_SSH" "$MAC_IP" "$PI_C2_WS_URL"; then
  record_step_ok "Step 6/6" "Pi mesh checks completed"
else
  record_step_fail "Step 6/6" "Pi mesh check failed"
  print_summary
  exit 1
fi
echo

print_summary
echo "DONE: all node bring-up checks completed"
