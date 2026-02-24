# Changelog

All notable changes to AetherCore will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2026-02-23

#### Added

##### Security Analysis and Planning
- Gap validation against the 4MIK trust model with explicit implementation-vs-claim deltas in `docs/4MIK_GAP_VALIDATION_2026-02-23.md`.
- Prioritized remediation backlog with execution waves and release gate criteria in `docs/PRIORITIZED_BACKLOG_2026-02-23.md`.

##### Protocol Hardening
- Replay-defense metadata in C2 envelopes (`nonce`, `sequence`, `previous_message_id`) with canonical signing coverage in `packages/shared/src/c2-message-schema.ts`.
- Shared schema tests for replay-chain and deterministic serialization behavior in `packages/shared/src/__tests__/c2-message-schema.test.ts`.
- Authenticated chat payload encryption on active dashboard <-> Pi chat path using ephemeral ECDH P-256 key agreement and AES-256-GCM payload sealing in:
  - `packages/dashboard/src/services/c2/C2Client.ts`
  - `agent/linux/src/c2/mesh-client.ts`
- Extended chat payload schema for encrypted transport (`ciphertext`, `nonce`, `authTag`, sender key material, key epoch metadata) in `packages/shared/src/c2-message-schema.ts`.

#### Changed

##### Gateway Message Trust Enforcement
- Replaced signature-presence trust assumptions with cryptographic Ed25519 verification at gateway ingress in `services/gateway/src/index.ts`.
- Added sender key binding and mismatch rejection logic for envelope/public-key identity consistency in `services/gateway/src/index.ts`.
- Enforced replay checks (duplicate nonce, non-monotonic sequence, chain mismatch) before routing presence/chat/call envelopes in `services/gateway/src/index.ts`.
- Extended Ralphie presence acceptance to include sender `public_key` registration for downstream verification in `services/gateway/src/index.ts`.
- Enforced Ed25519 signature verification on HTTP `/ralphie/presence` ingestion with sender-key binding checks in `services/gateway/src/index.ts`.
- Extended Ralphie presence identity schema to include `chat_public_key` for encrypted chat key distribution in `services/gateway/src/index.ts`.
- Switched presence trust handling to server-derived scoring in `services/gateway/src/index.ts`; client-supplied `identity.trust_score` is no longer authoritative.
- Added presence verification provenance (`signature_verified`, `replay_verified`, key source, derivation version, evaluation timestamp) to stored/broadcast presence records in `services/gateway/src/index.ts`.

##### Active Client Signing Paths
- Replaced placeholder chat signing in Pi mesh path with real Ed25519 signing in `agent/linux/src/c2/mesh-client.ts`.
- Added public-key advertisement in Pi mesh presence and HTTP presence payloads in `agent/linux/src/c2/mesh-client.ts`.
- Added deterministic Ed25519 signing for Pi HTTP presence payloads in `agent/linux/src/c2/mesh-client.ts`.
- Added chat encryption public-key advertisement (`chat_public_key`) in Pi presence envelope + HTTP presence payload in `agent/linux/src/c2/mesh-client.ts`.
- Wired enrolled identity `public_key` through Pi chat entrypoints:
  - `agent/linux/src/chat-app.ts`
  - `agent/linux/src/chat-gui-app.ts`
  - `agent/linux/src/index.ts`
- Replaced placeholder dashboard C2 signing/verification with WebCrypto Ed25519 sign/verify flow in `packages/dashboard/src/services/c2/C2Client.ts`.
- Added sender public-key cache and verification path for inbound envelopes in `packages/dashboard/src/services/c2/C2Client.ts`.
- Added dashboard chat encryption key generation/caching, encrypted send path, and authenticated decrypt/reject path in `packages/dashboard/src/services/c2/C2Client.ts`.
- Removed local placeholder signature stub in `packages/dashboard/src/store/useCommStore.ts`.

##### Onboarding Certificate Flow
- Replaced simulated certificate issuance in Pi onboarding with real enrollment HTTP request flow (retry + timeout controls) in `agent/linux/src/integration/onboarding.ts`.
- Added strict enrollment response parsing and fail-closed production behavior for malformed enrollment responses in `agent/linux/src/integration/onboarding.ts`.
- Added X.509 validation in onboarding for certificate validity window, serial consistency, public-key binding, and trusted issuer verification using configured CA material in `agent/linux/src/integration/onboarding.ts`.
- Added enrollment revocation checks during onboarding with production fail-closed handling on unknown revocation status in `agent/linux/src/integration/onboarding.ts`.
- Added persisted identity certificate sanity checks at startup (strict in production, warning-only in non-production) in `agent/linux/src/integration/onboarding.ts`.

