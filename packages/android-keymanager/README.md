# Android Key Manager Module

This module adds Android-side enrollment key handling with hardware security preferences:

1. Requests a StrongBox-backed EC key first when supported.
2. Falls back to TEE-backed key if StrongBox generation is unavailable.
3. Exposes runtime security-level introspection (`STRONGBOX` vs `TRUSTED_ENVIRONMENT`).
4. Collects attestation artifacts and packages them into an enrollment `prove` payload.
5. Persists only key references (alias + security level metadata), never private key bytes.
5. Runs enrollment against CodeRalphie-compatible endpoint flow (`/api/v1/enroll/hello` then `/api/v1/enroll/prove`).
6. Persists enrollment outputs: client certificate, trust bundle, and key reference metadata.
7. Provides startup gating checks to block service activation unless enrollment artifacts and keystore key are valid.

## Main API

- `AndroidEnrollmentKeyManager.ensureEnrollmentKey(challenge)`
- `AndroidEnrollmentKeyManager.securityLevel()`
- `AndroidEnrollmentKeyManager.collectAttestation(challenge)`
- `AndroidEnrollmentKeyManager.buildEnrollmentProvePayload(challenge)`

## Tests

Instrumentation tests are under `src/androidTest` and cover:

- StrongBox available path
- StrongBox fallback to TEE path
- alias persistence behavior across manager recreation (restart/update simulation)


## Enrollment Client

- `AndroidEnrollmentClient.enroll(deviceId)` executes hello/prove sequence and stores issued artifacts.
- `EnrollmentStartupGate.assertServiceActivationAllowed()` enforces enrollment artifact integrity at startup.
