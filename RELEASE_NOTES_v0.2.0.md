# AetherCore v0.2.0 - First Published Package

**Classification:** OPERATIONAL (Alpha Release)  
**Release Date:** February 12, 2026  
**TRL:** 6-7 (System/Subsystem Development)

---

## 🎉 Inaugural Release

This is the **first published package** of AetherCore, a hardware-rooted trust fabric for contested environments. AetherCore replaces "trust by policy" with **Cryptographic Certainty** for autonomous swarms, critical infrastructure, and edge operations.

---

## ⚡ Key Capabilities

### 🛡️ Hardware-Rooted Identity

Every node is cryptographically bound to physical silicon via TPM 2.0 / Secure Enclave. No software-only identity chains.

### 🔗 Merkle Vine™ Integrity

Telemetry streams are historically anchored. Data cannot be injected retroactively. Every event contains a hash of its ancestor.

### ⚡ The Aetheric Sweep

Automated gossip protocols actively hunt and isolate compromised or "lying" nodes. Byzantine detection is continuous and automatic.

### 🖥️ Tactical Glass

GPU-accelerated desktop dashboard providing real-time fleet command and mesh visualization. Built with Tauri for native performance.

### 🔐 Zero-Trust Architecture

- Fail-visible mode: Unverified data is explicitly marked as `STATUS_UNVERIFIED` or `SPOOFED`
- No silent integrity failures
- If identity verification fails, the node is considered an adversary

---

## 🔧 Technical Highlights

### Cryptographic Foundation

- **Hashing:** BLAKE3 exclusively (SHA-256 deprecated and removed)
- **Signing:** Ed25519 with TPM-backed private keys (CodeRalphie)
- **Transport:** TLS 1.3 enforced in production mode
- **Memory Safety:** Rust core with zero-copy optimization

### Architecture (4MIK Architectural Invariants)

✓ **No Mocks in Production:** Systematic replacement of all simulation with real gRPC/FFI calls  
✓ **Memory Safety:** Rust is the source of truth for edge execution  
✓ **Hashing:** BLAKE3 exclusively throughout the stack  
✓ **Signing:** TPM-backed Ed25519 (CodeRalphie). Private keys never in system memory  
✓ **Data Structure:** All data streams structured as Merkle Vines  
✓ **Fail-Visibility:** No graceful degradation for security failures

### Services

- **Identity Service** - TPM attestation gate for all nodes
- **Stream Processing** - Integrity tracking for telemetry
- **H2 Ingest Service** - High-throughput telemetry ingestion
- **C2 Router** - Command and control with signature verification
- **Trust Mesh** - Gossip-based Byzantine detection

---

## 📦 Installation

### Desktop Installers (Auto-Built via GitHub Actions)

Installers are automatically built for:

- **macOS:** Universal Binary (Intel + Apple Silicon) - `.dmg`
- **Windows:** x64 Installer - `.msi`
- **Linux:** Portable AppImage - `.AppImage`

Download from: https://github.com/FourMIK/AetherCore/releases/tag/v0.2.0

### Building from Source

```bash
# Prerequisites: Node.js 20+, Rust 1.75+, pnpm
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore
git checkout v0.2.0

# Install dependencies
pnpm install

# Build desktop application
cd packages/dashboard
pnpm tauri build
```

See [INSTALLATION.md](INSTALLATION.md) for detailed instructions.

---

## ⚠️ Known Limitations (Alpha Release)

This is an **Alpha Release** for evaluation and testing:

1. **Dev Mode Default:** The desktop application runs in "Dev Mode" by default, simulating hardware roots of trust
2. **TPM Validation Optional:** Hardware TPM validation can be enabled but is not enforced
3. **Single-Node Focus:** Multi-node mesh coordination is functional but not optimized
4. **Transport:** HTTP/WS supported for development (HTTPS/WSS recommended for production)
5. **Hardware Pairing:** ESP32 device pairing requires manual configuration

---

## 🔒 Security Posture

### Production-Ready Components

- Cryptographic primitives (BLAKE3, Ed25519)
- Merkle Vine integrity system
- Identity verification protocols
- Byzantine node detection algorithms

### Development-Mode Components

- Simulated TPM for testing without hardware
- HTTP/WebSocket support for local development
- SQLite database (PostgreSQL recommended for production)

### Security Hardening

See [SECURITY.md](SECURITY.md) for:

- Threat model and attack surface analysis
- Security assumptions and limitations
- Incident response procedures
- Responsible disclosure policy

---

## 📊 What's Included

### Core Rust Crates

