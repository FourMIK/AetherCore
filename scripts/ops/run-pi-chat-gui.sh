#!/usr/bin/env bash
set -euo pipefail

PI_SSH="${1:-duskone@192.168.1.125}"
REMOTE_USER="${REMOTE_USER:-ralphie}"
REMOTE_BIN="${REMOTE_BIN:-/usr/local/bin/coderalphie-chat-gui}"
REMOTE_ARGS="${REMOTE_ARGS:---no-open}"
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

exec ssh -t "${SSH_OPTS[@]}" "$PI_SSH" \
  "REMOTE_USER='${REMOTE_USER}' REMOTE_BIN='${REMOTE_BIN}' REMOTE_ARGS='${REMOTE_ARGS}' bash -lc '
set -euo pipefail

c2_ws_url=\"\$(systemctl show coderalphie --property=Environment --value 2>/dev/null \
  | tr \" \" \"\n\" \
  | sed -n \"s/^C2_WS_URL=//p\" \
  | tail -n 1)\"

if [[ -z \"\${c2_ws_url}\" && -f /etc/systemd/system/coderalphie.service.d/override.conf ]]; then
  c2_ws_url=\"\$(sed -n \"s/.*C2_WS_URL=\\([^\\\" ]*\\).*/\\1/p\" /etc/systemd/system/coderalphie.service.d/override.conf | tail -n 1)\"
fi

if [[ -n \"\${c2_ws_url}\" ]]; then
  echo \"Launching chat GUI with C2_WS_URL=\${c2_ws_url}\"
  exec sudo -u \"\${REMOTE_USER}\" env C2_WS_URL=\"\${c2_ws_url}\" \"\${REMOTE_BIN}\" \${REMOTE_ARGS}
fi

echo \"WARN: C2_WS_URL not found from coderalphie service. Falling back to GUI defaults.\"
exec sudo -u \"\${REMOTE_USER}\" \"\${REMOTE_BIN}\" \${REMOTE_ARGS}
'"
