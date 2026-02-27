# AetherCore Prioritized Backlog (Validated vs 4MIK Trust Model)

Date: 2026-02-23  
Source of truth for gaps: `docs/4MIK_GAP_VALIDATION_2026-02-23.md`

## Status Snapshot (Post-Wave 2)

Implemented on active path:
- AC-P0-01 (gateway cryptographic ingress verification)
- AC-P0-02 (active TS signing path migration to Ed25519)
- AC-P0-03 (replay envelope fields + gateway enforcement)
- AC-P0-04 (authenticated chat payload encryption with ephemeral ECDH session keys)
- AC-P0-05 (gateway->C2 transport TLS/mTLS production gating)
- AC-P0-06 (macOS optional sentinel skip explicit opt-in)
- AC-P1-01 (presence auth + server-derived trust semantics)
- AC-P1-04 (chat envelope trust semantics unified with Guardian verification status model)
- AC-P1-05 (CI security regression gates for spoof/replay/tamper and transport/encryption invariants)

In progress on active path:
- AC-P1-02 (onboarding now requests real enrollment certificates and performs X.509 validation + revocation checks; full service-integration test coverage pending)

## Prioritization Method

Ranking criteria (in order):
1. Exploitability on current active path (desktop gateway + Pi chat)
2. Potential impact (node impersonation, trust collapse, data disclosure)
3. Breadth of exposure (all nodes vs subset)
4. Implementation dependency chain (what unlocks other fixes)

Priority definitions:
- P0: Must complete before field pilot where trust/authenticity is claimed
- P1: Required for production-grade security posture
- P2: Hardening, resilience, and operational excellence

## Backlog Overview

| ID | Priority | Item | Why now | Estimate | Depends on | Status |
|---|---|---|---|---|---|
| AC-P0-01 | P0 | Enforce cryptographic verification at gateway ingress | Current trust can be spoofed with non-empty signature string | M | none | Completed |
| AC-P0-02 | P0 | Replace placeholder signing/verification in active TS paths | Prevent trivial forgery and false trust elevation | M | AC-P0-01 | Completed |
| AC-P0-03 | P0 | Add replay defenses to chat envelope and verifier | Prevent captured-message replay and order tampering | M | AC-P0-01 | Completed |
| AC-P0-04 | P0 | Encrypt chat payloads with per-session keys | Prevent plaintext disclosure on captured transport | L | AC-P0-02 | Completed |
| AC-P0-05 | P0 | Secure gateway-to-c2-router transport (TLS/mTLS) | Remove insecure internal trust link | S | none | Completed |
| AC-P0-06 | P0 | Production profile fail-closed by default | Remove optional bypass as default operational posture | S | none | Completed |
| AC-P1-01 | P1 | Presence attestation + server-derived trust | Stop client self-asserted trust values | M | AC-P0-01 | Completed |
| AC-P1-02 | P1 | Replace simulated onboarding cert flow | Move from mock cert trust to real enrollment trust | L | AC-P0-02 | In Progress |
| AC-P1-03 | P1 | Integrate revocation with sovereign/quorum model | Replace local-file revoke semantics with network trust revocation | L | AC-P1-02 | In Progress |
| AC-P1-04 | P1 | Unify chat envelope with Guardian signed envelope model | Eliminate split trust semantics across subsystems | M | AC-P0-02, AC-P0-03 | Completed |
| AC-P1-05 | P1 | CI security regression gates | Prevent backsliding on signature/replay/encryption requirements | M | AC-P0-01..AC-P0-06 | Completed |
| AC-P2-01 | P2 | Activate mesh semantics in active path (gossip/quorum/DDIL behavior) | Align runtime behavior with architecture claims | XL | AC-P1-04 | Open |
| AC-P2-02 | P2 | Security telemetry and SLOs | Faster detection and measurable security posture | M | AC-P1-05 | Open |
| AC-P2-03 | P2 | Doc/runbook parity and release gates | Keep docs truth-aligned with implementation | S | AC-P1-05 | In Progress |

## Detailed Backlog Items

### AC-P0-01: Enforce Cryptographic Verification at Gateway Ingress

Status: Completed (implemented in `services/gateway/src/index.ts`).

Scope:
- Replace signature-presence checks with cryptographic verification against enrolled identity/public key.
- Reject unverifiable messages with explicit error and audit event.

Key files:
- `services/gateway/src/index.ts`
- `packages/shared/src/c2-message-schema.ts`

