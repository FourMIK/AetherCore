# Vendored Lattice Protobuf Snapshot

This directory contains a pinned, vendored snapshot of the protobuf contracts used by `@aethercore/lattice-bridge` for gRPC ingestion.

- Source module: `buf.build/anduril/lattice-sdk`
- Snapshot metadata: [`VERSION.json`](./VERSION.json)
- Refresh workflow: `pnpm --filter @aethercore/lattice-bridge run proto:update`

The bridge treats this vendored snapshot as the build/runtime source of truth. No build-time remote fetch is required.
