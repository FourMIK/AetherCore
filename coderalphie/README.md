# CodeRalphie Edge Node

**Philosophy:** "Trust On Boot" - Hardware-rooted identity or brick.

Zero-Touch Onboarding system for Raspberry Pi edge nodes with TPM-backed authentication.

## Overview

CodeRalphie transforms a raw Raspberry Pi into a trusted edge node in the AetherCore mesh through autonomous enrollment with hardware-rooted identity.

### Key Features

- **Zero-Touch Enrollment**: Fully autonomous device provisioning
- **TPM-Backed Keys**: Private keys never in system memory
- **Signal-Agnostic Hashing**: BLAKE3 chain + skip-links + Ed25519, independent of transport or media type
- **Fail-Visible Design**: LED indicators for operational state
- **Auto-Recovery**: Resilient systemd service with automatic restart
- **Security Hardening**: Firewall, SSH keys only, strict permissions

## Architecture

```
┌─────────────────────────────────────────┐
│         Raspberry Pi Hardware           │
│  ┌──────────┐    ┌─────────────────┐  │
│  │ TPM 2.0  │───▶│  LED Indicator  │  │
│  └──────────┘    └─────────────────┘  │
└─────────────────────────────────────────┘
           │                │
           ▼                ▼
┌─────────────────────────────────────────┐
│       CodeRalphie Application           │
│  ┌─────────────────────────────────┐   │
│  │  Onboarding (onboarding.ts)     │   │
│  │  - Generate TPM keypair         │   │
│  │  - Create CSR with HW serial    │   │
│  │  - Request certificate          │   │
│  │  - Persist identity (mode 600)  │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │  Status Indicator               │   │
│  │  - 🟡 Blinking: Enrolling       │   │
│  │  - 🟢 Solid: Operational        │   │
│  │  - 🔴 Fast Blink: Error         │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │  Config Management              │   │
│  │  - Validation                   │   │
│  │  - Environment override         │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│      AetherCore C2 Server (WSS)         │
│  - Enrollment endpoint                  │
│  - Certificate issuance                 │
│  - Mesh coordination                    │
└─────────────────────────────────────────┘
```

## Signal-Agnostic Hashing Node (AetherCore Interop)

Turn any node into a transport-agnostic provenance appliance: any inbound signal (RF/IQ capture, serial, BLE, CAN, RTMP, file tail, etc.) is chunked, hashed, signed, and streamed to AetherCore with deterministic provenance.

**Data-path contract**
- Hash: `BLAKE3` over each chunk (default 1 KiB; configurable) producing `hash`.
- Continuity: `prev_hash` (hash of prior chunk) plus optional `skip_links` (exponential back-links) for fast verification.
- Signature: `Ed25519` (or configured algo) over `{hash, prev_hash, skip_links, timestamp, stream_id}`.
- Envelope expected by AetherCore: `stream_id`, `seq`, `timestamp`, `hash`, `prev_hash`, `skip_links[]`, `sig_alg`, `signature`, `key_id`.

**Workflow**
1. Normalize input to byte chunks (leave compression/codec untouched).
2. Compute `hash = blake3(chunk)`.
3. Set `prev_hash` to previous chunk’s hash (or zeros for the first packet).
4. Emit `skip_links` every 2ⁿ chunks (n=0..5) for rapid catch-up verification.
5. Sign with the node’s identity key (TPM-backed when available) and send to C2 over the existing WSS channel.

**Configuration knobs (env or config)**
- `HASH_ALGO` (default `blake3`) – only change for non-critical fallback.
- `SIG_ALGO` (default `ed25519`) – aligns with AetherCore verifier.
- `CHUNK_BYTES` (default `1024`) – payload chunk size per hash.
- `SKIPLINK_FANOUT` (default `6`) – number of exponential skip-links to emit.

**Trust posture**
- Production: TPM-required, Ed25519 keys resident in TPM handle `0x81000001`.
- Field test: TPM optional; software keys allowed with warnings.
- All packets carry `sig_alg` and `key_id` to stay device-/transport-agnostic.

## Deployment

### Prerequisites

- Raspberry Pi 4 or newer
- TPM 2.0 module (e.g., Infineon SLB9670)
- Raspberry Pi OS (64-bit recommended)
- Node.js 18+ installed

### Quick Start

1. **System Hardening**
   ```bash
   cd raspberry-pi
   sudo ./setup.sh
   ```
   This script:
   - Configures firewall (UFW)
   - Disables password SSH
   - Enables TPM hardware interfaces
   - Sets up fail2ban

2. **Reboot** (to apply boot config changes)
   ```bash
   sudo reboot
   ```

3. **Deploy CodeRalphie**
   ```bash
   cd raspberry-pi
   sudo ./deploy-ralphie.sh
   ```
   This script:
   - Creates service user
   - Installs application
   - Creates systemd service
   - Enables auto-start

