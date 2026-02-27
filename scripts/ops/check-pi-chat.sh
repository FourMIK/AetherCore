#!/usr/bin/env bash
set -euo pipefail

PI_DEVICE_ID="${1:-ralphie-0c50c470c43baf5f}"
MESSAGE_TEXT="${2:-hello from commander test}"
WAIT_SECONDS="${WAIT_SECONDS:-12}"
GATEWAY_WS="${GATEWAY_WS:-ws://127.0.0.1:3000}"
OPERATOR_ID="${OPERATOR_ID:-operator-chat-check}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WS_MODULE_PATH="$ROOT_DIR/services/gateway/node_modules/ws"

if ! [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$WAIT_SECONDS" -lt 3 ]]; then
  echo "ERROR: WAIT_SECONDS must be an integer >= 3" >&2
  exit 1
fi

echo "== Chat check parameters =="
echo "gateway_ws=$GATEWAY_WS"
echo "operator_id=$OPERATOR_ID"
echo "pi_device_id=$PI_DEVICE_ID"
echo "message=$MESSAGE_TEXT"
echo "wait_seconds=$WAIT_SECONDS"
echo

PI_DEVICE_ID="$PI_DEVICE_ID" \
MESSAGE_TEXT="$MESSAGE_TEXT" \
WAIT_SECONDS="$WAIT_SECONDS" \
GATEWAY_WS="$GATEWAY_WS" \
OPERATOR_ID="$OPERATOR_ID" \
WS_MODULE_PATH="$WS_MODULE_PATH" \
node - <<'NODE'
const crypto = require('node:crypto');
const WebSocket = require(process.env.WS_MODULE_PATH);

const piDeviceId = process.env.PI_DEVICE_ID;
const messageText = process.env.MESSAGE_TEXT;
const waitSeconds = Number(process.env.WAIT_SECONDS || '12');
const gatewayWs = process.env.GATEWAY_WS || 'ws://127.0.0.1:3000';
const operatorId = process.env.OPERATOR_ID || 'operator-chat-check';

function envelope(type, from, payload) {
  return {
    schema_version: '1.0',
    message_id: crypto.randomUUID(),
    timestamp: Date.now(),
    type,
    from,
    payload,
    signature: `placeholder:sha256:${crypto.randomBytes(32).toString('hex')}`,
  };
}

let sawAck = false;
let sawReply = false;
let ackReason = '';
const ws = new WebSocket(gatewayWs);

ws.on('open', () => {
  console.log('ws_open');

  ws.send(
    JSON.stringify(
      envelope('presence', operatorId, {
        status: 'online',
        trustScore: 1,
        role: 'operator',
        callsign: 'CHAT-CHECK',
        name: 'Chat Check Operator',
        verified: true,
      }),
    ),
  );

  setTimeout(() => {
    ws.send(
      JSON.stringify(
        envelope('chat', operatorId, {
          recipientId: piDeviceId,
          content: messageText,
          encrypted: true,
        }),
      ),
    );
    console.log(`chat_sent recipient=${piDeviceId}`);
  }, 300);
});

ws.on('message', (buf) => {
  const text = String(buf);
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }

  if (msg.type === 'ack') {
    const delivered = msg.payload?.delivered === true;
    ackReason = String(msg.payload?.reason || '');
    console.log(`ack delivered=${delivered} reason=${msg.payload?.reason || 'none'}`);
    if (delivered) {
      sawAck = true;
    }
    return;
  }

  if (msg.type === 'chat') {
    const from = msg.from || 'unknown';
    const content = msg.payload?.content || '';
    console.log(`chat_rx from=${from} content=${content}`);
    if (from === piDeviceId) {
      sawReply = true;
    }
    return;
  }
});

ws.on('error', (err) => {
  console.error(`ws_error ${err.message}`);
  process.exit(2);
});

setTimeout(() => {
  ws.close();
  if (!sawAck) {
    if (ackReason === 'recipient_offline') {
      console.error(
        'HINT: recipient is offline at gateway session layer. Ensure coderalphie.service is active and connected over websocket (not only /ralphie/presence HTTP).',
      );
    }
    console.error('FAIL: no delivered ACK from gateway');
    process.exit(3);
  }
  if (!sawReply) {
    console.error('WARN: no chat reply from Pi within timeout (enable CODERALPHIE_AUTO_REPLY=1 for auto-response)');
    process.exit(4);
  }
  console.log('PASS: Pi chat receive/reply path verified');
  process.exit(0);
}, waitSeconds * 1000);
NODE
