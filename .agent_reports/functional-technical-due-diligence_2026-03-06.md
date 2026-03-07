# AetherCore — Functional Technical Due Diligence (FTDD)

**Date:** 2026-03-06 (America/New_York)  
**Repo:** `C:\Users\Owner\StudioProjects\AetherCore`  
**Branch / Commit:** `dev` @ `d1ef870` (**working tree modified during FTDD**)  
**Assessed on:** Windows (PowerShell)

> Note: This report supersedes the initial draft saved as  
> `.agent_reports/functional-technical-due-diligence_2026-03-06.initial.md`.

## 0) Executive Summary

### Go / No‑Go

- **GO (Engineering / CI baseline):** The monorepo builds, tests, and supply‑chain gates reproduce **green** on this workstation.
- **CONDITIONAL NO‑GO (Field / production):** This pass did **not** validate real contested-network behavior, TPM/Secure Enclave attestation on target hardware, or field operator workflows end‑to‑end. Those require dedicated hardware + environment validation.

### High-signal outcomes

- **Rust workspace**
  - `cargo test --workspace` ✅
  - `cargo clippy --workspace -- -D warnings` ✅
  - `cargo deny check` ✅ (warnings only; details below)
- **TypeScript / Node workspace**
  - `pnpm run doctor` ✅
  - `pnpm run build` ✅
  - `pnpm run test` ✅
  - `pnpm audit --prod --audit-level high` ✅
  - `pnpm --filter @aethercore/tablet-app run type-check` ✅
- **Local stack (Docker Compose)**
  - `docker compose build` ✅ (for `infra/docker/docker-compose.yml`)
  - `docker compose up -d` ✅ and `/health` endpoints return `200` (gateway/auth/collaboration)

### Remediations applied to uphold Fail‑Visible doctrine

- **Security-critical RNG now fails closed**
  - Removed `Math.random()` fallback for message identifiers / replay-defense nonces in shared C2 envelope logic.
- **Removed insecure FLIR credential defaults**
  - `FLIR_USERNAME` / `FLIR_PASSWORD` are now required; missing values produce a Fail‑Visible error.
- **Attestation signing made Fail‑Visible**
  - Attestation signing now returns `Result` and halts handshake on signing failure (no empty signatures).
- **Dashboard stream + P2P event IDs hardened**
  - Replaced `Math.random()` UUID generation with `crypto.randomUUID()` and fail‑closed behavior.
- **Node supply-chain high vulnerabilities eliminated**
  - Added targeted `pnpm.overrides` to force patched transitive versions; lockfile updated.
- **Docker Compose build/runtime corrected**
  - Updated `infra/docker/Dockerfile.{gateway,auth,collaboration}` to Node 22 + `pnpm deploy --prod` so runtime images include required dependencies and services stay up.

## 1) Validation Matrix (Reproduced Locally)

### Toolchain

- Node.js: `v22.22.1`
- pnpm: `9.15.0`
- rustc: `1.93.0 (2026-01-19)`
- cargo: `1.93.0`
- Docker: `29.2.1` / Compose `v5.0.2`

### Commands and results

| Area | Command | Result |
|---|---|---|
| Rust | `cargo test --workspace` | ✅ |
| Rust | `cargo clippy --workspace -- -D warnings` | ✅ |
| Rust supply chain | `cargo deny check` | ✅ (warnings) |
| Node | `pnpm run doctor` | ✅ |
| Node | `pnpm run build` | ✅ |
| Node | `pnpm run test` | ✅ |
| Node supply chain | `pnpm audit --prod --audit-level high` | ✅ |
| Tablet app | `pnpm --filter @aethercore/tablet-app run type-check` | ✅ |
| Docker | `docker compose build` (infra/docker) | ✅ |
| Docker | `docker compose up -d` + `/health` checks | ✅ |

## 2) Key System Checks vs. Design Doctrine

### Fail‑Visible behavior (validated/strengthened)

- **No silent crypto degradation for envelope nonce/id generation**:
  - `packages/shared/src/c2-message-schema.ts` now throws explicit errors if secure RNG is unavailable.
- **No silent “empty signature” outputs**:
  - `crates/identity/src/attestation.rs` signing now propagates explicit errors and fails the handshake state.
- **No default credentials for ingest bridges**:
  - `services/h2-ingest/src/flir/mod.rs` requires explicit credentials.

### Cross-layer correctness anchors (covered by existing tests)

- Gateway integration tests continue to enforce:
  - signature verification, replay defenses, ordering, revocation behavior, and Merkle‑Vine anchoring invariants (via `services/gateway` integration suite).

## 3) Supply Chain & Dependency Security

### Rust (`cargo-deny`)

- `cargo deny check` is ✅ on this machine.
- Remaining **warnings** (non-blocking) include:
  - SPDX parse warning from `unescaper` (`GPL-3.0/MIT` deprecated identifier)
  - Unmatched allowlist entry (`Unicode-DFS-2016`) in `deny.toml`
  - Wildcard path-dependency warnings for internal crates (expected in monorepo; still worth tracking)
  - Duplicate lock entries for `winreg` (two versions in `Cargo.lock`)

### Node (`pnpm audit`)

- `pnpm audit --prod --audit-level high` is ✅ after adding `pnpm.overrides` in root `package.json`.
- Override intent:
  - Force patched versions for high-severity advisories (notably `tar` and `minimatch`) pulled transitively via Expo/CLI chains.

## 4) Docker Compose (Local Stack) Validation

### What was validated

- `infra/docker/docker-compose.yml` builds and runs:
  - `c2-router` mock, `postgres`, `redis`, `gateway`, `auth`, `collaboration`.
- Health endpoints verified locally:
  - `GET http://127.0.0.1:3000/health` → `{"status":"ok"}`
  - `GET http://127.0.0.1:3001/health` → `{"status":"ok","service":"auth"}`
  - `GET http://127.0.0.1:8080/health` → `{"status":"ok"}`

### What changed to make it work

- `infra/docker/Dockerfile.{gateway,auth,collaboration}` now:
  - Use **Node 22** images
  - Use `corepack prepare pnpm@9.15.0 --activate`
  - Use `pnpm ... deploy --prod /app` so runtime has correct `node_modules`
  - Run the correct long-lived entrypoints (auth uses `dist/server.js`)

## 5) Residual Warnings / Technical Debt (Non-blocking)

- **Rust `cargo test` warnings**
  - `unexpected_cfgs` for feature `android-keystore` in `crates/identity/tests/android_se_integration.rs` (feature not declared)
  - Integration test hygiene: unused imports, deprecated `base64::encode`, unused constants/fields
  - Rust future-incompat warning for `redis v0.24.0`
- **pnpm peer dependency warnings**
  - `react-native` peer expects React 18.2.0 while dashboard uses React 18.3.1
  - `vite-plugin-cesium` peer on Rollup (plugin expects Rollup v2; Vite uses Rollup v4)

## 6) Out-of-Scope for this Pass (Explicit)

- Hardware-rooted identity validation on real TPM 2.0 / Secure Enclave
- Contested-network behavior and Byzantine fault quarantine under real packet loss/jamming
- Full operator workflow validation (field manuals, provisioning, radio integration)

## Appendix A — Commands executed (high signal)

```powershell
# Toolchain sanity
pnpm run doctor

# Node build/test/supply-chain
pnpm run build
pnpm run test
pnpm audit --prod --audit-level high
pnpm --filter @aethercore/tablet-app run type-check

# Rust build/test/supply-chain
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo deny check

# Docker Compose local stack
cd infra/docker
docker compose build
docker compose up -d
```