4. **Verify Operation**
   ```bash
   # Check service status
   systemctl status coderalphie
   
   # View logs
   journalctl -u coderalphie -f
   
   # Run health check
   node raspberry-pi/health-check.js
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENROLLMENT_URL` | `https://c2.aethercore.local:3000/api/enrollment` | Enrollment server endpoint |
| `AETHERCORE_PRODUCTION` | `0` | Production mode (1=enforce TPM) |
| `C2_SERVER` | `c2.aethercore.local` | C2 server hostname |
| `C2_PORT` | `8443` | C2 server port |
| `CONFIG_PATH` | `/opt/coderalphie/config/config.json` | Configuration file path |

### Production Mode

Set `AETHERCORE_PRODUCTION=1` to enforce:
- TPM hardware requirement (panics if unavailable)
- WSS-only connections (no ws://)
- Strict identity validation
- Exit on enrollment failure

```bash
export AETHERCORE_PRODUCTION=1
sudo -E ./deploy-ralphie.sh
```

## Enrollment Flow

```
1. Boot
   └─▶ Check for existing identity (/etc/ralphie/identity.json)
       ├─▶ Found: Load and verify → 🟢 Solid Green
       └─▶ Not found:
           ├─▶ 🟡 Blinking Yellow (enrollment in progress)
           ├─▶ Get hardware serial (/proc/cpuinfo or TPM EK)
           ├─▶ Generate TPM-backed Ed25519 keypair
           ├─▶ Create CSR with device ID + HW serial
           ├─▶ Request certificate from enrollment server
           ├─▶ Validate certificate & trust score (≥0.7)
           ├─▶ Persist identity to /etc/ralphie/identity.json (mode 600)
           └─▶ 🟢 Solid Green (enrollment complete)
```

**Timeout:** 2 minutes. If enrollment doesn't complete, LED shows 🔴 Fast Blinking Red.

## LED Status Indicators

| Pattern | Meaning | Action Required |
|---------|---------|-----------------|
| 🟡 **Blinking Yellow** | Enrollment in progress | Wait (max 2 min) |
| 🟢 **Solid Green** | Operational & trusted | None |
| 🔴 **Fast Blinking Red** | TPM error / Integrity failure | Check logs, verify TPM |
| 🔴 **Slow Blinking Red** | Network disconnected | Check C2 connectivity |

## File Structure

```
coderalphie/
├── index.ts                          # Main entry point
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── integration/
│   │   └── onboarding.ts            # Zero-touch enrollment logic
│   ├── ui/
│   │   └── status-indicator.ts      # LED control
│   ├── bootstrap/
│   │   └── configValidator.ts       # Config validation
│   └── device-management/
│       └── configManager.ts         # Runtime config management
└── raspberry-pi/
    ├── setup.sh                     # System hardening script
    ├── deploy-ralphie.sh            # Service deployment script
    └── health-check.js              # Health monitoring script
```

## Security

### Identity Storage

- Path: `/etc/ralphie/identity.json`
- Permissions: `600` (owner read/write only)
- Contains:
  - Device ID
  - Hardware serial
  - Public key (TPM-backed)
  - Certificate
  - Trust score
  - Enrollment timestamp

### TPM Integration

- **Production**: Keys generated in TPM (handle 0x81000001)
- **Development**: Software keys with warning
- Private keys never leave TPM in production mode

### Network Security

- **Firewall**: Deny all incoming, allow outgoing to C2 only
- **SSH**: Key authentication only, no passwords
- **C2 Connection**: TLS 1.3 / WSS required in production

## Health Monitoring

Run health checks manually or via cron:

```bash
# Manual check
node raspberry-pi/health-check.js

# Add to cron (every 5 minutes)
*/5 * * * * /usr/bin/node /opt/coderalphie/raspberry-pi/health-check.js >> /var/log/coderalphie/health.log 2>&1
```

Health check verifies:
- ✓ Service running
- ✓ Process alive
- ✓ LED indicator responsive
- ✓ Device enrolled
- ⚠ TPM available
- ⚠ C2 connectivity

## Troubleshooting

### Enrollment fails

```bash
# Check logs
journalctl -u coderalphie -n 100

# Verify TPM
ls -la /dev/tpm0
tpm2_getcap properties-fixed

# Check enrollment server connectivity
curl -k https://c2.aethercore.local:3000/api/enrollment
```

### LED not responding

```bash
# Check GPIO LED
ls -la /sys/class/leds/led0/
cat /sys/class/leds/led0/brightness

# Test manually
echo 255 > /sys/class/leds/led0/brightness  # On
echo 0 > /sys/class/leds/led0/brightness    # Off
```

### Service won't start

```bash
# Check service status
systemctl status coderalphie

# View full logs
journalctl -u coderalphie --no-pager

# Test manually
cd /opt/coderalphie
sudo -u ralphie node index.js
```

## Development

### Build

```bash
pnpm install --frozen-lockfile
pnpm run build
```

### Run locally

```bash
pnpm run dev
```

### Test enrollment flow

```bash
# Delete existing identity
sudo rm /etc/ralphie/identity.json

# Run with dev mode
AETHERCORE_PRODUCTION=0 pnpm run dev
```

## License

See LICENSE file in repository root.

## Support

For issues or questions, see CONTRIBUTING.md in the repository root.
