# AetherCore Field-Test Due Diligence (Functional Alignment)

**Date:** 2026-03-06  
**Scope:** Functional readiness and deviations vs field-test purpose.  
**Inputs reviewed:**  
- `C:\Users\Owner\Downloads\4MIK_QuadChart_SOFWERX.pptx` (Quad Chart, SOFWERX)  
- `C:\Users\Owner\Downloads\AetherCore_DoD_White_Paper_v3.docx` (DoD White Paper v3, 2026-02-13)  
- Repo evidence (notably `docs/FIELD_TEST_OPERATOR_MANUAL.md`, `ARCHITECTURE.md`, `SECURITY.md`, `agent/linux/*`, `crates/*`, `services/*`)

## Field-Test Purpose (Requirements Extract)

The following requirements are explicitly stated in the attached materials and/or the repo’s field-test manual:

### From Quad Chart (SOFWERX)
- **Hardware-rooted identity** for devices to prevent “identity collapse”.
- **Tamper-evident event provenance** appended at creation (near real time).
- **Local verification at the edge** (no centralized dependency for trust decisions).
- **Replay and command injection rejection**.
- **Partition-tolerant trust convergence**.
- **Performance targets:** sub-millisecond verification/signing (stated), plus measurable detection time and false reject rate.

### From DoD White Paper v3
- **Streaming chain-of-custody** for telemetry/ISR/commands with **skip links** and/or summarization for efficient verification.
- **Operate through DDIL conditions**: local continuity during partitions; reconcile proofs when links return.
- **Fail-visible behavior**: unverified data is marked; policy can block acceptance; reasons are surfaced.
- **Test metrics:** detection time for tampering, false reject rate, verification cost, trust convergence after partition, command integrity enforcement.

### From Repo Field Test Manual (`docs/FIELD_TEST_OPERATOR_MANUAL.md`)
- Field objectives with **measurable success criteria** (spoof/replay rejection, GNSS-denied validation rate, coordination without broadcast, latency percentiles, offline operation duration).

## Audit Summary (What Was Checked)

Primary “field-test critical path” areas reviewed:
- **Edge identity + signing path:** CodeRalphie Linux agent (`agent/linux`) enrollment/bootstrap, identity persistence, signing key handling.
- **Verification + replay defense:** Gateway presence verification, replay tracking, stream integrity tracking, C2 router replay protection.
- **Signing service (gRPC):** Rust signing service (`crates/crypto`) used by Trust Fabric components.

## Deviations Found (And Fixes Applied)

### 1) SigningService gRPC signed the wrong data + used unstable keys

**Why it matters:** A signing service that does not sign the actual bytes (or rotates keys per request) breaks verification, undermines provenance, and defeats replay/command-injection controls.

**Repo evidence:** `crates/crypto/proto/signing.proto` defines `SignMessage(message: bytes)`; the prior implementation signed a fabricated canonical event with an empty payload instead of `message`.

**Fix applied (now signs correct bytes + keeps stable per-node key in-process):**
- Added raw-byte signing API: `crates/crypto/src/signing.rs` (`EventSigningService::sign_bytes`)
- Corrected gRPC server behavior: `crates/crypto/src/grpc_server.rs`
  - `SignMessage` signs `req.message`
  - `CreateSignedEnvelope` signs `payload` string bytes
  - Node-scoped key is **stable within the running server** (no new key per request)

**Status:** Fixed in repo.

### 2) Linux agent used non-functional “BLAKE3 via Node crypto” + SHA-256 CSR hashing

**Why it matters:** Field test objectives require BLAKE3 chains/metadata and verifiable provenance. `crypto.createHash('blake3')` is not a reliable Node feature and breaks on typical builds; CSR hashing should match the repo’s BLAKE3-first posture.

**Fix applied:**
- Switched to repo-standard `hash-wasm` BLAKE3 in `agent/linux/src/integration/onboarding.ts`
- CSR hash now uses **BLAKE3** (base64 of 32-byte digest) and includes `csr_hash_alg: 'blake3'`

**Status:** Fixed in repo.

### 3) Linux agent “production” path did not provision a persistent Ed25519 signing key compatible with Gateway verification

