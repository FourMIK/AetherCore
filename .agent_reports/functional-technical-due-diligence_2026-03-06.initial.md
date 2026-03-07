# AetherCore — Functional Technical Due Diligence (FTDD)

**Date:** 2026-03-06 (America/New_York)  
**Repo:** `C:\Users\Owner\StudioProjects\AetherCore`  
**Branch / Commit:** `dev` @ `d1ef870`  
**Assessed on:** Windows (PowerShell)

## 0) Executive Summary

### Current status (Go / No-Go)

**No-Go for production / field deployment** based on objective build/test breakage and unresolved supply‑chain vulnerabilities:

- **Rust workspace does not compile** (`cargo check --workspace` fails) due to `services/h2-ingest` compile errors.
- **Rust test suite does not build** even when excluding `h2-ingest` (`cargo test --workspace --exclude h2-ingest` fails) due to stale tests and broken examples.
- **TypeScript workspace tests fail** at the monorepo level (`pnpm run test`) because `packages/tablet-app` runs Jest with **no tests** and exits non‑zero.
- **Supply chain gates are failing**:
  - `deny.toml` is **not compatible** with current `cargo-deny` (CI installs latest), so the “Operation Legal Shield” job would fail.
  - `cargo audit --deny warnings` reports **4 vulnerabilities** + **24 denied warnings**.
  - `pnpm audit --prod --audit-level high` reports **11 vulnerabilities** (8 high).

### What *is* strong / promising

- A coherent **Fail‑Visible** philosophy is present across the system (docs + code), with explicit remediation flows (e.g., Sentinel boot failures show operator actionable dialogs and hard-stop).
- The active desktop gateway + Pi chat flow has meaningful **crypto enforcement** (Ed25519 signature verification at ingress, replay/ordering metadata enforcement, Merkle‑Vine anchoring, and chat payload confidentiality via ECDH P‑256 + AES‑GCM) — also backed by integration tests in `services/gateway`.
- Local Control Plane orchestration exists with health checks, dependency ordering, and remediation hints (`config/local-control-plane.toml` + `packages/dashboard/src-tauri/src/local_control_plane.rs`).

### Highest‑priority blockers (P0)

1. **Rust build broken:** `services/h2-ingest` compile errors block workspace checks and CI docker builds.
2. **Tests/targets broken:** stale Rust tests (`crates/identity/tests/android_se_integration.rs`) and broken example (`crates/c2-router/examples/tak_bridge_publish.rs`) prevent `cargo test --workspace`.
3. **CI supply chain gate broken:** `deny.toml` incompatible with modern `cargo-deny` (the job as written will fail).
4. **Vulnerabilities:** Rust + Node audits currently fail at “deny” levels appropriate for your stated doctrine.
5. **Weak randomness fallback in protocol envelope:** `packages/shared/src/c2-message-schema.ts` falls back to `Math.random()` for UUID/nonce generation if WebCrypto is unavailable — violates Fail‑Visible doctrine for security‑critical fields.
6. **Infra mismatch:** `infra/docker/Dockerfile.*` uses **Node 18**, while the project enforces **Node 22.x** elsewhere; service-level Dockerfiles are Node 22. Compose/CI currently uses infra versions.

---

## 1) Scope & Method

### In-scope (performed)

- Repository/documentation inventory
- Build/test execution (Rust + TypeScript)
- Security posture review (crypto usage, fail-visible invariants, endpoint/TLS enforcement points)
- Supply chain checks (RustSec via `cargo audit`, npm audit via `pnpm audit`)
- CI/CD and infra review (GitHub Actions, Docker, Kubernetes, AWS Terraform)

### Out-of-scope / not validated end-to-end in this pass

- Real multi-node mesh behavior on contested networks
- Hardware-backed identity in real TPM/Secure Enclave environments (beyond code inspection + local dev-mode semantics)
- Field test operator workflows on target hardware (tablets/phones/edge radios)

---

## 2) System Overview (Functional)

### Components (as implemented in this tree)

- **Desktop Dashboard (Tactical Glass)**: `packages/dashboard/` (React + Vite) + `packages/dashboard/src-tauri/` (Rust/Tauri backend)
- **Local Control Plane**: orchestrates local services in Commander Edition bootstrap; manifest at `config/local-control-plane.toml`
- **Gateway Service**: `services/gateway/` (Express + WebSocket); performs signature verification, replay checks, Merkle‑Vine anchoring, store‑forward buffer, revocation gating
- **Collaboration Service**: `services/collaboration/` (WebSocket signaling; limited tests)
- **Auth Service**: `services/auth/` (minimal)
- **Rust core crates**: `crates/*` including `core`, `crypto`, `identity`, `stream`, `trust_mesh`, `c2-router`, etc.
- **Agent (Linux / Pi)**: `agent/linux/` (C2 client + onboarding/integration)
- **h2-ingest**: `services/h2-ingest/` (Rust ingest bridge, FLIR integration) — currently does not compile

