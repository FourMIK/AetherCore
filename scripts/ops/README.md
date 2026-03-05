# AetherCore Ops Toolkit

Repeatable local workflow scripts for Mac + Pi mesh validation.

## Scripts

### `scripts/ops/sync-endpoints.sh`
Normalizes local runtime config files to Commander-local defaults:
- API: `http://localhost:3000`
- Mesh: `ws://localhost:3000`
- Ports: `3000/3000`

### `scripts/ops/configure-pi-c2.sh`
Configures CodeRalphie systemd override on Pi:
- `C2_WS_URL=<ws://...|wss://...>` (default `ws://<MAC_IP>:3000` in `dev-local` profile)
- `AETHERCORE_PRODUCTION=<0|1>` with explicit mode/profile validation
- profile support:
  - `PI_ENDPOINT_PROFILE=dev-local` (default)
  - `PI_ENDPOINT_PROFILE=prod-aws-testbed` (defaults C2 + enrollment URL to AWS testbed ALB)
- optional production enrollment wiring:
  - `ENROLLMENT_URL=<https://.../api/enrollment>`
  - `ENROLLMENT_CA_CERT_PATH=<pi path>` (default `/etc/coderalphie/ca/enrollment-ca.pem`)
  - set `PI_ENROLLMENT_CA_CERT_LOCAL_PATH=<local pem path>` to copy CA cert to Pi
- reloads and restarts `coderalphie`
- validates live process env contains expected `C2_WS_URL` + `AETHERCORE_PRODUCTION`

### `scripts/ops/check-mac-mesh.sh`
Checks local listeners/processes and probes gateway websocket.

### `scripts/ops/check-pi-mesh.sh`
Runs remote Pi checks for `coderalphie` env/journal/connectivity.
- optional expected env validation:
  - `EXPECT_C2_WS_URL=<ws://...|wss://...>`
  - `EXPECT_AETHERCORE_PRODUCTION=<0|1>`
- optional C2 reachability target:
  - third arg `<c2-ws-url>` or `TARGET_C2_WS_URL=<...>`

### `scripts/ops/check-pi-chat.sh`
End-to-end Pi chat path validation against local gateway:
- sends authenticated chat envelope to target Pi device id
- verifies delivered ACK status
- verifies chat reply path when auto-reply is enabled

### `scripts/ops/check-heltech-telemetry.sh`
One-command Heltech telemetry verification:
- confirms `bridge-heltech-meshtastic.py` is running
- tails bridge log for quick diagnostics
- validates websocket stream contains `RALPHIE_PRESENCE` telemetry for target device
- fails fast if telemetry (or GPS by default) is missing

### `scripts/ops/force-pi-presence.sh`
Forces one real presence POST from Pi identity to Mac gateway and then verifies
`RALPHIE_PRESENCE_SNAPSHOT` from local websocket.

### `scripts/ops/bridge-heltech-presence.sh`
Bridges a Heltech/Meshtastic node into the same local gateway presence channel
used by CodeRalphie:
- publishes `RALPHIE_PRESENCE` startup + heartbeat frames to `:3000`
- supports non-TPM nodes (`tpm_backed=false`) with reduced trust defaults
- optional telemetry fields for GPS/power/radio (`--lat --lon --battery-pct --snr-db`, etc.)
- optional websocket verification that the node appears in snapshot/live stream

### `scripts/ops/connect-heltech-v4.sh`
One-command Heltech V4 onboarding:
- auto-detects Heltech USB serial + modem port
- supports Meshtastic Wi-Fi mode via `--host <ip>` (TCP, default port `4403`)
- derives stable node id (`heltech-v4-<usb-serial>`) unless overridden
- optional clean app restart
- starts Meshtastic auto-telemetry bridge in background when `meshtastic` Python package is installed
- falls back to manual presence bridge mode if auto-telemetry dependency is missing
- runs Mac mesh checks afterward

### `scripts/ops/bringup-all-nodes.sh`
One-command full node bring-up (Heltech + Pi + validations):
- starts local app + Heltech bridge
- configures Pi `C2_WS_URL` + `AETHERCORE_PRODUCTION` with explicit mode/profile
- forces one Pi presence POST
- validates Heltech telemetry stream
- runs Mac + Pi mesh checks
- supports Heltech over USB (`--heltech-port`) or Wi-Fi (`--heltech-host`, `--heltech-tcp-port`)
- supports profile presets (`--profile home`, `--profile aws-testbed`)
- supports explicit Pi controls:
  - `--pi-mode dev|prod`
  - `--c2-ws-url ws://...|wss://...`

