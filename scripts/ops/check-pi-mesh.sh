#!/usr/bin/env bash
set -euo pipefail

PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
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

echo "== Pi service env (${PI_SSH}) =="
ssh_pi "sudo systemctl show coderalphie -p Environment --no-pager"

echo
echo "== Pi override file =="
ssh_pi "sudo systemctl cat coderalphie --no-pager | sed -n '/\\[Service\\]/,/\\[Install\\]/p' | egrep -i 'C2_WS_URL|TPM2TOOLS_TCTI|NODE_ENV|AETHERCORE_PRODUCTION' || true"

echo
echo "== Pi -> Mac TCP reachability (${MAC_IP}:3000) =="
ssh_pi "nc -vz ${MAC_IP} 3000"

echo
echo "== Pi coderalphie logs (last 5m) =="
ssh_pi "sudo journalctl -u coderalphie --since '10 min ago' -l --no-pager | egrep -i 'Connecting to C2 mesh at|Reachable|Unreachable|Reprobe|Presence startup|Presence heartbeat|Presence publish failed|presence_post_failed|presence_post_timeout' || true"

echo
echo "DONE: pi mesh checks complete"
