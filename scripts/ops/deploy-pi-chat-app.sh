#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_SSH="${1:-duskone@192.168.1.125}"
CHAT_BIN_PATH="${2:-$ROOT_DIR/agent/linux/dist/coderalphie-chat-linux-arm64}"
REMOTE_TMP="/tmp/coderalphie-chat-linux-arm64"
REMOTE_BIN="/usr/local/bin/coderalphie-chat"
REMOTE_USER="${REMOTE_USER:-ralphie}"
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

if [[ ! -f "$CHAT_BIN_PATH" ]]; then
  echo "ERROR: chat binary not found: $CHAT_BIN_PATH" >&2
  echo "Build first: pnpm --dir agent/linux build:chat" >&2
  exit 1
fi

echo "Deploying Pi chat app to ${PI_SSH}"
echo "local_bin=$CHAT_BIN_PATH"
echo "remote_bin=$REMOTE_BIN"
echo

scp "${SSH_OPTS[@]}" "$CHAT_BIN_PATH" "${PI_SSH}:${REMOTE_TMP}"
ssh "${SSH_OPTS[@]}" "$PI_SSH" "sudo install -m 755 '$REMOTE_TMP' '$REMOTE_BIN'"
ssh "${SSH_OPTS[@]}" "$PI_SSH" "sudo mkdir -p /opt/coderalphie/chat && sudo chown ${REMOTE_USER}:${REMOTE_USER} /opt/coderalphie/chat"
ssh "${SSH_OPTS[@]}" "$PI_SSH" "ls -l '$REMOTE_BIN'"

echo
echo "DONE: chat app deployed"
echo
echo "Launch interactive app:"
echo "  ./scripts/ops/run-pi-chat.sh ${PI_SSH}"
echo "  # run-pi-chat.sh reads C2_WS_URL from coderalphie systemd env and passes it through"
