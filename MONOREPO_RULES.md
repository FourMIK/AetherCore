# AetherCore MonoRepo Rules

This document defines the strict rules and conventions for the AetherCore monorepo structure.

## Directory Structure

The repository is organized as follows:

```
/
├── crates/          # Rust workspace
├── services/        # Node.js/TypeScript services
├── packages/        # TypeScript packages
├── legacy/          # Read-only H2OS snapshot
├── Cargo.toml       # Rust workspace configuration
└── package.json     # npm workspace configuration
```

## Workspace Rules

### 1. Rust Workspace (`/crates`)

**Configuration**: `Cargo.toml` at repository root

**Members**:
- `crates/core`
- `crates/crypto`
- `crates/identity`
- `crates/domain`
- `crates/mesh`
- `crates/stream`
- `crates/edge`
- `crates/isr`
- `crates/rf`
- `crates/radio`
- `crates/trust_mesh`
- `crates/h2-domain`

**Enforcement**:
- All Rust crates MUST be defined in workspace members
- Workspace-level dependencies SHOULD be used for common crates
- Cross-crate dependencies are allowed within the workspace

### 2. Node.js/TypeScript Workspace (`/services` and `/packages`)

**Configuration**: `package.json` at repository root

**Services** (`/services`):
- `services/gateway`
- `services/auth`
- `services/fleet`
- `services/h2-ingest`
- `services/operator`

**Packages** (`/packages`):
- `packages/dashboard`
- `packages/h2-glass`
- `packages/canonical-schema`
- `packages/shared`

**Enforcement**:
- All services and packages MUST be defined in npm workspaces
- Services and packages SHOULD use workspace protocol for inter-dependencies
- Consistent TypeScript configuration across all packages

### 3. Legacy Directory (`/legacy`)

**Status**: Read-only

**Purpose**: Historical H2OS snapshot for reference only

**Critical Rules**:

❌ **PROHIBITED**:
- NO runtime imports from `/legacy`
- NO modifications to `/legacy` contents
- NO build artifacts generated from `/legacy`
- NO new code added to `/legacy`

✅ **ALLOWED**:
- Documentation references
- Historical context lookup
- Migration planning

**Exceptions** (may reference `/legacy` for context):
1. `/crates/h2-domain/` — H2OS domain integration
2. `/packages/h2-glass/` — H2OS visualization

Even these exceptions MUST NOT create runtime dependencies on legacy code.

## Dependency Rules

### Rust Dependencies

1. **Workspace dependencies** defined in root `Cargo.toml` [workspace.dependencies]
2. Crates MAY depend on other workspace crates
3. External dependencies SHOULD use workspace versions when available
4. NO dependencies on `/legacy`

### TypeScript Dependencies

1. **npm workspaces** manage all packages and services
2. Internal references use workspace protocol: `"@aethercore/shared": "workspace:*"`
3. Services MAY depend on packages
4. Packages MAY depend on other packages
5. NO dependencies on `/legacy` (except h2-glass for type definitions only)

### Cross-Language Dependencies

- TypeScript code CANNOT directly import Rust code
- Integration requires proper FFI bindings or service APIs
- NO shared state between Rust and TypeScript at compile time

## Build Rules

### Rust

```bash
# Build entire workspace
cargo build --workspace

# Test entire workspace
cargo test --workspace

# Check without building
cargo check --workspace
```

### TypeScript

```bash
# Install all dependencies
npm install

# Build all packages and services
npm run build

# Test all packages and services
npm run test
```

## Adding New Components

### Adding a Rust Crate

1. Create directory: `crates/{name}/src`
2. Create `crates/{name}/Cargo.toml`:
   ```toml
   [package]
   name = "aethercore-{name}"
   version.workspace = true
   edition.workspace = true
   
   [dependencies]
   # Add dependencies here
   ```
3. Add to workspace members in root `Cargo.toml`
4. Create `crates/{name}/src/lib.rs` or `src/main.rs`

### Adding a TypeScript Service

1. Create directory: `services/{name}/src`
2. Create `services/{name}/package.json`:
   ```json
   {
     "name": "@aethercore/{name}",
     "version": "0.1.0",
     "scripts": {
       "build": "tsc",
       "clean": "rm -rf dist"
     }
   }
   ```
3. Create `services/{name}/tsconfig.json`
4. Create `services/{name}/src/index.ts`
5. Run `npm install` at root to link workspace

### Adding a TypeScript Package

Follow the same steps as adding a service, but place in `packages/` instead of `services/`.

## Enforcement Mechanisms

### Automated Checks

The following should be enforced in CI:

1. **Cargo workspace check**: `cargo check --workspace`
2. **npm workspace validation**: `npm run build --workspaces`
3. **Legacy isolation check**: Scan for imports from `/legacy` (except allowed paths)
4. **TypeScript compilation**: All packages must build without errors

### Manual Review

Code reviews MUST verify:

1. New crates/packages are added to workspace configuration
2. No runtime dependencies on `/legacy`
3. Dependencies use workspace versions
4. Cross-package references are legitimate

## Version Management

- Rust crates share workspace version: `0.1.0`
- TypeScript packages have independent versions
- Update root `Cargo.toml` to bump Rust crate versions
- Update individual `package.json` to bump TypeScript versions

## Documentation Requirements

Every crate/package MUST have:

1. README.md or module-level documentation
2. Description in Cargo.toml/package.json
3. Public API documentation
4. Examples for complex features

## Questions?

For questions about monorepo structure, consult:

1. This document (MONOREPO_RULES.md)
2. Root README.md
3. Legacy README.md (`/legacy/README.md`)
