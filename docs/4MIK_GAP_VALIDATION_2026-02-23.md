# AetherCore vs 4MIK Trust Model: Validated Gap Matrix

Date: 2026-02-23  
Scope: Current source tree only (code-validated).

## Executive Summary

Wave 1 trust-path hardening is now implemented on the active desktop gateway + Pi chat flow:
- Ed25519 signature verification at gateway ingress is active.
- Replay defenses (`nonce`, `sequence`, `previous_message_id`) are enforced.
- HTTP presence (`/ralphie/presence`) is now signed and verified.
- Gateway->C2 gRPC has production TLS/mTLS fail-closed controls.

4MIK parity is still incomplete. Major remaining gaps are production-grade enrollment/revocation semantics and decentralized trust-mesh runtime behavior.

## Status Legend

- `CLOSED`: Implemented and validated in current active path.
- `PARTIAL`: Implemented in part, but model-level requirement not fully met.
- `OPEN`: Not yet implemented in active path.

## Validated Findings

| 4MIK expectation | Status | Evidence | Notes |
|---|---|---|---|
| Cryptographic verification at ingress (not signature-presence checks) | CLOSED | `services/gateway/src/index.ts:282`, `services/gateway/src/index.ts:553`, `services/gateway/src/index.ts:616` | Gateway rejects invalid/missing signatures before trust elevation. |
| Sender key binding and anti-impersonation checks | CLOSED | `services/gateway/src/index.ts:303`, `services/gateway/src/index.ts:315`, `services/gateway/src/index.ts:379` | Public-key mismatch is rejected for both envelopes and HTTP presence. |
| Replay/ordering protections in protocol envelope | CLOSED | `packages/shared/src/c2-message-schema.ts:78`, `packages/shared/src/c2-message-schema.ts:81`, `services/gateway/src/index.ts:423` | Nonce, monotonic sequence, and chain continuity are enforced. |
| Presence authentication at HTTP ingress | CLOSED | `agent/linux/src/c2/mesh-client.ts:475`, `agent/linux/src/c2/mesh-client.ts:496`, `services/gateway/src/index.ts:355`, `services/gateway/src/index.ts:828` | `/ralphie/presence` now requires verifiable Ed25519 signature. |
| Production signing/verification primitives in active TS chat paths | CLOSED | `agent/linux/src/c2/mesh-client.ts:469`, `packages/dashboard/src/services/c2/C2Client.ts:768`, `packages/dashboard/src/services/c2/C2Client.ts:827` | Placeholder chat signatures removed from active C2 path. |
| Authenticated secure transport on internal service links | CLOSED | `services/gateway/src/c2-client.ts:69`, `services/gateway/src/c2-client.ts:74`, `services/gateway/src/c2-client.ts:101`, `services/gateway/src/c2-client.ts:113` | Production requires TLS/mTLS and rejects insecure mode. |
| macOS optional sentinel skip default posture | CLOSED | `packages/dashboard/src-tauri/src/lib.rs:348` | Optional sentinel skip is now explicit opt-in via env var. |
| Payload confidentiality for chat content | CLOSED | `agent/linux/src/c2/mesh-client.ts`, `packages/dashboard/src/services/c2/C2Client.ts`, `packages/shared/src/c2-message-schema.ts` | Chat payload now uses authenticated encryption (ECDH P-256 key agreement + AES-256-GCM ciphertext/auth tag fields) on active dashboard/Pi chat path. |
| Presence trust must be server-derived (not client self-asserted) | CLOSED | `services/gateway/src/index.ts:238`, `services/gateway/src/index.ts:621`, `services/gateway/src/index.ts:902` | Trust score is now derived by gateway verification outcomes and client-supplied trust values are overridden. |
| Real certificate enrollment/validation | PARTIAL | `agent/linux/src/integration/onboarding.ts:499`, `agent/linux/src/integration/onboarding.ts:561`, `agent/linux/src/integration/onboarding.ts:648` | Simulated cert issuance removed from active onboarding path; enrollment now requires server response with X.509 validation + revocation checks, but full CA-service integration test coverage is still pending. |
| Sovereign/quorum revocation behavior | OPEN | `agent/linux/src/integration/onboarding.ts:877`, `agent/linux/src/integration/onboarding.ts:887` | Revocation execution still uses local-file backup/delete semantics rather than distributed trust governance. |
| Decentralized trust mesh semantics in active chat/gateway path | OPEN | `config/local-control-plane.toml:15`, `packages/dashboard/src-tauri/resources/macos/local-control-plane/launchers/gateway-launcher:5` | Active path remains centralized service orchestration. |

## What Changed Since Initial Gap Pass

- Closed: ingress cryptographic verification, replay metadata/enforcement, active TS Ed25519 signing, C2 transport TLS/mTLS gating, macOS optional-skip default, signed HTTP presence ingestion, and server-derived presence trust.
- Partial progress: onboarding certificate flow now uses real enrollment requests with X.509 validity/key/issuer checks plus revocation queries.
- Still open: enrollment/revocation maturity (remaining lifecycle and distributed-governance semantics) and full decentralized runtime semantics.

## Bottom Line

The high-risk spoof/replay gaps in the active desktop gateway + Pi chat path are now closed.  
Current residual risk is concentrated in trust/governance lifecycle and architecture parity (enrollment/revocation and decentralized mesh behavior).