### `scripts/ops/deploy-pi-chat-app.sh`
Deploys installable Pi-side chat app binary:
- copies `agent/linux/dist/coderalphie-chat-linux-arm64` to Pi
- installs as `/usr/local/bin/coderalphie-chat`
- prepares `/opt/coderalphie/chat` writable history directory
- prints one-liner to launch app over SSH tty

### `scripts/ops/deploy-pi-chat-gui.sh`
Deploys installable Pi-side GUI chat app binary:
- copies `agent/linux/dist/coderalphie-chat-gui-linux-arm64` to Pi
- installs as `/usr/local/bin/coderalphie-chat-gui`
- installs launcher wrapper as `/usr/local/bin/coderalphie-chat-gui-launch` (auto-inherits `C2_WS_URL`)
- prepares `/opt/coderalphie/chat` writable history directory
- installs desktop launcher at `/home/ralphie/Desktop/CodeRalphie Chat GUI.desktop`

### `scripts/ops/run-pi-chat.sh`
Launches interactive Pi chat app over SSH tty:
- reads active `C2_WS_URL` from `coderalphie` systemd environment on Pi
- runs `sudo -u ralphie /usr/local/bin/coderalphie-chat` with that endpoint injected
- keeps ControlMaster SSH reuse enabled for faster reconnects

### `scripts/ops/run-pi-chat-gui.sh`
Launches the Pi GUI chat app over SSH:
- reads active `C2_WS_URL` from `coderalphie` systemd environment on Pi
- runs `/usr/local/bin/coderalphie-chat-gui` as `ralphie`
- defaults to `--no-open` for SSH sessions (no display forwarding required)

### `scripts/ops/bridge-heltech-meshtastic.py`
Automatic live telemetry bridge from Meshtastic serial to local gateway:
- reads node cache from connected Meshtastic device over USB serial
- publishes `RALPHIE_PRESENCE` startup + heartbeats with telemetry (`gps/power/radio/device`)
- no manual `--lat/--lon` values required
- dependency: `python3 -m pip install --user meshtastic`

### `scripts/ops/stop-heltech-bridge.sh`
Stops Heltech presence bridge helper processes.

### `scripts/ops/clean-restart-app.sh`
Kills stale Commander processes, auto-starts the local mock C2 backend on `:50051`,
and launches the binary directly with a clean log.
- Disable mock backend auto-start: `AUTO_START_C2_MOCK=0 scripts/ops/clean-restart-app.sh`
- Launch mode override: `AETHERCORE_LAUNCH_MODE=open|binary|auto` (default `auto`)

### `scripts/ops/run-dashboard-dev.sh`
Runs Commander via `pnpm tauri dev` with sentinel-safe env values, using the
current source frontend (useful when bundle/frontend drift is suspected).

### `scripts/ops/check-macos-se-readiness.sh`
Validates macOS Secure Enclave signing prerequisites:
- provisioning profile Team ID/App ID/device inclusion
- local Apple Development identity team match
- repo entitlements alignment report

### `scripts/ops/launch-se-attestation.sh`
Launches Commander with sentinel startup attestation explicitly enabled:
- `AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP=0`
- `AETHERCORE_SEP_ALLOW_EPHEMERAL=1` (default)
- prints recent Secure Enclave / sentinel launch logs

### `scripts/ops/verify-se-required.sh`
Deterministic Secure Enclave startup verification:
- temporarily sets runtime `tpm_policy.mode=required`
- launches Commander with startup attestation forced on
- reports PASS if process remains alive (fail-closed otherwise)
- restores runtime config after check

### `scripts/ops/release-se-build.sh`
One-command release pipeline for macOS Secure Enclave:
- runs `check-macos-se-readiness.sh`
- exports resolved Team ID + signing identity
- builds signed Tauri app bundle
- runs direct `--sentinel-se-probe`
- runs required-mode startup verification

### `scripts/ops/safe-cleanup.sh`
Safe disk cleanup helper (dry-run by default):
- standard mode removes debug build artifacts and dashboard dist output
- deep mode removes large release intermediate artifacts and bundled runtime caches
- deep mode also removes stale vendored local-control-plane `node_modules` trees
- keeps the latest release app bundle by default

