# AI Coding Agent Guide for AetherCore

**Purpose:** Essential knowledge for AI agents working in this codebase  
**Last Updated:** 2026-02-19

---

## Project Identity

**AetherCore** is a hardware-rooted trust fabric for contested multi-domain environments. This is **not** a typical web app—every design decision stems from the **Fail-Visible doctrine**: security failures must be explicit, never hidden. If you can't cryptographically prove something, the system halts.

### Core Philosophy
- **"Trust by Policy" is replaced with Cryptographic Certainty**
- **Byzantine fault detection is mandatory**, not optional
- **Hardware-rooted identity** (TPM 2.0/Secure Enclave) in production; software simulation in dev mode
- **Merkle Vine™**: All telemetry is historically anchored—data cannot be injected retroactively

---

## Architecture Quick Reference

### Hybrid Rust + TypeScript Monorepo

```
/crates/           → Rust workspace: Core crypto, mesh, trust, streaming
/packages/         → TypeScript: Tauri desktop (Tactical Glass), shared libs  
/services/         → Node.js backend: Gateway, Auth, Fleet management
/infra/            → Docker, K8s, Terraform deployment configs
/tests/integration → Rust tests for boundary validation
```

**Key Bridge:** Tauri connects Rust backend to React frontend via IPC commands in `packages/dashboard/src-tauri/src/commands.rs`. All cross-language calls go through here.

### Data Flow Pattern

```
Edge Node → Stream (Merkle Vine) → Trust Mesh (Byzantine Detection) 
         → Services (Gateway/Auth) → Dashboard (Tactical Glass)
```

Commands flow backwards: `Dashboard → Tauri IPC → Rust Core → C2 Router → Mesh Network`

---

## Critical Conventions

### 1. Fail-Visible Error Handling

**Never silently swallow errors.** All error types implement explicit logging and structured context:

```rust
// crates/*/src/*.rs pattern
pub enum MyError {
    CryptoFailure { context: String },  // Always include diagnostic context
    InvalidSignature { node_id: String },
}
```

Search codebase for `"Fail-Visible"` to see examples in `packages/dashboard/src-tauri/src/error.rs`, `crates/core/src/slashing.rs`, `crates/crypto/src/zk/prover.rs`.

### 2. Cryptographic Standards (MANDATORY)

From `SECURITY.md`:
- ✅ **BLAKE3** for all hashing (NOT SHA-256 unless legacy compat)
- ✅ **Ed25519** for all signatures (TPM-backed in production)
- ✅ **TLS 1.3** only (TLS 1.2 prohibited)
- ❌ **NO plaintext storage** of private keys—use TPM or Secure Enclave APIs

**Enforcement:** `deny.toml` blocks copyleft licenses and enforces permissive-only deps (MIT/Apache-2.0).

### 3. Toolchain Requirements (STRICT)

From `CONTRIBUTING.md` preinstall hook:
- **Node.js 20.x** (enforced)
- **pnpm 9.15.0** (enforced via `scripts/verify-toolchain.js`)
- **Rust 1.75+** (stable, see `rust-toolchain.toml`)

**Docker builds:** Set `SKIP_TOOLCHAIN_CHECK=1` only in Dockerfile `pnpm install` steps. Never skip locally.

### 4. Workspace Dependency Management

**Rust:** All shared deps defined in root `Cargo.toml` `[workspace.dependencies]`. Crates reference via:
```toml
tokio = { workspace = true }
```

**TypeScript:** pnpm workspace. Shared types in `packages/shared/`. Use workspace protocol:
```json
"@aethercore/shared": "workspace:*"
```

---

## Essential Workflows

### Build & Run Desktop App

```powershell
# From root
pnpm install --frozen-lockfile
cd packages/dashboard
pnpm tauri dev        # Hot-reload dev mode
pnpm tauri build      # Production MSI (Windows)
```

### Run Backend Services (Docker)

```powershell
cd infra/docker
cp .env.example .env
docker compose up -d
docker compose logs -f  # Watch logs
```

Ports: C2 Router (50051), Gateway (3000), Auth (3001), Postgres (5432). See `infra/docker/README.md`.

### Testing

```powershell
# Rust: Workspace tests
cargo test --workspace

# TypeScript: Run per-package
pnpm run test

# Integration tests (Rust)
cargo test -p aethercore-integration
```

### Supply Chain Security

```powershell
# Generate SBOM + license audit
./scripts/generate-sbom.sh  # Outputs to sbom-artifacts/

# License compliance check
cargo deny check licenses
```

**Fail-Visible:** Build fails on HIGH/CRITICAL CVEs. See `docs/SUPPLY_CHAIN_SECURITY.md`.

### Environment Doctor

```powershell
pnpm run doctor  # Checks toolchain versions, ports, prerequisites
```

---

## Architecture Deep Dives

### 1. Merkle Vine Streaming (`crates/stream`)

Events form tamper-evident chain via `ancestor_hash`:
```
Event₀ → Event₁ → Event₂ (each contains BLAKE3(previous))
```

**Key Type:** `merkle_vine::VineNode` in `crates/core/src/merkle_vine.rs`  
**Usage:** All telemetry must go through `StreamIntegrityTracker` (see `packages/dashboard/src-tauri/src/commands.rs`).

### 2. Trust Mesh & Byzantine Detection (`crates/trust_mesh`)

Nodes gossip trust scores. **Aetheric Sweep** auto-quarantines Byzantine nodes.

