#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WS_MODULE="${WS_MODULE:-$ROOT_DIR/services/gateway/node_modules/ws}"
GATEWAY_HTTP="${GATEWAY_HTTP:-http://127.0.0.1:3000}"
MESH_ENDPOINT="${MESH_ENDPOINT:-ws://localhost:3000}"
DEVICE_ID=""
HARDWARE_SERIAL=""
CERTIFICATE_SERIAL=""
TRUST_SCORE="${TRUST_SCORE:-0.35}"
TPM_BACKED="${TPM_BACKED:-false}"
ENROLLED_AT_MS="${ENROLLED_AT_MS:-$(( $(date +%s) * 1000 ))}"
INTERVAL_SEC="${INTERVAL_SEC:-30}"
ONESHOT=0
VERIFY_SNAPSHOT=1
GPS_LAT=""
GPS_LON=""
GPS_ALT_M=""
BATTERY_PCT=""
VOLTAGE_V=""
SNR_DB=""
RSSI_DBM=""

usage() {
  cat <<'EOF'
Usage:
  scripts/ops/bridge-heltech-presence.sh --device-id <id> [options]

Purpose:
  Bridge a Heltech/Meshtastic node into AetherCore by publishing
  RALPHIE_PRESENCE frames to the local gateway.

Required:
  --device-id <id>              Stable node id (example: heltech-v4-01)

Optional:
  --hardware-serial <value>     Defaults to device id
  --certificate-serial <value>  Defaults to "heltech-<device-id>"
  --mesh-endpoint <ws-url>      Defaults to ws://localhost:3000
  --gateway-http <url>          Defaults to http://127.0.0.1:3000
  --trust-score <0..1>          Defaults to 0.35 (reduced trust, no TPM)
  --tpm-backed <true|false>     Defaults to false
  --interval-sec <seconds>      Defaults to 30
  --enrolled-at-ms <epoch-ms>   Defaults to now
  --lat <decimal-deg>           Optional GPS latitude
  --lon <decimal-deg>           Optional GPS longitude
  --alt-m <meters>              Optional GPS altitude in meters
  --battery-pct <0..100>        Optional battery percentage
  --voltage-v <volts>           Optional supply/battery voltage
  --snr-db <db>                 Optional radio SNR in dB
  --rssi-dbm <dbm>              Optional radio RSSI in dBm
  --oneshot                     Send startup frame once and exit
  --no-verify                   Skip websocket snapshot verification
  -h, --help                    Show this help

Examples:
  scripts/ops/bridge-heltech-presence.sh \
    --device-id heltech-v4-01 \
    --hardware-serial 58b23f4a \
    --mesh-endpoint ws://192.168.1.51:3000

  scripts/ops/bridge-heltech-presence.sh \
    --device-id heltech-v4-01 \
    --oneshot
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --hardware-serial)
      HARDWARE_SERIAL="${2:-}"
      shift 2
      ;;
    --certificate-serial)
      CERTIFICATE_SERIAL="${2:-}"
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
    --trust-score)
      TRUST_SCORE="${2:-}"
      shift 2
      ;;
    --tpm-backed)
      TPM_BACKED="${2:-}"
      shift 2
      ;;
    --interval-sec)
      INTERVAL_SEC="${2:-}"
      shift 2
      ;;
    --enrolled-at-ms)
      ENROLLED_AT_MS="${2:-}"
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
    --oneshot)
      ONESHOT=1
      shift
      ;;
    --no-verify)
      VERIFY_SNAPSHOT=0
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

if [[ -z "$DEVICE_ID" ]]; then
  echo "ERROR: --device-id is required" >&2
  usage >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required" >&2
  exit 1
fi

if [[ -z "$HARDWARE_SERIAL" ]]; then
  HARDWARE_SERIAL="$DEVICE_ID"
fi

