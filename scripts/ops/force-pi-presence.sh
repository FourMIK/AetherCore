#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
IDENTITY_PATH="${3:-/etc/coderalphie/keys/identity.json}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-$HOME/.ssh/cm-aethercore-%C}"
SSH_CONTROL_DIR="$(dirname "$SSH_CONTROL_PATH")"
mkdir -p "$SSH_CONTROL_DIR"
SSH_OPTS=(
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o ControlPath="$SSH_CONTROL_PATH"
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
)

ssh_pi() {
  ssh "${SSH_OPTS[@]}" "$PI_SSH" "$@"
}

echo "== Step 1/2: Force one presence POST from Pi (${PI_SSH}) =="
ssh_pi "set -euo pipefail
if ! command -v jq >/dev/null 2>&1; then
  echo 'ERROR: jq is required on Pi' >&2
  exit 1
fi
if ! sudo test -f '$IDENTITY_PATH'; then
  echo 'ERROR: identity file missing: $IDENTITY_PATH' >&2
  echo 'INFO: available files under /etc/coderalphie/keys (if accessible):' >&2
  sudo ls -la /etc/coderalphie/keys 2>/dev/null || true
  exit 1
fi
payload=\$(sudo jq -c --arg c2 'ws://${MAC_IP}:3000' '
{
  type: \"RALPHIE_PRESENCE\",
  reason: \"heartbeat\",
  timestamp: (now * 1000 | floor),
  endpoint: \$c2,
  last_disconnect_reason: \"manual_probe\",
  identity: {
    device_id: .device_id,
    hardware_serial: .hardware_serial,
    certificate_serial: .certificate_serial,
    trust_score: .trust_score,
    enrolled_at: .enrolled_at,
    tpm_backed: .tpm_backed
  }
}' '$IDENTITY_PATH')
echo \"payload_device_id=\$(echo \"\$payload\" | jq -r '.identity.device_id')\"
curl -sS -D - -o /tmp/coderalphie-presence-response.txt \
  -H 'Content-Type: application/json' \
  --data \"\$payload\" \
  \"http://${MAC_IP}:3000/ralphie/presence\"
echo '--- response body ---'
cat /tmp/coderalphie-presence-response.txt
"

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
