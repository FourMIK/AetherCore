#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
IDENTITY_PATH="${3:-/etc/coderalphie/keys/identity.json}"
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

echo "== Step 1/2: Force one presence POST from Pi (${PI_SSH}) =="
ssh_pi "IDENTITY_PATH='$IDENTITY_PATH' MAC_IP='$MAC_IP' bash -s" <<'EOF'
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required on Pi" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required on Pi" >&2
  exit 1
fi
if ! sudo test -f "$IDENTITY_PATH"; then
  echo "ERROR: identity file missing: $IDENTITY_PATH" >&2
  echo "INFO: available files under /etc/coderalphie/keys (if accessible):" >&2
  sudo ls -la /etc/coderalphie/keys 2>/dev/null || true
  exit 1
fi

service_env="$(sudo systemctl show coderalphie -p Environment --value --no-pager 2>/dev/null || true)"
pi_signing_key_path="$(
  printf '%s\n' "$service_env" \
    | tr ' ' '\n' \
    | sed -n 's/^CODERALPHIE_CHAT_SIGNING_KEY_PATH=//p' \
    | tail -n 1
)"
pi_signing_key_fallback_path="$(
  printf '%s\n' "$service_env" \
    | tr ' ' '\n' \
    | sed -n 's/^AETHERCORE_SIGNING_PRIVATE_KEY_PATH=//p' \
    | tail -n 1
)"
if [[ -z "$pi_signing_key_path" ]]; then
  pi_signing_key_path="/etc/coderalphie/keys/signing-private.pem"
fi
if [[ -z "$pi_signing_key_fallback_path" ]]; then
  pi_signing_key_fallback_path="/tmp/ralphie_dev.key"
fi

payload="$(
  sudo -u ralphie \
    IDENTITY_PATH="$IDENTITY_PATH" \
    MAC_IP="$MAC_IP" \
    CODERALPHIE_CHAT_SIGNING_KEY_PATH="$pi_signing_key_path" \
    AETHERCORE_SIGNING_PRIVATE_KEY_PATH="$pi_signing_key_fallback_path" \
    node - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = stableJsonValue(value[key]);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableJsonValue(value));
}

const identityPath = process.env.IDENTITY_PATH;
const macIp = process.env.MAC_IP;
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));

const keyCandidates = [
  process.env.CODERALPHIE_CHAT_SIGNING_KEY_PATH,
  process.env.AETHERCORE_SIGNING_PRIVATE_KEY_PATH,
  '/etc/coderalphie/keys/signing-private.pem',
  '/etc/coderalphie/keys/ed25519-private.pem',
  '/tmp/ralphie_dev.key',
].filter((value) => typeof value === 'string' && value.length > 0);

let signingKeyPath = null;
for (const candidate of keyCandidates) {
  if (fs.existsSync(candidate)) {
    signingKeyPath = candidate;
    break;
  }
}

if (!signingKeyPath) {
  const preferredWritePath = keyCandidates[0] || '/tmp/ralphie_dev.key';
  signingKeyPath = preferredWritePath;
  const keyDir = path.dirname(signingKeyPath);
  fs.mkdirSync(keyDir, { recursive: true });
  const generated = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.writeFileSync(signingKeyPath, generated.privateKey, { mode: 0o600 });
}

const privateKeyPem = fs.readFileSync(signingKeyPath, 'utf-8');
const privateKey = crypto.createPrivateKey(privateKeyPem);
const publicKeyPem = crypto
  .createPublicKey(privateKey)
  .export({ type: 'spki', format: 'pem' })
  .toString();

const payload = {
  type: 'RALPHIE_PRESENCE',
  reason: 'heartbeat',
  timestamp: Date.now(),
  endpoint: `ws://${macIp}:3000`,
  last_disconnect_reason: 'manual_probe',
  identity: {
    device_id: String(identity.device_id ?? 'ralphie-unknown'),
    public_key: publicKeyPem,
    hardware_serial: String(identity.hardware_serial ?? identity.device_id ?? 'unknown'),
    certificate_serial: String(identity.certificate_serial ?? `ralphie-${Date.now()}`),
    trust_score: typeof identity.trust_score === 'number' ? identity.trust_score : 0.5,
    enrolled_at: Number.isFinite(identity.enrolled_at) ? identity.enrolled_at : Date.now(),
    tpm_backed: Boolean(identity.tpm_backed),
  },
};

const canonicalPayload = stableStringify(payload);
const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey).toString('hex');

process.stdout.write(
  JSON.stringify({
    ...payload,
    signature,
  }),
);
NODE
)"

echo "payload_device_id=$(echo "$payload" | jq -r '.identity.device_id')"
echo "payload_signature_len=$(echo "$payload" | jq -r '.signature | length')"

curl -sS -D - -o /tmp/coderalphie-presence-response.txt \
  -H 'Content-Type: application/json' \
  --data "$payload" \
  "http://${MAC_IP}:3000/ralphie/presence"

echo '--- response body ---'
cat /tmp/coderalphie-presence-response.txt
EOF

echo
echo "== Step 2/2: Verify snapshot on local gateway ws://127.0.0.1:3000 =="
node - <<'NODE'
const WebSocket = require('/Users/duskone/Downloads/AetherCore-0.2.3-field-test/services/gateway/node_modules/ws');
const ws = new WebSocket('ws://127.0.0.1:3000');
const deadlineMs = 8000;
const startedAt = Date.now();
let sawSnapshot = false;

ws.on('open', () => {
  console.log('ws_open');
});

ws.on('message', (buf) => {
  const text = String(buf);
  console.log(text);
  try {
    const msg = JSON.parse(text);
    if (msg?.type === 'RALPHIE_PRESENCE_SNAPSHOT') {
      sawSnapshot = true;
      const ids = Array.isArray(msg.nodes)
        ? msg.nodes.map((n) => n?.identity?.device_id).filter(Boolean)
        : [];
      console.log('snapshot_node_ids=' + ids.join(','));
      process.exit(0);
    }
  } catch {
    // Ignore non-JSON frames.
  }
});

ws.on('error', (err) => {
  console.error('ws_error', err.message);
  process.exit(2);
});

setTimeout(() => {
  if (!sawSnapshot) {
    console.error('ERROR: no RALPHIE_PRESENCE_SNAPSHOT within ' + (Date.now() - startedAt) + 'ms');
    process.exit(3);
  }
}, deadlineMs);
NODE

echo
echo "DONE: forced presence probe completed"
