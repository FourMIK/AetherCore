#!/usr/bin/env bash
set -euo pipefail

PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
PI_C2_WS_URL="${3:-${PI_C2_WS_URL:-}}"
PI_ENDPOINT_PROFILE="${PI_ENDPOINT_PROFILE:-dev-local}"
PI_SIGNING_KEY_PATH="${PI_SIGNING_KEY_PATH:-/etc/coderalphie/keys/signing-private.pem}"
PI_SIGNING_KEY_FALLBACK_PATH="${PI_SIGNING_KEY_FALLBACK_PATH:-/tmp/ralphie_dev.key}"
PI_AETHERCORE_PRODUCTION="${PI_AETHERCORE_PRODUCTION:-}"
PI_ENROLLMENT_URL="${PI_ENROLLMENT_URL:-}"
PI_ENROLLMENT_CA_CERT_PATH="${PI_ENROLLMENT_CA_CERT_PATH:-/etc/coderalphie/ca/enrollment-ca.pem}"
PI_ENROLLMENT_CA_CERT_LOCAL_PATH="${PI_ENROLLMENT_CA_CERT_LOCAL_PATH:-}"
PI_ENROLLMENT_CA_CERT_B64="${PI_ENROLLMENT_CA_CERT_B64:-}"
PI_AWS_TESTBED_ALB_HOST="${PI_AWS_TESTBED_ALB_HOST:-aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com}"
PI_AWS_TESTBED_C2_WS_DEFAULT="${PI_AWS_TESTBED_C2_WS_DEFAULT:-wss://${PI_AWS_TESTBED_ALB_HOST}}"
PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT="${PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT:-https://${PI_AWS_TESTBED_ALB_HOST}/api/enrollment}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-$HOME/.ssh/cm-aethercore-%C}"
SSH_CONTROL_DIR="$(dirname "$SSH_CONTROL_PATH")"
mkdir -p "$SSH_CONTROL_DIR"
SSH_DISABLE_CONTROLMASTER="${SSH_DISABLE_CONTROLMASTER:-0}"
SSH_MODE="control"
if [[ "$SSH_DISABLE_CONTROLMASTER" == "1" ]]; then
  SSH_MODE="direct"
fi
SSH_COMMON_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o ConnectTimeout=10
)
SSH_CONTROL_OPTS=(
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o ControlPath="$SSH_CONTROL_PATH"
)
SSH_DIRECT_OPTS=(
  -o ControlMaster=no
  -o ControlPersist=no
  -o ControlPath=none
)

ssh_pi_exec() {
  local mode="$1"
  shift
  local -a opts=("${SSH_COMMON_OPTS[@]}")
  if [[ "$mode" == "control" ]]; then
    opts+=("${SSH_CONTROL_OPTS[@]}")
  else
    opts+=("${SSH_DIRECT_OPTS[@]}")
  fi
  ssh "${opts[@]}" "$PI_SSH" "$@"
}

ssh_pi() {
  local rc
  if [[ "$SSH_MODE" == "direct" ]]; then
    ssh_pi_exec "direct" "$@"
    return $?
  fi

  if ssh_pi_exec "control" "$@"; then
    return 0
  fi

  rc=$?
  echo "WARN: SSH multiplexed session failed for ${PI_SSH} (exit ${rc}); retrying without ControlMaster." >&2
  SSH_MODE="direct"
  ssh_pi_exec "direct" "$@"
}

normalize_prod_flag() {
  local value="${1:-}"
  shopt -s nocasematch
  case "$value" in
    1|true|yes|on)
      echo "1"
      ;;
    0|false|no|off|"")
      echo "0"
      ;;
    *)
      echo "ERROR: invalid PI_AETHERCORE_PRODUCTION value: ${value} (expected 0|1|true|false)" >&2
      exit 1
      ;;
  esac
  shopt -u nocasematch
}