**Slashing Events:** See `crates/core/src/slashing.rs` for `ByzantineFaultType` enum:
```rust
pub enum ByzantineFaultType {
    InvalidSignature,
    BrokenHashChain,
    DoubleVote,
}
```

**Integration:** `commands.rs` exposes `get_sentinel_trust_status()` to dashboard.

### 3. Identity Management (`crates/identity`)

**Dev Mode:** Software-simulated keys (no TPM)  
**Production:** TPM 2.0 or Secure Enclave APIs (see `SECURITY_SCOPE.md`)

**Key Location:**
- Dev: `~/.aethercore/identity/node_identity.json`
- Prod: TPM handles only, never touches disk

### 4. Tauri Command Pattern

All frontend ↔ backend calls are Tauri commands:

```rust
#[tauri::command]
pub async fn my_command(state: tauri::State<'_, MyState>) -> Result<MyResponse, String> {
    // 1. Validate input (Fail-Visible)
    // 2. Call core crate logic
    // 3. Return structured result or explicit error
}
```

**Register in:** `packages/dashboard/src-tauri/src/main.rs` via `.invoke_handler(tauri::generate_handler![my_command])`

---

## Configuration Files

| File | Purpose |
|------|---------|
| `config/production.yaml` | Production mesh config (TPM-backed) |
| `config/testing.yaml` | Dev/test config (software keys) |
| `deny.toml` | License compliance + security audit rules |
| `tauri.conf.json` | Desktop app build config (MSI, DMG) |
| `Cargo.toml` | Rust workspace deps + release profiles |
| `package.json` | Node workspace + preinstall toolchain check |

---

## Common Pitfalls

### ❌ Don't: Use SHA-256 for new code
✅ Do: Use BLAKE3 (`blake3` crate, workspace dependency)

### ❌ Don't: Store keys in files or memory
✅ Do: Use `IdentityManager` API (abstracts TPM in prod, simulates in dev)

### ❌ Don't: Gracefully degrade on crypto failure
✅ Do: Return explicit error and halt operation (Fail-Visible)

### ❌ Don't: Skip `cargo deny check` before release
✅ Do: Run license audit + SBOM generation via `scripts/generate-sbom.sh`

### ❌ Don't: Mix pnpm versions
✅ Do: Use exactly pnpm 9.15.0 (enforced by preinstall hook)

---

## Key Documentation

| Doc | When to Read |
|-----|--------------|
| `ARCHITECTURE.md` | Understanding system boundaries |
| `PROTOCOL_OVERVIEW.md` | Merkle Vine, Trust Mesh concepts |
| `SECURITY.md` | Crypto standards, Zero-Trust model |
| `CONTRIBUTING.md` | Toolchain setup, branch strategy |
| `docs/SUPPLY_CHAIN_SECURITY.md` | SBOM generation, license compliance |
| `docs/DOCKER_COMPOSE_GUIDE.md` | Local service stack troubleshooting |
| `SECURITY_SCOPE.md` | Dev vs Production security boundaries |

---

## Product Context

**Current Release:** v0.2.0 (Alpha)  
**Default Profile:** AetherCore Commander Edition (guided bootstrap, no CLI required)  
**Platform Support:** Windows MSI, macOS DMG (manifest-backed releases only)

**Field Deployment:** See `docs/FIELD_TEST_OPERATOR_MANUAL.md` for operator workflows.

---

## When Adding New Code

1. **Choose the right layer:**
   - Crypto primitives → `crates/crypto`
   - Mesh protocol → `crates/mesh` or `crates/trust_mesh`
   - Streaming → `crates/stream`
   - UI/Frontend → `packages/dashboard/src/`
   - Tauri commands → `packages/dashboard/src-tauri/src/commands.rs`

2. **Follow Fail-Visible pattern:**
   - Define explicit error types (no generic `anyhow` at boundaries)
   - Log all errors with tracing macros
   - Return structured results, never `unwrap()` in production paths

3. **Add tests:**
   - Rust: Unit tests in same file as `#[cfg(test)] mod tests`
   - Integration: `tests/integration/src/`
   - TypeScript: `*.test.ts` co-located with source

4. **Update CHANGELOG.md** if user-facing

5. **Run full suite before PR:**
   ```powershell
   cargo test --workspace
   cargo deny check
   pnpm run lint
   pnpm run build
   ```

---

## Questions to Ask Yourself

Before writing code, ask:
1. **Can this fail cryptographically?** → Make it Fail-Visible
2. **Does this cross Rust ↔ TS boundary?** → Go through Tauri commands
3. **Is this a new dependency?** → Check `deny.toml` license whitelist
4. **Does this touch identity/keys?** → Use `IdentityManager`, never raw file I/O
5. **Is this telemetry data?** → Must go through Merkle Vine (`StreamIntegrityTracker`)

---

## Quick Commands Cheat Sheet

```powershell
# Setup
pnpm install --frozen-lockfile; pnpm run doctor

# Dev
cd packages/dashboard; pnpm tauri dev

# Test
cargo test --workspace; pnpm run test

# Build
pnpm tauri build  # From packages/dashboard

# Docker stack
cd infra/docker; docker compose up -d; docker compose logs -f

# Security audit
cargo deny check; ./scripts/generate-sbom.sh

# Clean
pnpm run clean; cargo clean
```

---

**Remember:** This is not a web app. Every line of code must uphold cryptographic certainty and the Fail-Visible philosophy. When in doubt, halt the operation rather than compromise integrity.

