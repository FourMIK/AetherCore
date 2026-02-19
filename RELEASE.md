# AetherCore Release Guide

**Version:** 0.2.0  
**Classification:** OPERATIONAL  
**Purpose:** Production release procedures

---

## Overview

This guide covers the complete release process for AetherCore, from preparation through deployment.

## Release Types

### Alpha Releases (0.x.x)
- Early testing and validation
- Dev mode enabled by default
- Not for production deployment
- Breaking changes expected

### Beta Releases (1.x.x-beta)
- Feature complete for target release
- Production-ready infrastructure
- TPM validation optional
- Stable API

### Production Releases (1.x.x)
- Full TPM hardware validation
- Production-hardened configuration
- Stable, backwards-compatible API
- Long-term support

---

## Current Release: v0.2.0

**Status:** Alpha Release  
**Date:** 2026-02-12  
**Purpose:** Public release for evaluation and testing

### Features

- ✅ Hardware-Rooted Identity (TPM 2.0 / Secure Enclave)
- ✅ Merkle Vine™ Integrity (historical data anchoring)
- ✅ The Aetheric Sweep (Byzantine node detection)
- ✅ Tactical Glass (GPU-accelerated dashboard)
- ✅ Dev Mode (simulated TPM for testing)

### Known Limitations

- Dev mode enabled by default
- TPM validation optional
- HTTP/WS supported (HTTPS/WSS recommended)
- Single-node deployment focus

---

## Release Process

### 1. Pre-Release Checklist

Run the comprehensive release validation:

```bash
./scripts/release-checklist.sh
```

This validates:
- ✓ Documentation completeness
- ✓ Test suite execution
- ✓ SBOM generation
- ✓ Version consistency
- ✓ Lock file integrity
- ✓ Build validation

### 2. Version Update

Update version across all components:

```bash
./push-release.sh 0.2.0
```

This script:
1. Updates `packages/dashboard/package.json`
2. Updates `packages/dashboard/src-tauri/tauri.conf.json`
3. Updates `packages/dashboard/src-tauri/Cargo.toml`
4. Commits changes with release message
5. Creates git tag `v0.2.0`
6. Pushes to main branch

### 3. Automated Build

Once tagged, GitHub Actions automatically:
- Builds desktop applications (.dmg, .msi, .AppImage)
- Generates checksums
- Runs installer certification suite on clean macOS + Windows runners
  - Installs produced `.dmg`/`.msi`
  - Executes first-run smoke flow (`launch app → bootstrap stack → deploy sample node → verify dashboard-ready state`)
  - Captures structured certification JSON, launch logs, and failure screenshots as artifacts
- Creates GitHub Release
- Uploads artifacts

Workflow: `.github/workflows/desktop-release.yml`

### 3.1 Release SLO + Certification Gate

- **Release SLO:** `95%+ successful first-run bootstrap on clean supported OS images.`
- Certification suite emits machine-readable pass/fail records per platform.
- The `Finalize Desktop Release` job is hard-gated on certification success; release publication is blocked if any certification job fails.

### 4. Release Verification

After build completes:

1. **Download artifacts** from GitHub Releases
2. **Verify checksums**:
   ```bash
   sha256sum -c *.sha256
   ```
3. **Test installation** on each platform
4. **Smoke test** core functionality

### 5. Release Announcement

Update:
- GitHub Release notes
- README.md badges
- Documentation links
- Community channels

---

## Building from Source

### Prerequisites

- **Rust:** 1.75+ (stable)
- **Node.js:** 20.x LTS
- **pnpm:** Latest
- **System:**
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools
  - Linux: build-essential

### Build Commands

```bash
# Clone repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Install dependencies
pnpm install

# Build Rust workspace
cargo build --release

# Build desktop application
cd packages/dashboard
pnpm tauri build
```

### Build Artifacts

- **macOS:** `target/release/bundle/dmg/AetherCore_0.2.0_universal.dmg`
- **Windows:** `target/release/bundle/msi/AetherCore_0.2.0_x64_en-US.msi`
- **Linux:** `target/release/bundle/appimage/AetherCore_0.2.0_amd64.AppImage`

---

## Configuration

### Development Mode

For testing and evaluation, use dev mode configuration:

```yaml
# config/testing.yaml
testing:
  dev_mode: true

ralphie:
  bootstrap:
    tpm:
      mode: "simulated"

aethercore:
  identity:
    attestation_gate_enabled: false
```

See `config/testing.yaml` for complete testing configuration.

### Production Mode

For production deployment:

```yaml
# config/production.yaml
deployment:
  environment: "production"

ralphie:
  bootstrap:
    tpm:
      mode: "hardware"
      device: "/dev/tpm0"
    secureBoot:
      strictMode: true

aethercore:
  identity:
    attestation_gate_enabled: true
  stream:
    verification:
      mode: "strict"
```

See `DEPLOYMENT_PRODUCTION.md` for full production guide.

---

## Distribution

### GitHub Releases

Primary distribution channel:
https://github.com/FourMIK/AetherCore/releases

Each release includes:
- Desktop installers (.dmg, .msi, .AppImage)
- SHA256 checksums
- Release notes
- Source code archives

### Package Managers (Future)

Planned distribution channels:
- Homebrew (macOS)
- Chocolatey (Windows)
- apt/snap (Linux)

---

## Version History

### v0.2.0 (2026-02-12)

**Public Release**

Features:
- Core cryptographic infrastructure
- TPM 2.0 integration (dev mode)
- Merkle Vine integrity tracking
- Byzantine node detection
- Tactical Glass dashboard
- Dev mode for testing

Known Issues:
- TPM hardware mode requires additional testing
- Multi-node mesh coordination needs optimization
- Dashboard performance with >100 nodes

---

## Support

### Documentation

- **Installation:** [INSTALLATION.md](INSTALLATION.md)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Security:** [SECURITY.md](SECURITY.md)
- **Production Deployment:** [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)

### Community

- **GitHub Issues:** https://github.com/FourMIK/AetherCore/issues
- **Security:** security@example.com (see SECURITY.md)
- **General:** support@example.com

---

## License

Copyright © 2026 FourMIK  
Released under Apache 2.0 License

See [LICENSE](LICENSE) for full terms.

---

## Roadmap

### v0.3.0 (Q2 2026)
- Enhanced TPM hardware validation
- Multi-node mesh improvements
- Performance optimizations
- Additional test coverage

### v1.0.0-beta (Q3 2026)
- Production-ready TPM validation
- Complete security audit
- Performance benchmarks
- Production deployment templates

### v1.0.0 (Q4 2026)
- General Availability
- Long-term support
- Certified hardware list
- Enterprise support options

---

**Status:** v0.2.0 Released ✅  
**Next Release:** v0.3.0 (Q2 2026)
