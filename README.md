# AetherCore MonoRepo

The AetherCore system integrating H2OS/4MIK - A comprehensive platform for distributed computing, mesh networking, and ISR capabilities.

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


## License

MIT OR Apache-2.0

## Security & Supply Chain

AetherCore implements comprehensive supply chain security measures for all releases:

- **Software Bill of Materials (SBOM)**: CycloneDX-compliant SBOMs for all dependencies
- **Vulnerability Scanning**: Automated audits against RUSTSEC and npm advisory databases
- **Dependency Pinning**: All dependencies locked via `Cargo.lock` and `package-lock.json`
- **License Integrity**: BLAKE3 cryptographic hashing of all dependency licenses

### Generate SBOM Locally

```bash
./scripts/generate-sbom.sh
```

Output artifacts are generated in `sbom-artifacts/`:
- `tauri-sbom.json` - Rust/Tauri dependencies
- `frontend-sbom.json` - Frontend dependencies
- `LICENSE_MANIFEST.txt` - License integrity hashes
- `SUPPLY_CHAIN_MANIFEST.md` - Human-readable summary

For detailed information, see [Supply Chain Security Documentation](docs/SUPPLY_CHAIN_SECURITY.md).

## Contributing

This is a monorepo project. Please ensure:

- All Rust code passes `cargo clippy` and `cargo test`
- All TypeScript code builds with `tsc`
- Follow the dependency rules (especially regarding `/legacy`)
- Update this README if adding new crates or packages
