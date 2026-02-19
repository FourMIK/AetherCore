# Android Key Manager Module

This module adds Android-side enrollment key handling with hardware security preferences:

1. Requests a StrongBox-backed EC key first when supported.
2. Falls back to TEE-backed key if StrongBox generation is unavailable.
3. Exposes runtime security-level introspection (`STRONGBOX` vs `TRUSTED_ENVIRONMENT`).
4. Collects attestation artifacts and packages them into an enrollment `prove` payload.
5. Persists only key references (alias + security level metadata), never private key bytes.

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
