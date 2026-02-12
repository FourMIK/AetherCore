# Changelog

All notable changes to AetherCore will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-12

### Added

#### Core Infrastructure
- Hardware-rooted identity system with TPM 2.0 / Secure Enclave support
- Ed25519 signature verification for all node communications
- BLAKE3 hashing for integrity checks (SHA-256 deprecated)
- Merkle Vine™ structure for historical data anchoring
- Byzantine node detection (The Aetheric Sweep)
- Fail-visible mode for unverified data

#### Services
- Identity service with TPM attestation gate
- Stream processing with integrity tracking
- H2 ingest service for telemetry data
- C2 router for command and control
- Trust mesh coordination

#### Desktop Application (Tactical Glass)
- GPU-accelerated dashboard for fleet visualization
- Real-time mesh status monitoring
- Node deployment management
- Zero-touch enrollment via QR codes
- Hardware pairing for ESP32 devices

#### Configuration
- Production configuration (`config/production.yaml`)
  - Hardware TPM mode
  - Strict verification
  - TLS 1.3 required
  - Byzantine sweep enabled
- Testing configuration (`config/testing.yaml`)
  - Dev mode with simulated TPM
  - Lenient verification for development
  - HTTP/WS support for local testing
  - SQLite database

#### Documentation
- Complete architecture documentation
- Security model and threat analysis
- Installation guides for all platforms
- Production deployment playbook
- TPM configuration guide
- Protocol overview

#### Development Tools
- Comprehensive release checklist script
- SBOM generation
- License compliance validation
- Cross-platform build support

### Security

#### Cryptographic
- TPM 2.0 hardware-backed signatures
- Ed25519 for all signing operations
- BLAKE3 for all hashing operations
- X25519 for key exchange
- ChaCha20-Poly1305 for encryption

#### Network
- TLS 1.3 minimum for production
- WebSocket Secure (WSS) for C2 connections
- Attestation required before data transmission
- Certificate chain validation

#### Operational
- Fail-visible design philosophy
- Immediate rejection of unverified data
- Automated Byzantine node isolation
- Audit logging for security events
- Revocation ledger ("The Great Gospel")

### Changed
- Migrated from SHA-256 to BLAKE3 for performance
- Replaced mock TPM with hardware-rooted implementation
- Updated dashboard to enforce production mesh connections

### Deprecated
- SHA-256 hash algorithm (use BLAKE3)
- Mock TPM providers (use hardware or simulated mode)
- Stub implementations (panic in production mode)

### Known Issues
- First build time can be 10-15 minutes (Rust compilation)
- TPM hardware mode requires additional platform testing
- Multi-node mesh coordination needs optimization
- Dashboard performance degrades with >100 nodes
- WebSocket reconnection can take up to 30 seconds

### Breaking Changes
- Configuration format changed from JSON to YAML
- TPM interface updated to TPM 2.0 specification
- API endpoints restructured for REST compliance
- WebSocket message format updated

## Version Numbers

### Alpha Releases (0.x.x)
- Early testing and validation
- Dev mode enabled by default
- Breaking changes expected
- Not for production use

### Beta Releases (1.x.x-beta)
- Feature complete
- Production-ready infrastructure
- Stable API
- TPM validation optional

### Production Releases (1.x.x)
- General Availability
- Full TPM hardware validation
- Long-term support
- Backwards compatibility guaranteed

## Release Artifacts

Each release includes:
- **macOS:** Universal binary (.dmg) for Intel and Apple Silicon
- **Windows:** MSI installer for x64
- **Linux:** AppImage for x86_64
- **Source:** Complete source code archive
- **Checksums:** SHA256 for all artifacts
- **SBOM:** Software Bill of Materials

## Support

- **Latest Release:** https://github.com/FourMIK/AetherCore/releases/latest
- **Issues:** https://github.com/FourMIK/AetherCore/issues
- **Security:** See [SECURITY.md](SECURITY.md)
- **Documentation:** See [README.md](README.md)

---

[Unreleased]: https://github.com/FourMIK/AetherCore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FourMIK/AetherCore/releases/tag/v0.1.0
