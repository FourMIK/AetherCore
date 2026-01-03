# Deprecated TypeScript Implementation

**Status:** DEPRECATED - DO NOT USE

## Context

The h2-ingest service was originally prototyped in TypeScript but has been migrated to **Rust** for high-velocity telemetry processing.

## Why Rust?

Per AetherCore architectural invariants:
- **Memory Safety:** Rust is the source of truth for edge execution
- **Zero-Copy:** High-velocity streams require zero-copy processing
- **Performance:** Sub-millisecond latency requirements

## Active Implementation

The production implementation is in:
- **Rust Source:** `../main.rs`, `../handlers.rs`, `../config.rs`, `../state.rs`
- **Dockerfile:** `../Dockerfile` (builds Rust binary)
- **Port:** 8090
- **Build:** `cargo build --release --bin h2-ingest`

## Migration Date

Migrated to Rust: 2026-01-03 (TRL-9 Deployment Readiness)

---

**Do not restore these files to active use without explicit architectural review.**