##### Transport and Startup Policy
- Secured gateway-to-C2-router client credential handling with TLS/mTLS production gating and explicit insecure-mode controls in `services/gateway/src/c2-client.ts`.
- Changed macOS optional sentinel skip default to fail-closed (`false` unless explicitly enabled) in `packages/dashboard/src-tauri/src/lib.rs`.

#### Security
- Gateway now marks operator/chat envelope trust as `verified` only after successful cryptographic verification and replay validation.
- Gateway presence trust no longer depends on client self-asserted trust values; trust is derived from verification outcomes and attestation context.
- Insecure gRPC transport is blocked by default in production profiles unless explicitly and intentionally overridden for non-production use.
- Default startup posture on macOS reduced bypass risk by requiring explicit opt-in for optional sentinel skip.
- Active dashboard <-> Pi chat path now seals payloads with authenticated encryption and rejects tampered ciphertext at receiver.

#### Documentation
- Updated security posture documentation set during field-test hardening:
  - `SECURITY.md`
  - `SECURITY_SCOPE.md`
  - `SECURITY_HARDENING.md`
  - `SECURITY_SUMMARY.md`
- Reconciled implementation-status documentation to mark completed Wave 1 items and current open gaps:
  - `docs/4MIK_GAP_VALIDATION_2026-02-23.md`
  - `docs/PRIORITIZED_BACKLOG_2026-02-23.md`
- Updated gap/backlog/security language to reflect AC-P0-04 completion on active chat path and remaining trust/lifecycle gaps.

### 2026-02-22

#### Added

##### Messaging Functionality
- Added Pi-side authenticated chat CLI with peer discovery, active-peer routing, `/reply`, `/history`, and persisted per-peer history in `agent/linux/src/chat-app.ts` and `agent/linux/src/chat-common.ts`.
- Added Pi-side chat GUI app (local web UI server + browser launcher) with live peer roster, message history, and C2 status pills in `agent/linux/src/chat-gui-app.ts`.
- Added mesh chat transport handling for chat/ack/presence envelopes with queueing and reconnect backoff behavior in `agent/linux/src/c2/mesh-client.ts`.
- Added operational deployment/run/test scripts for Pi messaging workflows:
  - `scripts/ops/deploy-pi-chat-app.sh`
  - `scripts/ops/run-pi-chat.sh`
  - `scripts/ops/deploy-pi-chat-gui.sh`
  - `scripts/ops/run-pi-chat-gui.sh`
  - `scripts/ops/check-pi-chat.sh`
- Added dashboard communications bootstrap that seeds only local operator identity (no synthetic remote peers) until authenticated presence arrives in `packages/dashboard/src/store/initComms.ts`.

##### Heltech LoRa V4 Connectivity
- Added one-command Heltech WiFi LoRa 32 V4 onboarding for USB auto-detect or Meshtastic Wi-Fi TCP mode in `scripts/ops/connect-heltech-v4.sh`.
- Added Heltech presence bridge for publishing startup/heartbeat presence with optional GPS/power/radio telemetry in `scripts/ops/bridge-heltech-presence.sh`.
- Added Meshtastic live telemetry bridge (serial/TCP ingestion -> gateway presence publishing) in `scripts/ops/bridge-heltech-meshtastic.py`.
- Added Heltech telemetry verification tooling for bridge health and live presence telemetry checks in `scripts/ops/check-heltech-telemetry.sh`.
- Added full-node orchestration workflow (local app + Heltech + Pi + validations) in `scripts/ops/bringup-all-nodes.sh`.

#### Changed

##### Tactical Glass UI Updates
- Updated Comm workspace with authenticated messaging UX (operator roster, verification/trust badges, secure compose, and call actions) in `packages/dashboard/src/components/workspaces/CommView.tsx`.
- Updated TopBar operational HUD to include Aetheric Link indicator, Pi mesh status, backend-core status, and live UTC clock in `packages/dashboard/src/components/hud/TopBar.tsx`.
- Added operator-grade C2 diagnostics panel with state, RTT, heartbeat loss, queue depth, and reconnect controls in `packages/dashboard/src/components/c2/C2StatusPanel.tsx`.
- Added Bootstrap onboarding flow for local stack readiness, mesh connectivity checks, first-node deployment, and remediation guidance in `packages/dashboard/src/components/onboarding/BootstrapOnboarding.tsx`.
- Enhanced fail-visible connection behavior and heartbeat sentinel state degradation logic in `packages/dashboard/src/services/api/WebSocketManager.ts`.
- Integrated LoRa telemetry-aware node status derivation and map updates (`snr/rssi`, GPS, battery) in `packages/dashboard/src/store/useCommStore.ts`.

## [0.2.0] - 2026-02-12

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

[Unreleased]: https://github.com/FourMIK/AetherCore/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/FourMIK/AetherCore/releases/tag/v0.2.0
