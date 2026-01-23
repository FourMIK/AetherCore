# AetherCore

**Tamper-evident data streaming and trust mesh coordination for distributed systems**

---

## Overview

AetherCore is a distributed system implementing:
- **Merkle Vine streaming protocol** for tamper-evident data integrity
- **Trust mesh coordination** with Byzantine fault detection
- **Mesh networking** with gossip-based dissemination
- **Tactical Glass** operator interface for real-time monitoring

**Current Deployment:** Windows Desktop Application (Dev Mode)

This repository provides a development and demonstration environment. For production deployment requirements, see [docs/production-deployment-playbook.md](docs/production-deployment-playbook.md).

---

## Quick Start for Windows

### Install from Release

1. **Download** the latest MSI installer from [Releases](https://github.com/your-org/AetherCore/releases)
   - File size: ~200-250 MB (includes all dependencies and WebView2 runtime)
2. **Run installer** as Administrator
   - No internet connection required - all dependencies bundled
3. **Launch** from Start Menu: "AetherCore Tactical Glass (Dev Mode)"

### Build from Source

```powershell
# Prerequisites: Rust 1.70+, Node.js 18+, Visual Studio Build Tools

# Clone repository
git clone https://github.com/your-org/AetherCore.git
cd AetherCore

# Install dependencies
npm install

# Build Rust workspace
cargo build --workspace --release

# Build Windows desktop application
cd packages\dashboard
npm run tauri:build
```

**Output:** MSI installer in `packages/dashboard/src-tauri/target/release/bundle/msi/`

See **[RUNNING_ON_WINDOWS.md](RUNNING_ON_WINDOWS.md)** for detailed instructions, troubleshooting, and configuration.

---

## What is Dev Mode?

**Dev Mode** is a configuration for development, testing, and controlled demonstrations:

✅ **Provides:**
- Merkle Vine integrity verification
- Trust mesh with Byzantine detection
- Operator interface (Tactical Glass)
- Local mesh simulation

❌ **Does NOT provide:**
- TPM/Secure Enclave integration
- Hardware-backed identity
- Remote attestation
- Production security hardening

**Dev Mode is NOT suitable for:**
- Operational deployment
- Processing sensitive data
- Mission-critical applications

See **[DEV_MODE.md](DEV_MODE.md)** for complete capabilities and limitations.

## Repository Structure

This is a monorepo containing Rust and TypeScript/Node.js workspaces:

### `/crates` — Rust Workspace

Core system components written in Rust:

- **core** — Core functionality and types
- **crypto** — Cryptographic primitives
- **identity** — Identity management
- **domain** — Domain model and logic
- **mesh** — Mesh networking
- **stream** — Data streaming
- **edge** — Edge computing
- **isr** — Intelligence, Surveillance, Reconnaissance
- **rf** — Radio frequency functionality
- **radio** — Radio communication
- **trust_mesh** — Trust and security mesh
- **h2-domain** — H2OS domain integration _(may reference `/legacy`)_

### `/services` — Node.js/TypeScript Services

Backend services:

- **gateway** — API Gateway service
- **auth** — Authentication service
- **fleet** — Fleet management service
- **operator** — Operator service

### `/packages` — TypeScript Packages

Shared TypeScript packages:

- **dashboard** — Dashboard application
- **canonical-schema** — Canonical data schemas
- **shared** — Shared utilities

## Getting Started

### Prerequisites

- **Rust** 1.70+ with `cargo`
- **Node.js** 18+ with `npm` 9+

### Building

#### Rust Workspace

```bash
# Build all Rust crates
cargo build --workspace

# Build in release mode
cargo build --workspace --release

# Run tests
cargo test --workspace
```

#### Node.js/TypeScript Workspace

```bash
# Install dependencies
npm install

# Build all packages and services
npm run build

# Run tests
npm run test

# Lint
npm run lint
```

## Workspace Enforcement

### Rust (`Cargo.toml`)

The root `Cargo.toml` defines the Rust workspace with all crates. Dependencies are managed at the workspace level for consistency.

### Node.js (`package.json`)

The root `package.json` defines npm workspaces for all services and packages. This ensures:

- Shared dependency management
- Consistent versioning
- Cross-package references

## Development Guidelines

### Dependency Rules

1. **No runtime imports from `/legacy`** except:
   - `/crates/h2-domain/`
   - `/packages/h2-glass/`

2. **Use workspace dependencies** defined in root configurations

3. **Cross-workspace references** are allowed (e.g., services can use packages)

### Adding New Crates/Packages

#### New Rust Crate

1. Create directory: `mkdir -p crates/my-crate/src`
2. Add `Cargo.toml` referencing workspace config
3. Add to workspace members in root `Cargo.toml`
4. Create `src/lib.rs`

#### New TypeScript Package/Service

1. Create directory: `mkdir -p packages/my-package/src` or `services/my-service/src`
2. Add `package.json` with workspace reference
3. Add `tsconfig.json`
4. Create `src/index.ts`


---

## Documentation

### Core Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and component overview
- **[DEV_MODE.md](DEV_MODE.md)** - Dev Mode capabilities and limitations
- **[PROTOCOL_OVERVIEW.md](PROTOCOL_OVERVIEW.md)** - Protocol concepts and design
- **[SECURITY_SCOPE.md](SECURITY_SCOPE.md)** - Security boundaries and threat model
- **[RUNNING_ON_WINDOWS.md](RUNNING_ON_WINDOWS.md)** - Windows build and operations guide

### Additional Documentation

- **[INSTALLATION.md](INSTALLATION.md)** - Installation guide for all platforms
- **[SECURITY.md](SECURITY.md)** - Security guidelines and best practices
- **[PROVENANCE.md](PROVENANCE.md)** - Software provenance and supply chain security
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md)** - License compliance information