if [[ -z "$CERTIFICATE_SERIAL" ]]; then
  safe_id="$(printf '%s' "$DEVICE_ID" | tr -cs 'a-zA-Z0-9._-' '-')"
  safe_id="${safe_id#-}"
  safe_id="${safe_id%-}"
  CERTIFICATE_SERIAL="heltech-${safe_id}"
fi

TPM_BACKED_NORMALIZED="$(printf '%s' "$TPM_BACKED" | tr '[:upper:]' '[:lower:]')"
case "$TPM_BACKED_NORMALIZED" in
  true|false) ;;
  *)
    echo "ERROR: --tpm-backed must be true or false" >&2
    exit 1
    ;;
esac

if ! jq -en --argjson score "$TRUST_SCORE" '$score >= 0 and $score <= 1' >/dev/null 2>&1; then
  echo "ERROR: --trust-score must be a number between 0 and 1" >&2
  exit 1
fi

if ! jq -en --argjson ts "$ENROLLED_AT_MS" '$ts > 0 and ($ts|floor) == $ts' >/dev/null 2>&1; then
  echo "ERROR: --enrolled-at-ms must be a positive integer epoch milliseconds value" >&2
  exit 1
fi

if ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SEC" -lt 5 ]]; then
  echo "ERROR: --interval-sec must be an integer >= 5" >&2
  exit 1
fi

if [[ -n "$GPS_LAT" || -n "$GPS_LON" ]]; then
  if [[ -z "$GPS_LAT" || -z "$GPS_LON" ]]; then
    echo "ERROR: --lat and --lon must be provided together" >&2
    exit 1
  fi
  if ! jq -en --argjson lat "$GPS_LAT" '$lat >= -90 and $lat <= 90' >/dev/null 2>&1; then
    echo "ERROR: --lat must be a number in [-90, 90]" >&2
    exit 1
  fi
  if ! jq -en --argjson lon "$GPS_LON" '$lon >= -180 and $lon <= 180' >/dev/null 2>&1; then
    echo "ERROR: --lon must be a number in [-180, 180]" >&2
    exit 1
  fi
fi

if [[ -n "$GPS_ALT_M" ]] && ! jq -en --argjson alt "$GPS_ALT_M" '$alt == $alt' >/dev/null 2>&1; then
  echo "ERROR: --alt-m must be numeric" >&2
  exit 1
fi

if [[ -n "$BATTERY_PCT" ]] && ! jq -en --argjson battery "$BATTERY_PCT" '$battery >= 0 and $battery <= 100' >/dev/null 2>&1; then
  echo "ERROR: --battery-pct must be a number in [0, 100]" >&2
  exit 1
fi

if [[ -n "$VOLTAGE_V" ]] && ! jq -en --argjson voltage "$VOLTAGE_V" '$voltage > 0' >/dev/null 2>&1; then
  echo "ERROR: --voltage-v must be a positive number" >&2
  exit 1
fi

if [[ -n "$SNR_DB" ]] && ! jq -en --argjson snr "$SNR_DB" '$snr == $snr' >/dev/null 2>&1; then
  echo "ERROR: --snr-db must be numeric" >&2
  exit 1
fi

if [[ -n "$RSSI_DBM" ]] && ! jq -en --argjson rssi "$RSSI_DBM" '$rssi == $rssi' >/dev/null 2>&1; then
  echo "ERROR: --rssi-dbm must be numeric" >&2
  exit 1
fi

