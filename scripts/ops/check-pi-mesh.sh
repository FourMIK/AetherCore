#!/usr/bin/env bash
set -euo pipefail

PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"
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

echo "== Pi service env (${PI_SSH}) =="
ssh_pi "MAC_IP='$MAC_IP' bash -s" <<'EOF'
set -euo pipefail

sudo systemctl show coderalphie -p Environment --no-pager
MAIN_PID="$(sudo systemctl show coderalphie -p MainPID --value)"
echo "MainPID=${MAIN_PID}"
if [[ -n "$MAIN_PID" && "$MAIN_PID" != "0" ]]; then
  echo
  echo "== Pi live process env =="
  sudo bash -c "if [[ -r /proc/${MAIN_PID}/environ ]]; then tr '\0' '\n' < /proc/${MAIN_PID}/environ | egrep -i '^(C2_WS_URL|C2_SERVER|C2_PORT|ENROLLMENT_URL|ENROLLMENT_CA_CERT_PATH|TPM2TOOLS_TCTI|NODE_ENV|AETHERCORE_PRODUCTION|CODERALPHIE_CHAT_SIGNING_KEY_PATH|AETHERCORE_SIGNING_PRIVATE_KEY_PATH)=' || true; fi"
fi

echo
echo "== Pi override file =="
sudo systemctl cat coderalphie --no-pager \
  | sed -n '/\[Service\]/,/\[Install\]/p' \
  | egrep -i 'C2_WS_URL|C2_SERVER|C2_PORT|ENROLLMENT_URL|ENROLLMENT_CA_CERT_PATH|TPM2TOOLS_TCTI|NODE_ENV|AETHERCORE_PRODUCTION|CODERALPHIE_CHAT_SIGNING_KEY_PATH|AETHERCORE_SIGNING_PRIVATE_KEY_PATH' || true

echo
echo "== Pi -> Mac TCP reachability (${MAC_IP}:3000) =="
nc -vz "${MAC_IP}" 3000

echo
echo "== Pi coderalphie logs (last 5m) =="
sudo journalctl -u coderalphie --since '10 min ago' -l --no-pager \
  | egrep -i 'Connecting to C2 mesh at|Reachable|Unreachable|Reprobe|Presence startup|Presence heartbeat|Presence publish failed|presence_post_failed|presence_post_timeout' || true
EOF

echo
echo "DONE: pi mesh checks complete"