validate_ws_url() {
  local value="$1"
  if [[ ! "$value" =~ ^wss?://[^[:space:]]+$ ]]; then
    echo "ERROR: invalid C2 websocket URL: ${value} (expected ws://... or wss://...)" >&2
    exit 1
  fi
}

case "$PI_ENDPOINT_PROFILE" in
  dev-local)
    if [[ -z "$PI_C2_WS_URL" ]]; then
      PI_C2_WS_URL="ws://${MAC_IP}:3000"
    fi
    if [[ -z "$PI_AETHERCORE_PRODUCTION" ]]; then
      PI_AETHERCORE_PRODUCTION="0"
    fi
    ;;
  prod-aws-testbed)
    if [[ -z "$PI_C2_WS_URL" ]]; then
      PI_C2_WS_URL="$PI_AWS_TESTBED_C2_WS_DEFAULT"
    fi
    if [[ -z "$PI_AETHERCORE_PRODUCTION" ]]; then
      PI_AETHERCORE_PRODUCTION="1"
    fi
    if [[ -z "$PI_ENROLLMENT_URL" ]]; then
      PI_ENROLLMENT_URL="$PI_AWS_TESTBED_ENROLLMENT_URL_DEFAULT"
    fi
    ;;
  *)
    echo "ERROR: unsupported PI_ENDPOINT_PROFILE=${PI_ENDPOINT_PROFILE} (supported: dev-local, prod-aws-testbed)" >&2
    exit 1
    ;;
esac

PI_AETHERCORE_PRODUCTION="$(normalize_prod_flag "$PI_AETHERCORE_PRODUCTION")"
validate_ws_url "$PI_C2_WS_URL"
WS_URL="$PI_C2_WS_URL"
WS_SCHEME="${WS_URL%%://*}"
WS_HOSTPORT_PATH="${WS_URL#*://}"
WS_HOSTPORT="${WS_HOSTPORT_PATH%%/*}"
if [[ "$WS_HOSTPORT" == *:* ]]; then
  C2_PORT_VALUE="${WS_HOSTPORT##*:}"
else
  if [[ "$WS_SCHEME" == "wss" ]]; then
    C2_PORT_VALUE="443"
  else
    C2_PORT_VALUE="80"
  fi
fi
if ! [[ "$C2_PORT_VALUE" =~ ^[0-9]+$ ]] || [[ "$C2_PORT_VALUE" -lt 1 ]] || [[ "$C2_PORT_VALUE" -gt 65535 ]]; then
  echo "ERROR: unable to derive valid C2 port from ${WS_URL}" >&2
  exit 1
fi

if [[ "$PI_ENDPOINT_PROFILE" == "prod-aws-testbed" && "$PI_AETHERCORE_PRODUCTION" != "1" ]]; then
  echo "ERROR: PI_ENDPOINT_PROFILE=${PI_ENDPOINT_PROFILE} requires PI_AETHERCORE_PRODUCTION=1" >&2
  exit 1
fi

if [[ "$PI_AETHERCORE_PRODUCTION" == "1" && "$WS_SCHEME" != "wss" ]]; then
  echo "WARN: production mode enabled with non-TLS C2 websocket URL: ${WS_URL}" >&2
fi

echo "Configuring Pi endpoint on ${PI_SSH} -> ${WS_URL}"
echo "Endpoint profile: ${PI_ENDPOINT_PROFILE}"
echo "Signing key path preference: ${PI_SIGNING_KEY_PATH} (fallback: ${PI_SIGNING_KEY_FALLBACK_PATH})"
echo "AETHERCORE_PRODUCTION override: ${PI_AETHERCORE_PRODUCTION}"
echo "Derived C2 port: ${C2_PORT_VALUE}"
if [[ -n "$PI_ENROLLMENT_URL" ]]; then
  echo "Enrollment URL override: ${PI_ENROLLMENT_URL}"
fi

if [[ -n "$PI_ENROLLMENT_CA_CERT_LOCAL_PATH" ]]; then
  if [[ ! -f "$PI_ENROLLMENT_CA_CERT_LOCAL_PATH" ]]; then
    echo "ERROR: PI_ENROLLMENT_CA_CERT_LOCAL_PATH not found: $PI_ENROLLMENT_CA_CERT_LOCAL_PATH" >&2
    exit 1
  fi
  PI_ENROLLMENT_CA_CERT_B64="$(base64 < "$PI_ENROLLMENT_CA_CERT_LOCAL_PATH" | tr -d '\n')"