### `scripts/ops/run-mesh-diagnostics.sh`
One-command runner:
1. sync local config
2. check Mac
3. check Pi

## Typical Workflow

```bash
# 1) Keep local config sane
./scripts/ops/sync-endpoints.sh

# 2) Ensure Pi targets your Mac gateway
./scripts/ops/configure-pi-c2.sh duskone@192.168.1.125 192.168.1.51

# 2b) Production-mode enrollment wiring (example)
PI_AETHERCORE_PRODUCTION=1 \
PI_ENROLLMENT_URL="https://c2.aethercore.local:3000/api/enrollment" \
PI_ENROLLMENT_CA_CERT_LOCAL_PATH="$HOME/certs/enrollment-ca.pem" \
./scripts/ops/configure-pi-c2.sh duskone@192.168.1.125 192.168.1.51

# 2c) AWS testbed production profile wiring (Pi -> AWS ALB)
PI_ENDPOINT_PROFILE=prod-aws-testbed \
PI_ENROLLMENT_CA_CERT_LOCAL_PATH="$HOME/certs/enrollment-ca.pem" \
./scripts/ops/configure-pi-c2.sh duskone@192.168.1.125 192.168.1.51

# 3) Validate both ends
./scripts/ops/run-mesh-diagnostics.sh duskone@192.168.1.125 192.168.1.51

# 3.5) Bridge a Heltech/Meshtastic node into local presence
./scripts/ops/bridge-heltech-presence.sh \
  --device-id heltech-v4-01 \
  --hardware-serial heltech-v4-01 \
  --mesh-endpoint ws://192.168.1.51:3000

# 3.6) Or use one-command Heltech V4 onboarding (auto-detect USB + start bridge)
#      For full live telemetry, install meshtastic python package once:
#      python3 -m pip install --user meshtastic
./scripts/ops/connect-heltech-v4.sh

# 3.6b) Heltech Wi-Fi mode (no USB attached; Meshtastic TCP service on device)
./scripts/ops/connect-heltech-v4.sh --host 192.168.1.88 --tcp-port 4403

# 3.7) Validate Heltech telemetry stream end-to-end
./scripts/ops/check-heltech-telemetry.sh

# 4) Or run one-command full bring-up for Heltech + Pi + checks
./scripts/ops/bringup-all-nodes.sh --heltech-port /dev/cu.usbmodem9070698426501

# 4b) One-command full bring-up with Heltech over Wi-Fi
./scripts/ops/bringup-all-nodes.sh --heltech-host 192.168.1.88 --heltech-tcp-port 4403

# 4c) Home preset shortcut (your saved LAN defaults)
./scripts/ops/bringup-all-nodes.sh --profile home

# 4d) AWS testbed preset for Pi production endpoint wiring
./scripts/ops/bringup-all-nodes.sh --profile aws-testbed

# 5) Relaunch Commander cleanly
./scripts/ops/clean-restart-app.sh

# 5.5) Deploy and launch Pi chat app
./scripts/ops/deploy-pi-chat-app.sh duskone@192.168.1.125
./scripts/ops/run-pi-chat.sh duskone@192.168.1.125

# 5.6) Build + deploy Pi GUI chat app
pnpm --dir agent/linux build:chat:gui
./scripts/ops/deploy-pi-chat-gui.sh duskone@192.168.1.125

# 5.7) Optional remote launch for diagnostics (runs with --no-open)
./scripts/ops/run-pi-chat-gui.sh duskone@192.168.1.125

# 6) Verify macOS Secure Enclave build-signing prerequisites
./scripts/ops/check-macos-se-readiness.sh ~/Downloads/AetherCoreCommander\ Dev\ KB4\ Good.provisionprofile

# 7) Launch with hardware attestation forced ON
./scripts/ops/launch-se-attestation.sh

# 8) Deterministically verify SE attestation in required mode
./scripts/ops/verify-se-required.sh

# 9) One-command signed release + SE verification pipeline
./scripts/ops/release-se-build.sh

# 10) Safe cleanup preview (no deletions)
bash ./scripts/ops/safe-cleanup.sh

# 11) Apply standard cleanup
bash ./scripts/ops/safe-cleanup.sh --apply

# 12) Apply deep cleanup (keeps release app bundle by default)
bash ./scripts/ops/safe-cleanup.sh --deep --apply
```
