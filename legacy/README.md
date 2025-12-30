# Legacy H2OS Snapshot

This directory contains a **read-only** snapshot of the H2OS system for reference purposes.

## Important Rules

⚠️ **NO RUNTIME IMPORTS** ⚠️

This directory exists for reference and documentation only. No code should import or use modules from this directory at runtime.

## Allowed References

Only the following modules may reference the legacy code:

1. **`/crates/h2-domain/`** - Rust crate for H2OS domain integration
2. **`/packages/h2-glass/`** - TypeScript package for H2OS visualization

All other modules in the monorepo **must not** reference or import from `/legacy`.

## Purpose

This snapshot serves as:
- Historical reference
- Documentation of legacy systems
- Migration guide for modernization efforts
- Context for H2OS integration

## Structure

```
/legacy
  ├── README.md (this file)
  └── [H2OS snapshot files would go here]
```

## Migration

When migrating functionality from legacy code:
1. Extract the necessary logic
2. Implement in the appropriate modern crate/package
3. Do NOT create runtime dependencies on legacy code
4. Reference this documentation for context only
