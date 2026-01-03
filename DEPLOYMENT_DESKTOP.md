# AetherCore Tactical Glass - Deployment Guide

## Overview

This guide covers deployment of the AetherCore Tactical Glass desktop application across multiple platforms and architectures.

## Build Artifacts

### Desktop Applications

| Platform | Artifact Type | Location | Size (Est.) |
|----------|--------------|----------|-------------|
| Linux | AppImage | `*.AppImage` | ~80MB |
| macOS | DMG Installer | `*.dmg` | ~90MB |
| Windows | MSI Installer | `*.msi` | ~85MB |

### IoT Edge Library

| Platform | Artifact Type | Location | Size (Est.) |
|----------|--------------|----------|-------------|
| ARM64 | Static Library | `libaethercore_edge.rlib` | ~15MB |

## System Requirements

### Desktop Minimum Requirements

- **Operating System**: 
  - Linux: Ubuntu 20.04+, Debian 11+, or equivalent
  - macOS: 11.0 (Big Sur) or later
  - Windows: 10 (1809+) or later
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 500MB free space
- **Network**: Internet connection for testnet access

### IoT Edge Devices

- **Architecture**: ARM64 (aarch64)
- **OS**: Linux kernel 4.4+
- **RAM**: 512MB minimum
- **Storage**: 100MB free space
- **Hardware**: Raspberry Pi 4, or compatible ARM64 SBC

## Installation

### Linux (Ubuntu/Debian)

```bash
# Download the AppImage
wget https://github.com/FourMIK/AetherCore/releases/latest/download/tactical-glass.AppImage

# Make executable
chmod +x tactical-glass.AppImage

# Run
./tactical-glass.AppImage
```

**Optional**: Install system dependencies for native look:
```bash
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0
```

### macOS

1. Download the `.dmg` file from releases
2. Open the DMG
3. Drag "Tactical Glass" to Applications folder
4. On first run, go to System Preferences > Security & Privacy to allow the app

**Note**: The app is not notarized by Apple. You may need to right-click and select "Open" on first launch.

### Windows

1. Download the `.msi` installer from releases
2. Run the installer
3. Follow the installation wizard
4. Launch from Start Menu or Desktop shortcut

**SmartScreen Warning**: On first run, Windows may show a SmartScreen warning. Click "More info" and then "Run anyway".

## Configuration

### Testnet Connection

Default endpoint: `wss://testnet.aethercore.local:8443`

To configure a custom endpoint:

1. Open Tactical Glass
2. Navigate to Settings > Testnet
3. Enter your endpoint URL (must start with `ws://` or `wss://`)
4. Click "Connect"

### Identity Configuration

The app uses ephemeral keys by default. For production:

1. Ensure TPM 2.0 or Secure Enclave is available
2. Configure CodeRalphie integration in `src-tauri/Cargo.toml`
3. Rebuild with production features enabled

## Zero-Touch Enrollment Flow

### For Operators

1. Open Tactical Glass desktop app
2. Navigate to "Zero-Touch Enrollment"
3. Enter:
   - **User Identity**: Your operator ID (e.g., `operator-001`)
   - **Squad ID**: Your squad assignment (e.g., `squad-alpha`)
4. Click "Generate QR Code"
5. Display the QR code to the IoT device

### For IoT Devices

The IoT device must:

1. Have camera/QR scanner capability
2. Run `aethercore-edge` binary or library
3. Scan the Genesis Bundle QR code
4. Verify signature using BLAKE3 + Ed25519
5. Join mesh with extracted identity

## Security Considerations

### Production Deployment Checklist

- [ ] Replace ephemeral keys with TPM-backed keys
- [ ] Enable TLS 1.3 for all mesh communication
- [ ] Configure firewall rules for mesh ports
- [ ] Set up The Great Gospel for revocation tracking
- [ ] Enable audit logging for all identity operations
- [ ] Implement Aetheric Sweep for Byzantine node detection
- [ ] Test failover scenarios

### Network Security

**Required Ports**:
- `8443/tcp`: Testnet WebSocket (WSS)
- Custom ports for P2P mesh as configured

**Firewall Rules**:
```bash
# Allow testnet connection
sudo ufw allow 8443/tcp

# Allow mesh P2P (example)
sudo ufw allow 7000:7100/tcp
sudo ufw allow 7000:7100/udp
```

### CodeRalphie (TPM Integration)

Production builds must use TPM 2.0 for all private key operations:

```rust
// In production, keys never touch system memory
// All signing happens within the TPM
use tpm2_tss::*;

let signing_context = TpmContext::new()?;
let signature = signing_context.sign_with_tpm(message)?;
```

**Prohibited**: Storing private keys in:
- Environment variables
- Configuration files
- System memory (except secure enclaves)

## Updating

### Desktop App

#### Linux AppImage
Download the new AppImage and replace the old one.

#### macOS DMG
1. Open new DMG
2. Replace app in Applications folder
3. Restart if running

#### Windows MSI
1. Run new MSI installer
2. It will automatically update the existing installation

### Edge Library

For IoT devices, deploy the new `.rlib` file and rebuild your edge binary:

```bash
# Copy new library
scp libaethercore_edge.rlib pi@device:/opt/aethercore/

# Rebuild edge application
ssh pi@device "cd /opt/aethercore && cargo build --release"

# Restart edge service
ssh pi@device "sudo systemctl restart aethercore-edge"
```

## Troubleshooting

### Linux: "cannot execute binary file"

**Cause**: Wrong architecture or permissions

**Fix**:
```bash
chmod +x tactical-glass.AppImage
file tactical-glass.AppImage  # Verify it's x86-64
```

### macOS: "App is damaged and can't be opened"

**Cause**: Gatekeeper quarantine

**Fix**:
```bash
xattr -cr /Applications/Tactical\ Glass.app
```

### Windows: "VCRUNTIME140.dll was not found"

**Cause**: Missing Visual C++ Redistributable

**Fix**: Install [Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)

### WebSocket Connection Failed

**Symptoms**: Cannot connect to testnet

**Checks**:
1. Verify endpoint URL is correct
2. Check firewall allows port 8443
3. Ensure testnet is running
4. Check network connectivity: `ping testnet.aethercore.local`

### QR Code Not Scanning

**Symptoms**: IoT device can't read Genesis Bundle

**Fixes**:
1. Increase QR code size in UI
2. Ensure good lighting
3. Hold device steady for 2-3 seconds
4. Verify camera is functional

## Build from Source

See [README.md](README.md) for build instructions.

### Quick Build

```bash
# Clone repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Install dependencies
npm ci

# Build desktop app
cd packages/dashboard
npm run tauri:build
```

Build artifacts will be in `packages/dashboard/src-tauri/target/release/bundle/`

## CI/CD Pipeline

Automated builds run on every push to `main` and `develop`:

- **Desktop builds**: Run on Linux, macOS, Windows
- **ARM64 edge**: Cross-compiled on Linux runners
- **Artifacts**: Uploaded to GitHub Actions artifacts
- **Releases**: Tagged commits automatically publish to GitHub Releases

### Triggering a Release

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

This will trigger the release workflow and publish artifacts.

## Support

For issues, please file a GitHub issue with:
- Platform and version
- Error messages or logs
- Steps to reproduce
- Expected vs actual behavior

## License

MIT OR Apache-2.0