Acceptance criteria:
- Gateway no longer sets `verified` from signature string existence.
- Invalid signature, unknown key, malformed signature are rejected.
- `trust_status='verified'` only when cryptographic verification passes.
- Unit and integration tests cover valid, invalid, missing, malformed signatures.

### AC-P0-02: Replace Placeholder Signing/Verification in Active TS Paths

Status: Completed (implemented in Pi mesh and dashboard C2 clients).

Scope:
- Remove `placeholder:sha256:*` signing behavior from chat paths.
- Use real Ed25519 signing and verification (through approved crypto/identity interface).

Key files:
- `agent/linux/src/c2/mesh-client.ts`
- `packages/dashboard/src/services/c2/C2Client.ts`

Acceptance criteria:
- No placeholder signatures accepted in non-dev/test mode.
- Signed message verification succeeds only for valid key/material.
- Security tests demonstrate spoofed-signature rejection end-to-end.

### AC-P0-03: Add Replay Defenses to Chat Envelope and Verifier

Status: Completed (schema + gateway replay checks are active).

Scope:
- Add replay/ordering fields to envelope (nonce + monotonic sequence + optional previous hash).
- Enforce freshness window and sequence/nonce uniqueness per sender/session.

Key files:
- `packages/shared/src/c2-message-schema.ts`
- gateway and client verifier handlers

Acceptance criteria:
- Replayed envelope is rejected deterministically.
- Out-of-order/duplicate sequence behavior is tested and logged.
- Backward compatibility strategy documented for protocol version transition.

### AC-P0-04: Encrypt Chat Payloads with Per-Session Keys

Status: Completed (ECDH P-256 + AES-256-GCM now active in dashboard/Pi chat path).

Scope:
- Implement authenticated encryption for payloads with session-specific keys.
- Use ephemeral key agreement and rotate keys by policy (message count/time).

Key files:
- `agent/linux/src/c2/mesh-client.ts`
- `packages/dashboard/src/services/c2/C2Client.ts`
- `packages/shared/src/c2-message-schema.ts`
- `services/gateway/src/index.ts`

Acceptance criteria:
- Payload content is not readable in transport capture.
- Tampered ciphertext fails authentication and is rejected.
- Key rotation and session renegotiation are tested.

### AC-P0-05: Secure Gateway-to-C2-Router Transport

Status: Completed (production TLS/mTLS fail-closed controls are active).

Scope:
- Replace insecure gRPC credentials with TLS (prefer mTLS for production profile).

Key files:
- `services/gateway/src/c2-client.ts`

Acceptance criteria:
- `createInsecure()` removed from production path.
- Gateway fails closed on certificate/identity mismatch.
- Deployment docs include certificate provisioning steps.

### AC-P0-06: Production Profile Fail-Closed by Default

Status: Completed (macOS optional sentinel skip is explicit opt-in).

Scope:
- Ensure production profile enforces required hardware policy and disallows optional skip flags.
- Keep dev profile behavior explicit and isolated.

Key files:
- `packages/dashboard/src-tauri/src/config.rs`
- `packages/dashboard/src-tauri/src/lib.rs`
- `packages/dashboard/src-tauri/resources/config/runtime-config.template.json`

Acceptance criteria:
- Production config cannot start with sentinel skip/optional fallback.
- Dev/local profile remains available but clearly labeled reduced-trust.
- Startup tests validate policy matrix (required/optional/disabled).

### AC-P1-01: Presence Attestation and Server-Derived Trust

Status: Completed (presence signatures are verified and trust is gateway-derived).

Scope:
- Remove client-authoritative trust fields from acceptance logic.
- Compute trust state server-side from verification/attestation outcomes.

Key files:
- `services/gateway/src/index.ts`

Acceptance criteria:
- Presence endpoint rejects unsigned/unverifiable attestation payloads.
- Trust score cannot be elevated by client-supplied values alone.
- Presence record contains verification provenance.

Implementation notes:
- Gateway now derives trust score from verification factors (`signature`, `replay`, prior key binding, TPM-backed flag) and clamps the value server-side.
- Client-supplied `identity.trust_score` in HTTP presence payloads is ignored/overridden during ingestion.
- Presence/session payloads now carry provenance metadata (`key_source`, `signature_verified`, `replay_verified`, derivation version, evaluation timestamp).

### AC-P1-02: Replace Simulated Onboarding Certificate Flow

Status: In Progress.

Scope:
- Replace simulated cert issuance/validation with real enrollment service path.
- Validate signature chain, expiry, revocation, and policy constraints.

Key files:
- `agent/linux/src/integration/onboarding.ts`