publish_presence() {
  local reason="$1"
  local disconnect_reason="$2"
  local timestamp_ms
  local has_gps has_gps_alt has_battery has_voltage has_power has_snr has_rssi has_radio
  timestamp_ms="$(( $(date +%s) * 1000 ))"

  has_gps=false
  has_gps_alt=false
  has_battery=false
  has_voltage=false
  has_power=false
  has_snr=false
  has_rssi=false
  has_radio=false

  if [[ -n "$GPS_LAT" && -n "$GPS_LON" ]]; then
    has_gps=true
  fi
  if [[ -n "$GPS_ALT_M" ]]; then
    has_gps_alt=true
  fi
  if [[ -n "$BATTERY_PCT" ]]; then
    has_battery=true
  fi
  if [[ -n "$VOLTAGE_V" ]]; then
    has_voltage=true
  fi
  if [[ "$has_battery" == true || "$has_voltage" == true ]]; then
    has_power=true
  fi
  if [[ -n "$SNR_DB" ]]; then
    has_snr=true
  fi
  if [[ -n "$RSSI_DBM" ]]; then
    has_rssi=true
  fi
  if [[ "$has_snr" == true || "$has_rssi" == true ]]; then
    has_radio=true
  fi

  payload="$(jq -cn \
    --arg reason "$reason" \
    --arg endpoint "$MESH_ENDPOINT" \
    --arg disconnect_reason "$disconnect_reason" \
    --arg device_id "$DEVICE_ID" \
    --arg hardware_serial "$HARDWARE_SERIAL" \
    --arg certificate_serial "$CERTIFICATE_SERIAL" \
    --argjson trust_score "$TRUST_SCORE" \
    --argjson enrolled_at "$ENROLLED_AT_MS" \
    --argjson timestamp "$timestamp_ms" \
    --argjson tpm_backed "$TPM_BACKED_NORMALIZED" \
    --argjson has_gps "$has_gps" \
    --argjson has_gps_alt "$has_gps_alt" \
    --argjson has_power "$has_power" \
    --argjson has_battery "$has_battery" \
    --argjson has_voltage "$has_voltage" \
    --argjson has_radio "$has_radio" \
    --argjson has_snr "$has_snr" \
    --argjson has_rssi "$has_rssi" \
    --arg gps_lat "$GPS_LAT" \
    --arg gps_lon "$GPS_LON" \
    --arg gps_alt_m "$GPS_ALT_M" \
    --arg battery_pct "$BATTERY_PCT" \
    --arg voltage_v "$VOLTAGE_V" \
    --arg snr_db "$SNR_DB" \
    --arg rssi_dbm "$RSSI_DBM" \
    '{
      type: "RALPHIE_PRESENCE",
      reason: $reason,
      timestamp: $timestamp,
      endpoint: $endpoint,
      last_disconnect_reason: $disconnect_reason,
      identity: {
        device_id: $device_id,
        hardware_serial: $hardware_serial,
        certificate_serial: $certificate_serial,
        trust_score: $trust_score,
        enrolled_at: $enrolled_at,
        tpm_backed: $tpm_backed
      }
    }
    | if $has_gps then
        .telemetry = (.telemetry // {})
        | .telemetry.gps = (
            {
              lat: ($gps_lat | tonumber),
              lon: ($gps_lon | tonumber)
            }
            + (if $has_gps_alt then { alt_m: ($gps_alt_m | tonumber) } else {} end)
          )
      else
        .
      end
    | if $has_power then
        .telemetry = (.telemetry // {})
        | .telemetry.power = (
            (if $has_battery then { battery_pct: ($battery_pct | tonumber) } else {} end)
            + (if $has_voltage then { voltage_v: ($voltage_v | tonumber) } else {} end)
          )
      else
        .
      end
    | if $has_radio then
        .telemetry = (.telemetry // {})
        | .telemetry.radio = (
            (if $has_snr then { snr_db: ($snr_db | tonumber) } else {} end)
            + (if $has_rssi then { rssi_dbm: ($rssi_dbm | tonumber) } else {} end)
          )
      else
        .
      end
    | if (.telemetry | type == "object" and (.telemetry | length == 0)) then del(.telemetry) else . end
    ')"

  status_code="$(curl -sS -o /tmp/aethercore-heltech-presence-response.json \
    -w "%{http_code}" \
    -H 'Content-Type: application/json' \
    -X POST \
    --data "$payload" \
    "${GATEWAY_HTTP%/}/ralphie/presence" || true)"

  echo "publish reason=${reason} status=${status_code}"
  if [[ "$status_code" != "202" ]]; then
    echo "ERROR: presence publish failed (HTTP ${status_code})" >&2
    if [[ -f /tmp/aethercore-heltech-presence-response.json ]]; then
      cat /tmp/aethercore-heltech-presence-response.json >&2 || true
      echo >&2
    fi
    return 1
  fi

  cat /tmp/aethercore-heltech-presence-response.json
  echo
}

verify_snapshot_contains_device() {
  if [[ "$VERIFY_SNAPSHOT" -ne 1 ]]; then
    return 0
  fi

  if [[ ! -d "$WS_MODULE" && ! -f "$WS_MODULE/index.js" ]]; then
    echo "WARN: cannot verify snapshot; ws module missing at $WS_MODULE"
    return 0
  fi

  WS_MODULE="$WS_MODULE" DEVICE_ID="$DEVICE_ID" GATEWAY_HTTP="$GATEWAY_HTTP" node - <<'NODE'
const WebSocket = require(process.env.WS_MODULE);
const id = process.env.DEVICE_ID;
const wsUrl = process.env.GATEWAY_HTTP.replace(/^http/, 'ws');
const ws = new WebSocket(wsUrl);
let done = false;
const timeout = setTimeout(() => {
  if (!done) {
    console.error(`WARN: no snapshot confirmation for ${id} within timeout`);
    process.exit(0);
  }
}, 5000);

ws.on('open', () => {
  console.log(`verify ws_open ${wsUrl}`);
});

ws.on('message', (buf) => {
  try {
    const msg = JSON.parse(String(buf));
    if (msg?.type === 'RALPHIE_PRESENCE' && msg?.data?.identity?.device_id === id) {
      done = true;
      clearTimeout(timeout);
      console.log(`verify live_presence ${id}`);
      process.exit(0);
    }
    if (msg?.type === 'RALPHIE_PRESENCE_SNAPSHOT' && Array.isArray(msg.nodes)) {
      const found = msg.nodes.some((n) => n?.identity?.device_id === id);
      if (found) {
        done = true;
        clearTimeout(timeout);
        console.log(`verify snapshot_presence ${id}`);
        process.exit(0);
      }
    }
  } catch {
    // Ignore non-JSON frames.
  }
});

ws.on('error', (err) => {
  done = true;
  clearTimeout(timeout);
  console.error(`WARN: snapshot verify websocket error: ${err.message}`);
  process.exit(0);
});
NODE
}

echo "Heltech bridge config:"
echo "  device_id=$DEVICE_ID"
echo "  hardware_serial=$HARDWARE_SERIAL"
echo "  certificate_serial=$CERTIFICATE_SERIAL"
echo "  trust_score=$TRUST_SCORE"
echo "  tpm_backed=$TPM_BACKED"
echo "  mesh_endpoint=$MESH_ENDPOINT"
echo "  gateway_http=$GATEWAY_HTTP"
echo "  interval_sec=$INTERVAL_SEC"
if [[ -n "$GPS_LAT" && -n "$GPS_LON" ]]; then
  echo "  gps=${GPS_LAT},${GPS_LON} alt_m=${GPS_ALT_M:-n/a}"
fi
if [[ -n "$BATTERY_PCT" || -n "$VOLTAGE_V" ]]; then
  echo "  power=battery_pct=${BATTERY_PCT:-n/a} voltage_v=${VOLTAGE_V:-n/a}"
fi
if [[ -n "$SNR_DB" || -n "$RSSI_DBM" ]]; then
  echo "  radio=snr_db=${SNR_DB:-n/a} rssi_dbm=${RSSI_DBM:-n/a}"
fi
echo

publish_presence "startup" "heltech_bridge_startup"
verify_snapshot_contains_device

if [[ "$ONESHOT" -eq 1 ]]; then
  echo "DONE: oneshot presence published"
  exit 0
fi

echo "Starting heartbeat loop. Press Ctrl+C to stop."
while true; do
  sleep "$INTERVAL_SEC"
  publish_presence "heartbeat" "heltech_bridge_heartbeat"
done