### Active “trust path” (per `docs/4MIK_GAP_VALIDATION_2026-02-23.md`)

- Gateway ingress enforces **Ed25519 signature verification** and **replay defenses**
- Presence endpoint is **signed and verified** at HTTP ingress
- Gateway → C2 gRPC supports TLS/mTLS **fail-closed** controls
- Chat payload confidentiality implemented with authenticated encryption on the active path (ECDH P‑256 + AES‑GCM)

Residual gaps remain around decentralized trust mesh runtime semantics and full sovereign/quorum revocation governance.

---

## 3) Build, Test, and Quality Gates

### Toolchain observed

- Node: `v22.22.1`
- pnpm: `9.15.0`
- Rust: `rustc 1.93.0`, `cargo 1.93.0`

### TypeScript (pnpm workspace)

**Build:** ✅ `pnpm run build` succeeds.

**Tests (workspace):** ❌ `pnpm run test` fails due to `packages/tablet-app`:

- `packages/tablet-app` runs `jest` but has **no tests**, and Jest exits with code 1.
- Repro: `pnpm --dir packages/tablet-app test`
- Fix options:
  - Add tests, or
  - Change script to `jest --passWithNoTests`, or
  - Replace with `echo "No tests yet"` until tests exist.

**Lint:** ✅ `pnpm run lint` exits 0, but includes multiple warnings (explicit `any`, unused vars) across services.

### Rust (workspace)

**Compile:** ❌ `cargo check --workspace` fails (root cause: `services/h2-ingest`).

Observed failure patterns (representative):
- `services/h2-ingest/src/flir/udp_listener.rs`: `break;` used in a `Result`-typed loop (should return `break Ok(())` or restructure).
- `services/h2-ingest/src/video_ingest.rs`: moving out of `axum::Json<...>` via `unwrap_or_else` on `Option<String>` (use `.clone()`/borrow).
- `services/h2-ingest/src/flir/mod.rs`: `tokio::spawn` rejects `Box<dyn Error>` (future not `Send`) — use `Box<dyn Error + Send + Sync>` (or a concrete error type) across async boundaries.

**Compile excluding h2-ingest:** ✅ `cargo check --workspace --exclude h2-ingest` succeeds, but produces substantial warnings (unused imports, dead code, etc.) across `packages/dashboard/src-tauri`, `crates/android-ffi`, and `crates/identity`.

**Tests:** ❌ `cargo test --workspace --exclude h2-ingest` fails to build due to:

- Stale identity test referencing removed types/fields:
  - `crates/identity/tests/android_se_integration.rs` imports missing symbols and expects `Attestation::Android` + `policy_tier` field (no longer present).
- Broken example target:
  - `crates/c2-router/examples/tak_bridge_publish.rs` imports `aethercore_tak_bridge` / `aethercore_unit_status` but `aethercore-tak-bridge` is not in workspace members and c2-router has no dev-deps for these.

**Formatting gate:** ❌ `cargo fmt --all -- --check` fails (workspace not formatted).

**Clippy gate:** ❌ `cargo clippy --workspace --exclude h2-ingest -- -D warnings` fails (example failures include):

- `packages/dashboard/src-tauri/build.rs`: `clippy::useless_format`
- `crates/core/src/slashing.rs`: suggests `.or_default()` over `.or_insert_with(HashMap::new)`

---

## 4) Security & Cryptography (Findings)

### 4.1 Crypto primitives in active path

Strengths observed:

- **Ed25519 signatures** are verified at gateway ingress (`services/gateway/src/index.ts`).
- **Replay/ordering metadata** (`nonce`, `sequence`, `previous_message_id`) is enforced in shared schema + gateway.
- **Merkle‑Vine anchoring** is applied at gateway (`anchorEnvelopeInMerkleVine` uses BLAKE3 + stable stringify).
- **Chat confidentiality** is implemented with:
  - ECDH P‑256 key agreement + SHA‑256(K) derivation + AES‑256‑GCM
  - AAD binding to `(sender|recipient|keyEpoch)` in both dashboard and agent implementations

Key concerns:

- **Security‑critical randomness fallback:** `packages/shared/src/c2-message-schema.ts` falls back to `Math.random()` when WebCrypto is absent. This directly affects:
  - `message_id` generation
  - replay nonce generation (`nonce`)