**Why it matters:** Gateway presence verification expects Ed25519 signatures and a usable public key. The prior code path could produce identity/public-key mismatches and fall back to ephemeral signing keys.

**Fix applied:**
- `agent/linux/src/integration/onboarding.ts`
  - In production mode, **requires TPM availability** (fail-visible), but provisions a persisted **Ed25519** signing key for protocol compatibility.
  - Writes private key to `SIGNING_PRIVATE_KEY_PATH` (default: `/etc/coderalphie/keys/signing-key.pem`, mode `600`)
  - Writes identity `public_key` as the matching public key PEM
  - Sets `tpm_backed` based on actual TPM detection (not merely “production mode”)
- `agent/linux/src/c2/mesh-client.ts` now checks default key path `/etc/coderalphie/keys/signing-key.pem` even if env vars are not set.
- `agent/linux/install.sh` sets `AETHERCORE_SIGNING_PRIVATE_KEY_PATH` in the systemd unit environment.

**Status:** Fixed in repo.

### 4) Genesis/install flow produced misleading “identity artifacts” not aligned with runtime enrollment

**Why it matters:** Field test setup depends on deterministic, repeatable provisioning that matches the runtime agent behavior.

**Fix applied:**
- `agent/linux/src/index.ts` `--genesis` now runs the same enrollment bootstrap (`startEnrollment`) and outputs the persisted runtime identity record between the existing `IDENTITY_BLOCK_*` markers (for installer scraping/backwards compatibility).

**Status:** Fixed in repo.

## Verification Performed

- Rust: `cargo test -p aethercore-crypto --features grpc-server` (PASS)
- TypeScript: `pnpm --dir agent/linux run build` (PASS)

## Remaining Gaps / Risks (Not Fully Resolved)

These items are field-test relevant but are not fully fixable without additional repo changes or external dependencies:

1) **In-repo enrollment service endpoint (Resolved)**
   - Added `POST /api/enrollment` and `POST /api/revocation/check` to `services/gateway` to match the Linux agent defaults (`...:3000/api/enrollment`) and its integration test contract.
   - Enrollment now validates the base64 CSR payload (BLAKE3) and issues an X.509 leaf cert binding the provided Ed25519 public key (via `openssl`).
   - **Operational note:** For containerized gateway, `services/gateway/Dockerfile` now installs `openssl` (required for certificate issuance). Production use requires configuring CA key/cert paths via `AETHERCORE_ENROLLMENT_CA_KEY_PATH` and `AETHERCORE_ENROLLMENT_CA_CERT_PATH`.

2) **TPM attestation (quote/PCR) plumbing from edge agent to registry**
   - The repo contains TPM quote structures and identity registry proto fields (`tpm_quote`, `pcrs`, `ak_cert`), but the Linux agent enrollment request currently does not ship these artifacts end-to-end in a way that can be validated by the registry.
   - For field testing, this is the missing link between “TPM present” and “hardware-rooted trust proven”.

3) **Performance evidence**
   - The attached quad chart claims sub-millisecond verification/signing; the repo contains performance targets and some latency logging, but a repeatable field-test benchmark harness and acceptance thresholds wired into CI were **not found**.

4) **Doc consistency on TPM algorithms**
   - Repo docs often state “TPM Ed25519”, while TPM quote/signing codepaths include P-256/ECDSA in places. A single authoritative statement of “what is Ed25519 vs what is ECDSA (attestation)” should be reconciled for operator/engineering clarity.

## Recommended Next Actions (Field Test Readiness)

1) Add (or document) the **enrollment authority** used in field tests (URL, TLS trust, expected request/response, revocation endpoint).
2) Implement TPM quote capture and validation end-to-end for `RegisterNode` (agent -> service -> `crates/identity` verification), and ensure failures are **fail-visible** in Tactical Glass.
3) Add a small benchmark suite for:
   - signature verification cost per event
   - replay reject rate under controlled loss/reordering
   - trust convergence after partition heal
4) Run a scripted “field test dry run” with the manual’s success criteria recorded to an artifact (CSV/JSON) for after-action review.
