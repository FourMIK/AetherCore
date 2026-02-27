#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_SSH="${1:-duskone@192.168.1.125}"
GUI_BIN_PATH="${2:-$ROOT_DIR/agent/linux/dist/coderalphie-chat-gui-linux-arm64}"
REMOTE_TMP="/tmp/coderalphie-chat-gui-linux-arm64"
REMOTE_BIN="/usr/local/bin/coderalphie-chat-gui"
REMOTE_LAUNCHER="/usr/local/bin/coderalphie-chat-gui-launch"
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

if [[ ! -f "$GUI_BIN_PATH" ]]; then
  echo "ERROR: GUI binary not found: $GUI_BIN_PATH" >&2
  echo "Build first: pnpm --dir agent/linux build:chat:gui" >&2
  exit 1
fi

echo "Deploying Pi chat GUI to ${PI_SSH}"
echo "local_bin=$GUI_BIN_PATH"
echo "remote_bin=$REMOTE_BIN"
echo

scp "${SSH_OPTS[@]}" "$GUI_BIN_PATH" "${PI_SSH}:${REMOTE_TMP}"
ssh "${SSH_OPTS[@]}" "$PI_SSH" "sudo install -m 755 '$REMOTE_TMP' '$REMOTE_BIN'"
ssh "${SSH_OPTS[@]}" "$PI_SSH" "sudo mkdir -p /opt/coderalphie/chat && sudo chown ${REMOTE_USER}:${REMOTE_USER} /opt/coderalphie/chat"

ssh "${SSH_OPTS[@]}" "$PI_SSH" "sudo bash -lc '
set -euo pipefail
cat > \"${REMOTE_LAUNCHER}\" <<\"EOF\"
#!/usr/bin/env bash
set -euo pipefail

log_file=\"/tmp/coderalphie-chat-gui.log\"

c2_ws_url=\"\$(systemctl show coderalphie --property=Environment --value 2>/dev/null \
  | tr \" \" \"\n\" \
  | sed -n \"s/^C2_WS_URL=//p\" \
  | tail -n 1)\"

if [[ -z \"\${c2_ws_url}\" && -f /etc/systemd/system/coderalphie.service.d/override.conf ]]; then
  c2_ws_url=\"\$(sed -n \"s/.*C2_WS_URL=\\([^\\\" ]*\\).*/\\1/p\" /etc/systemd/system/coderalphie.service.d/override.conf | tail -n 1)\"
fi

run_target=(${REMOTE_BIN})
if [[ -n \"\${c2_ws_url}\" ]]; then
  run_target=(env C2_WS_URL=\"\${c2_ws_url}\" ${REMOTE_BIN})
fi

if [[ -t 1 ]]; then
  exec \"\${run_target[@]}\" \"\$@\"
fi

{
  echo \"[\$(date -Iseconds)] launch start\"
  echo \"[\$(date -Iseconds)] endpoint=\${c2_ws_url:-default_from_config}\"
} >> \"\${log_file}\"
exec \"\${run_target[@]}\" \"\$@\" >> \"\${log_file}\" 2>&1
EOF
chmod 755 \"${REMOTE_LAUNCHER}\"

desktop_file=\"/home/${REMOTE_USER}/.local/share/applications/coderalphie-chat-gui.desktop\"
desktop_shortcut=\"/home/${REMOTE_USER}/Desktop/CodeRalphie Chat GUI.desktop\"
mkdir -p \"/home/${REMOTE_USER}/.local/share/applications\" \"/home/${REMOTE_USER}/Desktop\"
cat > \"\${desktop_file}\" <<\"EOF\"
[Desktop Entry]
Type=Application
Name=CodeRalphie Chat GUI
Comment=Pi-side authenticated messaging client
Exec=${REMOTE_LAUNCHER}
TryExec=${REMOTE_LAUNCHER}
Path=/home/${REMOTE_USER}
Terminal=false
Categories=Network;Chat;
Icon=applications-internet
StartupNotify=true
EOF
cp \"\${desktop_file}\" \"\${desktop_shortcut}\"
chown ${REMOTE_USER}:${REMOTE_USER} \"\${desktop_file}\" \"\${desktop_shortcut}\"
chmod 755 \"\${desktop_file}\" \"\${desktop_shortcut}\"
'"

ssh "${SSH_OPTS[@]}" "$PI_SSH" "ls -l '$REMOTE_BIN'"

echo
echo "DONE: chat GUI deployed"
echo
echo "Run from Pi terminal:"
echo "  ${REMOTE_LAUNCHER}"
echo
echo "Or from this repo (recommended endpoint auto-pass):"
echo "  ./scripts/ops/run-pi-chat-gui.sh ${PI_SSH}"
echo
echo "Desktop launcher installed:"
echo "  /home/${REMOTE_USER}/Desktop/CodeRalphie Chat GUI.desktop"