fi

if [[ "$PI_AETHERCORE_PRODUCTION" == "1" ]]; then
  if [[ -z "$PI_ENROLLMENT_URL" ]]; then
    echo "WARN: production mode enabled without PI_ENROLLMENT_URL; enrollment may fail." >&2
  fi
  if [[ -z "$PI_ENROLLMENT_CA_CERT_B64" ]]; then
    echo "WARN: production mode enabled without a CA cert payload (PI_ENROLLMENT_CA_CERT_LOCAL_PATH or PI_ENROLLMENT_CA_CERT_B64)." >&2
  fi
fi

ssh_pi "WS_URL='$WS_URL' C2_PORT_VALUE='$C2_PORT_VALUE' PI_SIGNING_KEY_PATH='$PI_SIGNING_KEY_PATH' PI_SIGNING_KEY_FALLBACK_PATH='$PI_SIGNING_KEY_FALLBACK_PATH' PI_AETHERCORE_PRODUCTION='$PI_AETHERCORE_PRODUCTION' PI_ENROLLMENT_URL='$PI_ENROLLMENT_URL' PI_ENROLLMENT_CA_CERT_PATH='$PI_ENROLLMENT_CA_CERT_PATH' PI_ENROLLMENT_CA_CERT_B64='$PI_ENROLLMENT_CA_CERT_B64' bash -s" <<'EOF'
set -euo pipefail

sudo mkdir -p /etc/systemd/system/coderalphie.service.d
sudo mkdir -p /etc/coderalphie/keys
sudo chown ralphie:ralphie /etc/coderalphie/keys
sudo chmod 700 /etc/coderalphie/keys

if ! sudo test -f "$PI_SIGNING_KEY_PATH"; then
  if sudo test -f "$PI_SIGNING_KEY_FALLBACK_PATH"; then
    sudo install -m 600 -o ralphie -g ralphie "$PI_SIGNING_KEY_FALLBACK_PATH" "$PI_SIGNING_KEY_PATH"
  else
    sudo -u ralphie PI_SIGNING_KEY_PATH="$PI_SIGNING_KEY_PATH" node - <<'EONODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const keyPath = process.env.PI_SIGNING_KEY_PATH;
if (!keyPath) {
  process.exit(1);
}
const keyDir = path.dirname(keyPath);
fs.mkdirSync(keyDir, { recursive: true });
const generated = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(keyPath, generated.privateKey, { mode: 0o600 });
EONODE
  fi
fi

if ! sudo test -f "$PI_SIGNING_KEY_FALLBACK_PATH"; then
  sudo install -m 600 -o ralphie -g ralphie "$PI_SIGNING_KEY_PATH" "$PI_SIGNING_KEY_FALLBACK_PATH" || true
fi

sudo chown ralphie:ralphie "$PI_SIGNING_KEY_PATH" || true
sudo chmod 600 "$PI_SIGNING_KEY_PATH" || true
if sudo test -f "$PI_SIGNING_KEY_FALLBACK_PATH"; then
  sudo chown ralphie:ralphie "$PI_SIGNING_KEY_FALLBACK_PATH" || true
  sudo chmod 600 "$PI_SIGNING_KEY_FALLBACK_PATH" || true
fi

if [[ -n "$PI_ENROLLMENT_CA_CERT_B64" ]]; then
  if ! command -v base64 >/dev/null 2>&1; then
    echo "ERROR: base64 utility is required on Pi to install enrollment CA cert" >&2
    exit 1
  fi
  sudo mkdir -p "$(dirname "$PI_ENROLLMENT_CA_CERT_PATH")"
  printf '%s' "$PI_ENROLLMENT_CA_CERT_B64" | base64 --decode | sudo tee "$PI_ENROLLMENT_CA_CERT_PATH" >/dev/null
  sudo chown ralphie:ralphie "$PI_ENROLLMENT_CA_CERT_PATH"
  sudo chmod 600 "$PI_ENROLLMENT_CA_CERT_PATH"