This violates Fail‑Visible doctrine: the correct behavior is to **fail closed** or require a cryptographic RNG (WebCrypto or Node `crypto.randomBytes`), never silently downgrade.

### 4.2 SHA-256 usage vs “BLAKE3 exclusive” policy

The codebase uses SHA‑256 in several contexts:

- ECDH shared-secret KDF for chat AES key (`packages/dashboard/src/services/c2/C2Client.ts`, `agent/linux/src/c2/mesh-client.ts`)
- HMAC SHA‑256 for auth tokens (`services/auth/src/index.ts`)
- Certificate fingerprinting / tooling in onboarding (`agent/linux/src/integration/onboarding.ts`)
- TPM code references SHA‑2 family (`crates/identity/src/tpm.rs`) — likely required by TPM algorithms

Recommendation: update `SECURITY.md` to clearly distinguish:

- **Integrity hashing for protocol/telemetry:** BLAKE3
- **Standard crypto building blocks (TLS/X.509/KDF/HMAC):** may require SHA‑256/HKDF depending on platform constraints

### 4.3 Transport security & TLS policy enforcement

Observed:

- Client-side endpoint validation requires secure schemes for remote endpoints (`packages/dashboard/src/utils/endpoint-validation.ts`).
- `connect_to_mesh` enforces WSS endpoints at the Tauri boundary (`packages/dashboard/src-tauri/src/commands.rs` via `validate_ws_url(..., true)`).

Gaps:

- Gateway itself runs on **HTTP** (expected behind TLS termination), but internal service-to-service links are currently plain HTTP in k8s/docker examples.
- AWS ALB TLS policy is `ELBSecurityPolicy-TLS13-1-2-2021-06` (TLS 1.2 still allowed). If “TLS 1.3 only” is a hard requirement, this needs adjustment plus client compatibility validation.

### 4.4 Supply chain security status (objective)

#### RustSec (`cargo audit --deny warnings`)

**Result:** ❌ failing  
**Vulnerabilities found (4):**

- `RUSTSEC-2026-0007` — `bytes 1.11.0` — patched `>=1.11.1`
- `RUSTSEC-2026-0001` — `rkyv 0.7.45` — patched `>=0.7.46,<0.8.0` or `>=0.8.13`
- `RUSTSEC-2026-0009` — `time 0.3.44` — patched `>=0.3.47` (DoS via stack exhaustion in RFC2822 parse)
- `RUSTSEC-2025-0055` — `tracing-subscriber 0.2.25` present in lockfile (old dependency chain via ark crates)

**Denied warnings (24):**
- `unmaintained`: 20 (GTK3 binding ecosystem + other crates)
- `unsound`: 3 (includes `glib`, `keccak`, `lru`)
- `yanked`: 1 (`keccak 0.1.5`)

#### npm audit (`pnpm audit --prod --audit-level high`)

**Result:** ❌ failing  
**Prod vulnerabilities:** 11 total (8 high, 1 moderate, 2 low)

The **high** issues are primarily:
- `tar` (multiple path traversal / overwrite / race issues; patched at `>=7.5.10`)
- `minimatch` (ReDoS issues; patched around `>=3.1.4`)

### 4.5 `cargo-deny` config not loadable

`cargo deny check ...` fails because `deny.toml` uses keys/values incompatible with the current cargo-deny schema (CI installs latest with `cargo install cargo-deny --locked`).

This means the intended “Operation Legal Shield” compliance job is not currently functional as written.

---

## 5) Architecture & Operational Readiness

### Desktop runtime orchestration (Local Control Plane)

Strengths:
- Manifest-driven startup with dependency ordering and health probes:
  - `config/local-control-plane.toml`
  - `packages/dashboard/src-tauri/src/local_control_plane.rs`
- Commander Edition bootstrap starts required services when not healthy, with remediation hints.

Gaps / risks:
- Local stack currently orchestrates **gateway + collaboration** only; other services appear not integrated into the Commander bootstrap (may be intentional).
- Build-time bundling and runtime component verification are present but currently emit warnings in dev builds (runtime asset expectations differ between debug/release).

### Provisioning (USB + Network)

Current implementation supports an operator-friendly path, but security posture needs tightening:

- SSH provisioning uses **password auth** and does **not** verify SSH host keys (`packages/dashboard/src-tauri/src/provisioning/injector.rs`).
- UI defaults to `raspberry` password for Pi (`packages/dashboard/src/components/onboarding/ActivationTerminal.tsx`).

Recommendation: treat password-based provisioning as **dev/test-only** and implement:
- host key pinning / known_hosts verification
- SSH key-based auth
- explicit risk banner + mandatory password change workflow

