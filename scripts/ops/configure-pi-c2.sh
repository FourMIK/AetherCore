#!/usr/bin/env bash
set -euo pipefail

PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
WS_URL="ws://${MAC_IP}:3000"
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

echo "Configuring Pi endpoint on ${PI_SSH} -> ${WS_URL}"

ssh_pi "sudo mkdir -p /etc/systemd/system/coderalphie.service.d"
ssh_pi "cat <<'EOF' | sudo tee /etc/systemd/system/coderalphie.service.d/override.conf >/dev/null
[Service]
Environment=\"C2_WS_URL=${WS_URL}\"
EOF"
ssh_pi "sudo systemctl daemon-reload && sudo systemctl reset-failed coderalphie || true"
if ! ssh_pi "sudo systemctl restart coderalphie"; then
  echo "WARN: restart failed; collecting recent coderalphie logs..." >&2
  ssh_pi "sudo systemctl status coderalphie --no-pager -l || true"
  ssh_pi "sudo journalctl -u coderalphie -n 120 --no-pager -l || true"
  exit 1
fi
ssh_pi "sudo systemctl is-active coderalphie >/dev/null"
ssh_pi "sudo systemctl show coderalphie -p Environment --no-pager"

echo "DONE: Pi override applied"