```
crates/
├── core/         - Core types and traits
├── crypto/       - BLAKE3, Ed25519, TPM integration
├── identity/     - Hardware-rooted identity
├── domain/       - Domain models and errors
├── mesh/         - Trust mesh coordination
├── stream/       - Merkle Vine telemetry
├── edge/         - Edge node runtime
├── isr/          - ISR (Intelligence, Surveillance, Reconnaissance)
├── rf/           - RF spectrum analysis
├── radio/        - Radio communications
├── trust_mesh/   - Byzantine detection
├── h2-domain/    - H2OS integration
├── c2-router/    - Command & control
└── unit-status/  - Unit status reporting
```

### TypeScript Packages

```
packages/
├── dashboard/        - Tactical Glass desktop app (Tauri)
├── canonical-schema/ - Zod schemas for data validation
├── h2-glass/         - H2OS glass interface
└── shared/           - Shared utilities
```

### Services

```
services/
├── auth/           - Authentication service
├── collaboration/  - Multi-operator collaboration
├── fleet/          - Fleet management
├── gateway/        - API gateway
├── h2-ingest/      - H2 telemetry ingest
└── operator/       - Operator interface
```

---

## 📖 Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and design decisions
- [PROTOCOL_OVERVIEW.md](PROTOCOL_OVERVIEW.md) - Protocol specifications
- [SECURITY.md](SECURITY.md) - Security model and threat analysis
- [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md) - Production deployment guide
- [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md) - Desktop application deployment
- [INSTALLATION.md](INSTALLATION.md) - Installation instructions

---

## 🚀 Next Steps

### For Evaluators

1. Download desktop installer for your platform
2. Review [SECURITY.md](SECURITY.md) for security posture
3. Test in controlled environment with Dev Mode
4. Provide feedback via GitHub Issues

### For Developers

1. Clone repository and checkout v0.2.0 tag
2. Run `./scripts/doctor.js` to verify environment
3. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for development setup
4. Review [ARCHITECTURE.md](ARCHITECTURE.md) for system design

### For Production Deployment

1. Review [SECURITY_HARDENING.md](SECURITY_HARDENING.md)
2. Configure production mode with hardware TPM
3. Follow [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)
4. Enable TLS 1.3 for all communications
5. Review [SECRET_PROVISIONING.md](docs/SECRET_PROVISIONING.md) for key management

---

## 🛠️ CI/CD Pipeline

GitHub Actions automatically:

- ✓ Builds desktop applications for all platforms
- ✓ Generates checksums for installers
- ✓ Creates Software Bill of Materials (SBOM)
- ✓ Runs security scans
- ✓ Creates GitHub Release with artifacts

**Workflow:** `.github/workflows/desktop-release.yml`  
**Status:** Monitor at https://github.com/FourMIK/AetherCore/actions

---

## 📝 Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for complete list of changes, additions, and fixes.

### Highlights

#### Core Infrastructure

- Hardware-rooted identity system with TPM 2.0 / Secure Enclave support
- Ed25519 signature verification for all node communications
- BLAKE3 hashing for integrity checks (SHA-256 deprecated)
- Merkle Vine™ structure for historical data anchoring
- Byzantine node detection (The Aetheric Sweep)
- Fail-visible mode for unverified data

#### Configuration

- Production configuration with strict verification (`config/production.yaml`)
- Testing configuration with dev mode for development (`config/testing.yaml`)

#### Documentation

- Complete architecture documentation
- Security model and threat analysis
- Production deployment playbooks
- Supply chain security guidance
- TLS enforcement documentation

---

## 🤝 Contributing

We welcome contributions! Please see:

- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community standards

---

## 📜 License

AetherCore is dual-licensed under:

- **MIT License** - See [LICENSE](LICENSE)
- **Apache License 2.0** - See [LICENSE](LICENSE)

You may choose either license at your option.

---

## 🔗 Links

- **Repository:** https://github.com/FourMIK/AetherCore
- **Releases:** https://github.com/FourMIK/AetherCore/releases
- **Issues:** https://github.com/FourMIK/AetherCore/issues
- **Security:** security@aethercore.io (PGP key in SECURITY.md)

---

## 🙏 Acknowledgments

This release represents the culmination of rigorous architectural work adhering to 4MIK AetherCore Architect principles:

- Zero tolerance for mocks in production paths
- Memory safety as a first principle
- Cryptographic certainty over policy-based trust
- Fail-visible integrity verification
- Hardware-rooted identity for all nodes

The system is designed for environments where trust cannot be assumed and cryptographic proof is mandatory.

---

**Classification:** OPERATIONAL  
**Distribution:** UNLIMITED  
**Version:** 0.2.0  
**Date:** 2026-02-12
