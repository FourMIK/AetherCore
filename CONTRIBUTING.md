# Contributing to AetherCore

Thank you for your interest in contributing to AetherCore! This document provides guidelines for contributing to this monorepo.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [MonoRepo Structure](#monorepo-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

Be respectful, collaborative, and professional in all interactions.

## Getting Started

### Prerequisites

- **Rust** 1.70 or higher
- **Node.js** 20 or higher
- **pnpm** 9.15.0
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Install Node.js dependencies
pnpm install --frozen-lockfile

# Build Rust workspace
cargo build --workspace

# Build TypeScript workspace
pnpm run build
```

## MonoRepo Structure

Please read [MONOREPO_RULES.md](./MONOREPO_RULES.md) for detailed information about the repository structure and rules.

Key points:
- `/crates` - Rust workspace
- `/services` - Node.js/TypeScript services
- `/packages` - TypeScript packages
- `/legacy` - **Read-only** H2OS snapshot (no runtime imports)

## Development Workflow

## Toolchain Enforcement Policy

AetherCore enforces a strict JavaScript toolchain for local development and CI installs:

- Node.js **20.x**
- pnpm **9.15.0**

This is verified by the root `preinstall` hook (`scripts/verify-toolchain.js`).

### Docker builds

The preinstall hook is resilient to missing files during Docker layer caching. The hook checks three conditions in order:

1. **SKIP_TOOLCHAIN_CHECK=1**: If set, skips verification immediately (explicit bypass)
2. **scripts/ missing**: If `scripts/verify-toolchain.js` doesn't exist, skips gracefully (Docker layer caching)
3. **scripts/ present**: If the script exists, runs full toolchain verification

**Note**: The preinstall hook uses an inline JavaScript snippet rather than a separate wrapper script to avoid a chicken-and-egg problem where the wrapper itself would need to be present before package.json can be processed. While this makes the script less readable, it ensures maximum compatibility with Docker layer caching strategies.

For explicit control in Dockerfiles, you may set `SKIP_TOOLCHAIN_CHECK=1` to clearly document intent, though the hook will now gracefully handle missing scripts automatically.

- **Local development:** do **not** set `SKIP_TOOLCHAIN_CHECK`
- **TypeScript CI job (`pnpm install --frozen-lockfile`)**: does **not** set `SKIP_TOOLCHAIN_CHECK`
- **Dockerfiles:** may set `SKIP_TOOLCHAIN_CHECK=1` only on `pnpm install --frozen-lockfile` build steps (optional but recommended for clarity)



### Creating a New Branch

```bash
git checkout -b feature/your-feature-name
```

### Making Changes

1. Make your changes in the appropriate workspace
2. Run verification: `./verify-monorepo.sh`
3. Test your changes
4. Commit with a descriptive message

### Rust Development

```bash
# Add new crate
mkdir -p crates/my-crate/src
# Create Cargo.toml and add to workspace

# Build
cargo build --workspace

# Test
cargo test --workspace

# Lint
cargo clippy --workspace -- -D warnings

# Format
cargo fmt --all
```

### TypeScript Development

```bash
# Add new service or package
mkdir -p services/my-service/src
# or
mkdir -p packages/my-package/src

# Create package.json and tsconfig.json

# Install dependencies
pnpm install --frozen-lockfile

# Build
pnpm run build

# Test
pnpm run test
```

## Coding Standards

### Rust

- Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- Use `cargo fmt` for formatting
- Run `cargo clippy` and address all warnings
- Add documentation for public APIs
- Use workspace dependencies when available

Example Cargo.toml:
```toml
[package]
name = "aethercore-my-crate"
version.workspace = true
edition.workspace = true

[dependencies]
aethercore-core = { path = "../core" }
serde = { workspace = true }
```

### TypeScript

- Use TypeScript strict mode
- Follow existing code style
- Add JSDoc comments for public APIs
- Use ES2022 features
- Prefer `const` over `let`

Example package.json:
```json
{
  "name": "@aethercore/my-package",
  "version": "0.1.0",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  }
}
```

## Testing

### Rust Tests

```bash
# Run all tests
cargo test --workspace

# Run specific crate tests
cargo test -p aethercore-core

# Run with output
cargo test --workspace -- --nocapture
```

### TypeScript Tests

```bash
# Run all tests
pnpm run test --recursive

# Run specific package tests
pnpm run test --filter packages/my-package
```

## Pull Request Process

1. **Verify your changes**
   ```bash
   ./verify-monorepo.sh
   cargo check --workspace
   cargo test --workspace
   pnpm run build
   ```

2. **Update documentation**
   - Update README.md if adding new features
   - Add/update JSDoc or Rustdoc comments
   - Update MONOREPO_RULES.md if changing structure

3. **Create Pull Request**
   - Use a descriptive title
   - Reference any related issues
   - Describe what changed and why
   - Include test results
   - List any breaking changes

4. **Code Review**
   - Address reviewer feedback
   - Keep commits focused and atomic
   - Squash commits if requested

5. **CI Checks**
   - Ensure all CI checks pass
   - Fix any linting or test failures
   - Resolve merge conflicts

## Legacy Code Rules

⚠️ **IMPORTANT**: The `/legacy` directory is read-only.

- **DO NOT** create runtime imports from `/legacy`
- **DO NOT** modify files in `/legacy`
- **ONLY** `/crates/h2-domain/` and `/packages/h2-glass/` may reference legacy (for context only)

If you need functionality from legacy:
1. Extract the logic
2. Implement in the appropriate modern crate/package
3. Do not create runtime dependencies

## Questions?

- Review [MONOREPO_RULES.md](./MONOREPO_RULES.md)
- Check existing code for examples
- Open a discussion issue for clarification

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT OR Apache-2.0).