### Technical Documentation

- **[docs/SUPPLY_CHAIN_SECURITY.md](docs/SUPPLY_CHAIN_SECURITY.md)** - Supply chain procedures
- **[docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md)** - Release process and checklist
- **[docs/PERFORMANCE_BENCHMARKS.md](docs/PERFORMANCE_BENCHMARKS.md)** - Performance analysis
- **[docs/trust-mesh-design.md](docs/trust-mesh-design.md)** - Trust mesh detailed design
- **[docs/production-deployment-playbook.md](docs/production-deployment-playbook.md)** - Production deployment guide

---

## Development

### Hot Reload Development

For rapid iteration during development:

```powershell
cd packages\dashboard
npm run tauri:dev
```

This enables:
- Frontend hot reload on TypeScript/React changes
- Rust recompilation on code changes
- Browser dev tools (F12) for debugging

### Testing

```bash
# Rust tests
cargo test --workspace

# TypeScript tests
cd packages/dashboard
npm run test

# End-to-end tests
npm run test:e2e
```

### Code Quality

```bash
# Rust linting
cargo clippy --workspace

# TypeScript type checking
npm run test:types
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for detailed development guidelines.

---

## Security and Supply Chain

### Security Scope

AetherCore Dev Mode provides:
- ✅ **Tamper-evident** data integrity via BLAKE3 hashing
- ✅ **Verifiable** signatures via Ed25519 cryptography
- ✅ **Byzantine detection** via trust mesh consensus

AetherCore Dev Mode does NOT provide:
- ❌ Hardware-backed identity (no TPM integration)
- ❌ Remote attestation
- ❌ Production security hardening

See **[SECURITY_SCOPE.md](SECURITY_SCOPE.md)** for complete security boundaries and threat model.

### Supply Chain Security

AetherCore implements supply chain security measures:
- **Software Bill of Materials (SBOM):** CycloneDX-compliant SBOMs for all dependencies
- **Vulnerability Scanning:** Automated audits against RUSTSEC and npm advisory databases
- **Dependency Pinning:** All dependencies locked via `Cargo.lock` and `package-lock.json`
- **License Integrity:** BLAKE3 cryptographic hashing of all dependency licenses

**Generate SBOM locally:**
```bash
./scripts/generate-sbom.sh
```

Output in `sbom-artifacts/`:
- `tauri-sbom.json` - Rust/Tauri dependencies
- `frontend-sbom.json` - Frontend dependencies
- `LICENSE_MANIFEST.txt` - License integrity hashes
- `SUPPLY_CHAIN_MANIFEST.md` - Human-readable summary

See **[docs/SUPPLY_CHAIN_SECURITY.md](docs/SUPPLY_CHAIN_SECURITY.md)** for detailed procedures.

---

## Releasing

### Desktop Application Release

Before creating a release tag, run the comprehensive release checklist:

```bash
./scripts/release-checklist.sh
```

This validates:
- ✅ Documentation completeness
- ✅ Test suite execution
- ✅ SBOM generation and supply chain security
- ✅ Version consistency
- ✅ Lock file integrity

The release workflow is automatically triggered when you push a version tag:

```bash
# Update version in package.json, Cargo.toml, and tauri.conf.json
# Commit changes
git commit -m "chore: bump version to v0.2.0"

# Create and push tag
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin main
git push origin v0.2.0
```

See **[docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md)** for detailed procedures.

---

## Contributing

Contributions are welcome! Please ensure:

- All Rust code passes `cargo clippy` and `cargo test`
- All TypeScript code builds with `tsc` and passes tests
- Follow the dependency rules (see [CONTRIBUTING.md](CONTRIBUTING.md))
- Update documentation for significant changes

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for complete guidelines.

---

## License

MIT OR Apache-2.0

See [LICENSE](LICENSE) and [LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md) for details.

---

## Disclaimer

**AetherCore Dev Mode is explicitly NOT authorized for:**
- Production deployment
- Processing classified information
- Mission-critical operations
- Compliance-requiring environments

**Dev Mode makes NO claims regarding:**
- DoD certification or authorization
- FIPS 140-3 compliance
- Common Criteria evaluation
- Production security posture

All demonstrations and tests conducted in Dev Mode must be clearly labeled as **non-operational** and **for development purposes only**.

See **[DEV_MODE.md](DEV_MODE.md)** and **[SECURITY_SCOPE.md](SECURITY_SCOPE.md)** for complete limitations.