fi

{
  echo "[Service]"
  echo "Environment=\"C2_WS_URL=${WS_URL}\""
  echo "Environment=\"C2_SERVER=${WS_URL}\""
  echo "Environment=\"C2_PORT=${C2_PORT_VALUE}\""
  echo "Environment=\"CODERALPHIE_CHAT_SIGNING_KEY_PATH=${PI_SIGNING_KEY_PATH}\""
  echo "Environment=\"AETHERCORE_SIGNING_PRIVATE_KEY_PATH=${PI_SIGNING_KEY_FALLBACK_PATH}\""
  echo "Environment=\"AETHERCORE_PRODUCTION=${PI_AETHERCORE_PRODUCTION}\""
  if [[ -n "$PI_ENROLLMENT_URL" ]]; then
    echo "Environment=\"ENROLLMENT_URL=${PI_ENROLLMENT_URL}\""
  fi
  if sudo test -f "$PI_ENROLLMENT_CA_CERT_PATH"; then
    echo "Environment=\"ENROLLMENT_CA_CERT_PATH=${PI_ENROLLMENT_CA_CERT_PATH}\""
  fi
} | sudo tee /etc/systemd/system/coderalphie.service.d/override.conf >/dev/null

sudo systemctl daemon-reload
sudo systemctl reset-failed coderalphie || true

if ! sudo systemctl restart coderalphie; then
  echo "WARN: restart failed; collecting recent coderalphie logs..." >&2
  sudo systemctl status coderalphie --no-pager -l || true
  sudo journalctl -u coderalphie -n 120 --no-pager -l || true
  exit 1
fi

sudo systemctl is-active coderalphie >/dev/null
sudo systemctl show coderalphie -p Environment --no-pager
MAIN_PID="$(sudo systemctl show coderalphie -p MainPID --value)"
echo "MainPID=${MAIN_PID}"
if [[ -n "$MAIN_PID" && "$MAIN_PID" != "0" ]]; then
  LIVE_ENV="$(sudo bash -c "if [[ -r /proc/${MAIN_PID}/environ ]]; then tr '\0' '\n' < /proc/${MAIN_PID}/environ; fi")"
  if [[ -n "$LIVE_ENV" ]]; then
    printf '%s\n' "$LIVE_ENV" \
      | egrep -i '^(C2_WS_URL|C2_SERVER|C2_PORT|AETHERCORE_PRODUCTION|ENROLLMENT_URL|ENROLLMENT_CA_CERT_PATH|CODERALPHIE_CHAT_SIGNING_KEY_PATH|AETHERCORE_SIGNING_PRIVATE_KEY_PATH)=' || true

    if ! printf '%s\n' "$LIVE_ENV" | grep -Fxq "C2_WS_URL=${WS_URL}"; then
      echo "ERROR: live coderalphie env did not apply expected C2_WS_URL=${WS_URL}" >&2
      exit 1
    fi
    if ! printf '%s\n' "$LIVE_ENV" | grep -Fxq "AETHERCORE_PRODUCTION=${PI_AETHERCORE_PRODUCTION}"; then
      echo "ERROR: live coderalphie env did not apply expected AETHERCORE_PRODUCTION=${PI_AETHERCORE_PRODUCTION}" >&2
      exit 1
    fi
    if ! printf '%s\n' "$LIVE_ENV" | grep -Fxq "C2_PORT=${C2_PORT_VALUE}"; then
      echo "ERROR: live coderalphie env did not apply expected C2_PORT=${C2_PORT_VALUE}" >&2
      exit 1
    fi
    if [[ -n "$PI_ENROLLMENT_URL" ]] && ! printf '%s\n' "$LIVE_ENV" | grep -Fxq "ENROLLMENT_URL=${PI_ENROLLMENT_URL}"; then
      echo "ERROR: live coderalphie env did not apply expected ENROLLMENT_URL=${PI_ENROLLMENT_URL}" >&2
      exit 1
    fi
  fi
fi
EOF

echo "DONE: Pi override applied"