Acceptance criteria:
- No simulated certificate generation in production mode.
- Enrollment fails closed on invalid/expired/revoked certificate.
- Enrollment integration test runs against a real or faithful test CA/service.

Implementation notes:
- Pi onboarding now calls enrollment service over HTTP(S) with retry + timeout controls instead of generating simulated certificates locally.
- Response parsing requires concrete certificate/trust fields and normalizes certificate serial from X.509 metadata when needed.
- Validation now enforces certificate validity window, public-key binding, issuer verification against configured CA material, revocation checks, and production fail-closed behavior on unknown revocation/CA state.
- Persisted identities are re-evaluated for certificate integrity/expiry on startup (strict in production, warning in non-production).

### AC-P1-03: Revocation via Sovereign/Quorum Trust Model

Status: In Progress.

Scope:
- Replace local file deletion revocation semantics with distributed revocation source.
- Enforce revocation checks in active message verification path.

Acceptance criteria:
- Revoked identity is rejected across reconnects and restarts.
- Revocation propagation behavior is tested and observable.

Implementation notes:
- Gateway now supports a distributed revocation source (`AETHERCORE_REVOCATION_SOURCE_URL`) with periodic synchronization and optional fail-closed enforcement when sync state is unavailable.
- Active verification paths now gate operator presence/chat/call envelopes and Ralphie presence ingestion against sovereign revocation data.
- Revocation sync emits structured logs and broadcasts `REVOCATION_EVENT` notifications when active node presence is evicted.
- Added integration tests covering revocation source parsing, propagation refresh behavior, restart rejection semantics, and fail-closed policy handling.

### AC-P1-04: Unify Chat Envelope with Guardian Signed Envelope Model

Status: Completed.

Scope:
- Migrate chat signaling envelope to shared signed-envelope standard, or provide strict adapter with equivalent guarantees.

Key files:
- `packages/shared/src/types/guardian.ts`
- chat/gateway message handlers

Acceptance criteria:
- Single trust semantics across collaboration/chat verification paths.
- Nonce/timestamp/signature invariants enforced consistently.

Implementation notes:
- Shared C2 schema now normalizes `trust_status` with Guardian-style `verification_status` and enforces consistency invariants.
- Gateway, dashboard C2 client, and Pi chat consumers now use shared verification mapping helpers for a single trust interpretation path.

### AC-P1-05: CI Security Regression Gates

Status: Completed.

Scope:
- Add CI checks that fail on reintroduction of placeholder signing, insecure transport, missing replay checks, or plaintext payload mode in production profile.

Acceptance criteria:
- CI pipeline blocks merges on failed security invariants.
- Negative tests include spoof, replay, and tamper cases.

Implementation notes:
- Added `services/gateway/src/__tests__/security-regression.integration.test.ts` covering spoof/replay/tamper negative cases and active-path static invariant checks.
- Gateway test scripts now include the new security regression suite as part of integration runs.
- CI (`.github/workflows/ci.yml`) includes an explicit security regression gate step.

### AC-P2-01: Activate Mesh Semantics in Active Path

Status: Open.

Scope:
- Implement or expose gossip/quorum/DDIL behavior in the actively used desktop/chat runtime path.

Acceptance criteria:
- Documented and tested behavior for partition, heal, quorum decisions, and degraded links.

### AC-P2-02: Security Telemetry and SLOs

Status: Open.

Scope:
- Emit structured events for signature failures, replay blocks, attestation failures, and revocation hits.
- Define SLOs for detection and response.

Acceptance criteria:
- Dashboard/alerts show actionable security event streams.
- Security KPIs tracked per release.

### AC-P2-03: Documentation and Release Gate Parity

Status: In Progress.

Scope:
- Require doc parity check before release for security claims.
- Keep `SECURITY.md`, `SECURITY_SCOPE.md`, `SECURITY_SUMMARY.md`, and gap matrix synchronized.

Acceptance criteria:
- Release checklist includes mandatory security-claim verification.
- No production claim can ship without matching implementation evidence.

## Execution Plan (Recommended)

Wave 1 (Completed):
- AC-P0-01, AC-P0-02, AC-P0-03, AC-P0-05, AC-P0-06

Wave 2 (Completed):
- AC-P1-01

Wave 3 (Current focus):
- AC-P1-02, AC-P1-03, AC-P1-04, AC-P1-05

Wave 4:
- AC-P2-01, AC-P2-02, AC-P2-03

## Release Gate

Do not claim 4MIK trust-model parity for field deployment until:
- All P0 items are complete and verified.
- P1-05 is complete (minimum production trust floor).
