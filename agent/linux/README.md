# CodeRalphie Linux Agent - Warhead Build

Zero-Touch Hardware-Rooted Identity Agent for Raspberry Pi and Linux SBCs.

## Overview

CodeRalphie is the edge node agent that establishes hardware-rooted trust on Raspberry Pi and other Single Board Computers (SBCs). It implements the AetherCore identity protocol with TPM-backed key generation and autonomous enrollment.

## Philosophy

**"Trust On Boot"** - Device authenticates with hardware-rooted identity or bricks.

This implementation follows the 4MIK architectural invariants:
- **No Mocks in Production**: TPM-backed keys required in production mode
- **Memory Safety**: Private keys never reside in system memory (TPM-resident)
- **Hashing**: BLAKE3 exclusively for all integrity checks
- **Signing**: TPM-backed Ed25519 signatures
- **Data Structure**: All events structured as Merkle Vines

## Directory Structure

```
agent/linux/
├── src/
│   ├── index.ts              # Main entry point with --genesis flag support
│   ├── identity.ts           # Identity protocol implementation
│   ├── bootstrap/
│   │   └── configValidator.ts    # Configuration validation
│   ├── device-management/
│   │   └── configManager.ts      # Runtime configuration management
│   ├── integration/
│   │   └── onboarding.ts         # Zero-touch enrollment logic
│   └── ui/
│       └── status-indicator.ts   # LED status feedback
├── install.sh                # Installation script ("The Infection")
├── build-warhead.sh          # Build script for ARM64 binary
├── package.json              # Build configuration with pkg
└── tsconfig.json             # TypeScript configuration
```

## Build Process

### Development Build

```bash
pnpm install --frozen-lockfile
pnpm run build
```

### Warhead Build (Self-Contained Binary)

The "Warhead" build creates a self-contained executable with embedded Node.js runtime for deployment to Pi devices that may not have Node.js installed.

```bash
./build-warhead.sh
```

Or use pnpm scripts:

```bash
pnpm run build:full
```

This will:
1. Install dependencies
2. Build TypeScript to `dist/`
3. Package with `pkg` to create `dist/coderalphie-linux-arm64`
4. Copy binary and `install.sh` to `packages/dashboard/src-tauri/resources/payloads/`

### Output Artifacts

- **Binary**: `dist/coderalphie-linux-arm64` - Self-contained ARM64 executable
- **Installer**: `install.sh` - Bash script for system installation
- **Dashboard Payloads**: Copied to `packages/dashboard/src-tauri/resources/payloads/` for SSH injection

## Installation

The `install.sh` script automates deployment on target Raspberry Pi:

```bash
# On target Pi (requires root):
sudo ./install.sh
```

This script will:
1. Create `ralphie` system user (non-root)
2. Install binary to `/usr/local/bin/coderalphie`
3. Create systemd service (`coderalphie.service`)
4. Generate hardware-rooted identity with `--genesis` flag
5. Output `IdentityBlock` JSON to stdout (captured by dashboard)
6. Start service as `ralphie` user

### Security Requirements

- Keys stored in `/etc/coderalphie/keys/` with `chmod 700`
- Identity file has `chmod 600` ownership by `ralphie` user
- Service runs as `ralphie` user, never root (after setup)
- Private keys are TPM-resident in production mode

## Usage

### Genesis Mode

Generate hardware-rooted identity and output IdentityBlock JSON:

```bash
coderalphie --genesis
```

Output format:
```
=== IDENTITY_BLOCK_START ===
{
  "hardware_id": "AA:BB:CC:DD:EE:FF",
  "public_key": "...",
  "genesis_hash": "...",
  "platform_type": "SBC"
}
=== IDENTITY_BLOCK_END ===
```

### Normal Operation

Run agent service:

```bash
coderalphie
```

This will:
1. Load configuration from `/etc/coderalphie/config.json`
2. Check for existing identity
3. If no identity, initiate enrollment
4. Connect to C2 mesh
5. Enter operational event loop

### Service Management

```bash
# Check status
systemctl status coderalphie

# View logs
journalctl -u coderalphie -f

# Restart
systemctl restart coderalphie

# Stop
systemctl stop coderalphie
```

## Configuration

Default configuration paths:
- Config: `/etc/coderalphie/config.json`
- Identity: `/etc/coderalphie/keys/identity.json`
- Service: `/etc/systemd/system/coderalphie.service`
- Logs: `journalctl -u coderalphie`

### Environment Variables

- `AETHERCORE_PRODUCTION`: Set to `1` or `true` to enforce TPM requirements
- `AETHERCORE_SALT`: Salt for genesis hash generation
- `ENROLLMENT_URL`: Override enrollment server URL
- `C2_SERVER`: Override C2 server address
- `TPM_ENABLED`: Enable/disable TPM integration

## Production vs Development Mode

### Production Mode (`AETHERCORE_PRODUCTION=1`)

- **Enforced**: TPM-backed key generation
- **Enforced**: WSS (secure WebSocket) for C2 connection
- **Behavior**: Exit on enrollment failure (fail-visible)
- **Keys**: TPM-resident, never in memory

### Development Mode (default)

- **Warning**: Software-generated Ed25519 keys (INSECURE)
- **Allowed**: Plain WebSocket connections
- **Behavior**: Continue on enrollment failure with warning
- **Keys**: Stored in filesystem with chmod 600

## TPM Integration

In production mode, CodeRalphie integrates with TPM 2.0 for hardware-rooted key generation:

1. Check for `/dev/tpm0` device
2. Generate primary ECC key
3. Create Ed25519 signing key under primary
4. Persist key at handle `0x81000001`
5. Extract public key for enrollment

If TPM is unavailable in production mode, the agent will brick and refuse to operate.

## Dashboard Integration

The Dashboard uses the payloads for SSH injection deployment:

1. Dashboard selects target Pi
2. Uploads `coderalphie-linux-arm64` and `install.sh` via SSH
3. Executes `install.sh` with root privileges
4. Captures `IdentityBlock` JSON from stdout
5. Displays enrolled device in fleet management

## License

See LICENSE file in repository root.

## Architecture References

- [ARCHITECTURE.md](../../ARCHITECTURE.md) - System architecture
- [PROTOCOL_OVERVIEW.md](../../PROTOCOL_OVERVIEW.md) - Identity protocol
- [SECURITY.md](../../SECURITY.md) - Security architecture
- [packages/shared/src/identity.ts](../../packages/shared/src/identity.ts) - Identity protocol implementation