### Rust workspace integrity

Key structural issues:

- `crates/tak-bridge` exists but is **not** in `[workspace].members` and examples reference it indirectly, breaking builds.
- Some tests appear stale vs code (identity android integration test; config tests expecting old ports).

---

## 6) Infrastructure / CI/CD

### GitHub Actions

- CI triggers on: `main`, `develop`, `internal` (not `dev`).  
  **Risk:** `dev` can drift into a broken state without automatic gates.

- Docker smoke builds include `services/h2-ingest/Dockerfile` → currently blocked by Rust compile errors.

### Docker / Compose

There are **two parallel Dockerfile sets**:

- `infra/docker/Dockerfile.*` (currently Node **18**)
- `services/*/Dockerfile` (Node **22**, aligns with repo toolchain)

`infra/docker/docker-compose.yml` and CI currently use the **infra/** Dockerfiles, creating a toolchain divergence from local dev + repo policy.

### Kubernetes (Bunker overlay)

Strengths:
- TLS ingress for Tactical Glass host (`tactical-glass.local`) via Traefik + secret.
- Strong “placeholder secrets” validation script.
- TPM device mount in gateway deployment for hardware trust path.

Gaps:
- Grafana and MinIO ingresses are HTTP (no TLS) by default.
- Service-to-service traffic remains HTTP; no mTLS/service mesh enforcement is visible in manifests.

### AWS Terraform

- ALB redirects HTTP→HTTPS and uses TLS policy allowing TLS 1.2 + 1.3 (`ELBSecurityPolicy-TLS13-1-2-2021-06`).
- If TLS 1.3 only is a strict requirement, infrastructure must be tightened (and clients verified).

---

## 7) Risk Register (Top Items)

| Priority | Risk | Impact | Likelihood | Evidence | Recommendation |
|---|---|---:|---:|---|---|
| P0 | Rust workspace fails to compile | Blocks releases/CI; prevents reliable dev | High | `cargo check --workspace` fails in `services/h2-ingest` | Fix compile errors; add CI gate on target branches used for dev |
| P0 | Test suite cannot build/run | No regression confidence | High | `cargo test --workspace` fails; `pnpm run test` fails | Fix stale tests/examples; make “no tests” packages not fail CI |
| P0 | Supply chain audits failing (Rust + Node) | Known vulns; violates doctrine | High | `cargo audit --deny warnings`; `pnpm audit --prod` | Update dependencies, pin patched versions; enforce in CI |
| P0 | `deny.toml` incompatible with cargo-deny | License/advisory gates non-functional | High | `cargo deny check licenses` fails to load config | Update config schema or pin cargo-deny version in CI |
| P0 | `Math.random()` fallback for nonce/UUID | Breaks cryptographic replay defenses | Medium | `packages/shared/src/c2-message-schema.ts` | Remove insecure fallback; fail closed or use Node crypto |
| P1 | Infra Dockerfiles use Node 18 | Runtime mismatch, hidden bugs/vulns | Medium | `infra/docker/Dockerfile.gateway` etc | Standardize on Node 22; remove/merge duplicate Dockerfiles |
| P1 | SSH provisioning without host key verification | MITM risk during enrollment | Medium | `inject_pi` uses ssh2 without host key check | Add host key pinning + key-based auth; tighten UX warnings |

---

## 8) Recommended Remediation Plan (Pragmatic)

### Phase 0 — Make the repo “green” (P0: 1–2 days)

1. Fix `services/h2-ingest` compilation errors; add a minimal unit test to lock behavior.
2. Fix Rust workspace test build:
   - Update/remove stale `crates/identity/tests/android_se_integration.rs` or gate behind feature.
   - Fix `crates/c2-router/examples/tak_bridge_publish.rs`:
     - Add `crates/tak-bridge` to workspace members, and/or
     - Add dev-dependencies to c2-router for the example, and/or
     - Mark example as optional behind a feature.
3. Fix monorepo test gate:
   - Change `packages/tablet-app` test script to not fail without tests.
4. Run and enforce formatting:
   - `cargo fmt --all`
5. Make clippy gate pass (at least the current top errors), then iterate.

### Phase 1 — Re-align supply chain doctrine (P0/P1: 1–2 days)

1. Update Rust dependencies to resolve RustSec findings; re-run `cargo audit --deny warnings`.
2. Update npm dependency chains to address `tar` and `minimatch` advisories (may require bumping `expo` / related).
3. Fix `deny.toml` schema or pin `cargo-deny` version in CI (prefer fixing schema).

### Phase 2 — Harden crypto invariants (P1: 1–3 days)

1. Remove `Math.random()` fallback for security-critical identifiers; fail closed.
2. Decide and document KDF policy (SHA-256 vs HKDF vs BLAKE3‑based KDF), then enforce via code + tests.

### Phase 3 — Infra convergence (P1: 1–2 days)

1. Decide a single source of truth for Dockerfiles (prefer `services/*/Dockerfile`) and update:
   - `infra/docker/docker-compose.yml`
   - `.github/workflows/ci.yml` docker smoke job
2. Align Node version across all build and runtime images (Node 22.x).

---

## Appendix A — Commands executed (high signal)

```powershell
pnpm install --frozen-lockfile
pnpm doctor
pnpm run build
pnpm run test
pnpm --dir packages/dashboard test
pnpm --dir packages/tablet-app test
pnpm --dir services/gateway run test:integration

