# AetherCore Tactical Glass Desktop Application

The desktop application package for AetherCore's Tactical Glass dashboard, built with Tauri v2.

## Architecture

The Tactical Glass desktop app consists of:

- **Frontend**: React + TypeScript dashboard (`packages/dashboard/src`)
- **Backend**: Rust-based Tauri application (`packages/dashboard/src-tauri`)
- **Core Integration**: Direct access to `crates/core`, `crates/identity`, and `crates/crypto`

## Features

### 1. Testnet Connection
Connect the desktop app to AetherCore's P2P testnet for development and testing.

**Command**: `connect_to_testnet(endpoint: string)`

### 2. Zero-Touch Enrollment (CodeRalphie Linker)
Generate cryptographically signed Genesis Bundles for IoT device provisioning:

1. Generate a `GenesisBundle` (User Identity + Squad ID)
2. Sign it with Ed25519 (TPM-backed in production)
3. Render as QR code for scanning by edge devices

**Commands**:
- `generate_genesis_bundle(user_identity: string, squad_id: string)`
- `bundle_to_qr_data(bundle: GenesisBundle)`

## Development

### Prerequisites

- Node.js >= 18.0.0
- Rust >= 1.77.2
- System dependencies (Linux only):
  ```bash
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev
  ```

### Build & Run

```bash
# Install dependencies
cd packages/dashboard
pnpm install --frozen-lockfile

# Development mode with hot reload
pnpm run tauri:dev

# Production build
pnpm run tauri:build
```

### Build Outputs

- **Linux**: `.AppImage` in `src-tauri/target/release/bundle/appimage/`
- **macOS**: `.dmg` in `src-tauri/target/release/bundle/dmg/`
- **Windows**: `.msi` in `src-tauri/target/release/bundle/msi/`

## First-Run Bootstrap Wiring

The desktop app now enforces a deterministic first-run bootstrap flow before rendering the main dashboard.

Installer integrations should launch with `--bootstrap` for post-install first open:

- **Windows Start Menu post-install launch**: `AetherCore Commander.exe --bootstrap`
- **macOS launch prompt**: `open -a "AetherCore Commander" --args --bootstrap`

The app inspects this flag via the `installer_bootstrap_requested` Tauri command and forces bootstrap even before persisted completion state is present.

## Cross-Platform Builds

The CI pipeline automatically builds for all platforms:

```yaml
# .github/workflows/ci.yml
- ubuntu-latest → .AppImage
- macos-latest  → .dmg
- windows-latest → .msi
```

Artifacts are uploaded to GitHub Releases on tagged commits.

## Security Model

### TPM-Backed Signing (CodeRalphie)

In production, all cryptographic operations use TPM 2.0 or Secure Enclave:

- **Private keys never reside in system memory**
- **Ed25519 signatures** are computed within the hardware security module
- **BLAKE3 hashing** is used exclusively for data integrity

Current implementation uses ephemeral keys for development. Production deployment requires:

```rust
// TODO: Replace with TPM-backed key generation
let signing_key = SigningKey::generate(&mut rand::thread_rng());
```

### Zero-Trust Architecture

- All data streams are verified against Merkle Vines
- Identity failures result in immediate node revocation (Aetheric Sweep)
- No graceful degradation for security failures

## IoT Device Provisioning

The Genesis Bundle QR code contains:

```json
{
  "user_identity": "operator-001",
  "squad_id": "squad-alpha",
  "public_key": "base64-encoded-ed25519-public-key",
  "signature": "base64-encoded-signature",
  "timestamp": 1704326400
}
```

Edge devices running `crates/edge` scan this QR code to:
1. Verify the signature using the public key
2. Extract user identity and squad assignment
3. Initiate mesh join protocol

## Integration with Rust Crates

The Tauri backend directly imports:

```rust
// src-tauri/Cargo.toml
aethercore-core = { path = "../../../crates/core" }
aethercore-identity = { path = "../../../crates/identity" }
aethercore-crypto = { path = "../../../crates/crypto" }
```

This ensures:
- Zero-copy data access
- Type-safe FFI boundaries
- Consistent cryptographic primitives

## CI/CD Pipeline

### Desktop Release Job

```yaml
release-desktop:
  strategy:
    matrix:
      - ubuntu-latest
      - macos-latest
      - windows-latest
  steps:
    - Build Tauri app
    - Upload artifacts (.AppImage, .dmg, .msi)
```

### ARM64 Edge Binary

```yaml
build-arm-edge:
  runs-on: ubuntu-latest
  steps:
    - Build with cross for aarch64-unknown-linux-gnu
    - Static linking with musl
    - Upload binary artifact
```

## Troubleshooting

### Linux: Missing GTK Dependencies

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev
```

### macOS: Code Signing

For distribution, configure code signing in `tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name"
    }
  }
}
```

### Windows: Missing Visual C++ Redistributables

Install the latest Visual C++ Redistributable from Microsoft.

## License

MIT OR Apache-2.0