cargo check --workspace
cargo check --workspace --exclude h2-ingest
cargo test --workspace --exclude h2-ingest
cargo test -p aethercore-c2-router signature_verification --tests
cargo fmt --all -- --check
cargo clippy --workspace --exclude h2-ingest -- -D warnings

cargo audit --deny warnings
pnpm audit --prod --audit-level high
```

## Appendix B — Audit artifacts captured locally

- `tmp/pnpm-audit-prod.json` (generated by `pnpm audit --prod --json`)

---

## Appendix C — Verification Re-run (2026-03-06)

### Environment

- Node.js: `v22.22.1`
- pnpm: `9.15.0`
- rustc: `1.93.0` (2026-01-19)
- cargo-deny: `0.19.0`
- cargo-audit: `0.22.1`

### High-signal results (confirmed on this workstation)

- **Builds**
  - `pnpm run build` ✅ (monorepo build succeeds)
  - `cargo check --workspace` ❌ (fails in `services/h2-ingest`)
  - `cargo check --workspace --exclude h2-ingest` ✅
  - `cargo build -p aethercore-node --target x86_64-pc-windows-msvc` ✅

- **Tests**
  - `pnpm run test` ❌ (fails early because `packages/tablet-app` has no tests; Jest exits 1)
  - `pnpm --dir packages/dashboard test` ✅ (Vitest passes)
  - `pnpm --dir services/gateway run test:integration` ✅ (Node `--test` integration suite passes)
  - `cargo test --workspace --exclude h2-ingest` ❌ fails due to:
    - `crates/c2-router/examples/tak_bridge_publish.rs` referencing non-workspace crates (`aethercore_tak_bridge`, `aethercore_unit_status`)
    - `crates/identity/tests/android_se_integration.rs` stale vs current identity API

- **Quality gates**
  - `pnpm run lint` ✅ (warnings only)
  - `cargo fmt --all -- --check` ❌ (format drift across multiple crates/services)
  - `cargo clippy --workspace --exclude h2-ingest -- -D warnings` ❌ (Clippy violations include `clippy::useless_format` in `packages/dashboard/src-tauri/build.rs` and `clippy::unwrap_or_default` in `crates/core/src/slashing.rs`)

- **Supply chain**
  - `cargo deny check licenses` ❌ (config schema mismatch with cargo-deny 0.19.0; `deny.toml` includes invalid `advisories.unmaintained` + unexpected `bans.allow-git`)
  - `cargo audit --deny warnings` ❌ (4 vulnerabilities + 24 denied warnings; examples: `bytes 1.11.0` RUSTSEC-2026-0007; `keccak 0.1.5` unsound/yanked; `lru 0.12.5` unsound)
  - `pnpm audit --prod --audit-level high` ❌ (11 vulnerabilities; high severity includes `tar` + `minimatch` via Expo toolchain dependencies pulled by Dashboard)

### Additional findings (not captured in the original FTDD body)

- **Fail-visible gap in identity attestation signing**
  - `crates/identity/src/attestation.rs` uses `PlatformIdentity.metadata["private_key_hex"]` for software signing and returns an empty signature on parse/validation failure; this should be `Result<Signature, Error>` with explicit propagation.
  - If `private_key_hex` is ever persisted outside tests/dev, it violates the “no plaintext private keys” rule; gate behind dev-only features and keep test keys in dedicated fixtures.

- **Default credentials in FLIR ingest**
  - `services/h2-ingest/src/flir/mod.rs` falls back to `admin` / `password` for `FLIR_USERNAME` / `FLIR_PASSWORD`; should fail-closed.

- **Observability configuration drift**
  - `infra/observability/prometheus.yml` scrapes `/metrics` from gateway/auth/h2-ingest/redis, but current Node services do not expose `/metrics` (no `prom-client` or equivalent), and Redis requires an exporter for Prometheus.
