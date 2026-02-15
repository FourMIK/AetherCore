# AetherCore Gateway Service

The Gateway service provides WebSocket and HTTP API endpoints for command dispatch and telemetry streaming.

## Proto File Vendoring

The Gateway service uses gRPC to communicate with the C2 Router service. The proto definition is **vendored** in `proto/c2.proto` to eliminate runtime dependencies on the monorepo `crates/` directory structure.

### Build-Time Proto Sync

During build in a monorepo context:
- `pnpm run proto:sync` syncs from the authoritative source at `crates/c2-router/proto/c2.proto`
- The vendored proto is updated only if the crates directory is available

In standalone builds (e.g., Docker, release packaging):
- The build uses the vendored proto at `services/gateway/proto/c2.proto`
- No dependency on the `crates/` directory structure

### Runtime Proto Loading

At runtime, the compiled service loads the proto from `dist/proto/c2.proto`, which is copied during the build process by `scripts/copy-proto-assets.mjs`.

This approach ensures:
- ✅ Gateway container boots reliably with minimal runtime contents
- ✅ No dependency on monorepo layout at runtime
- ✅ Proto stays synchronized with the Rust implementation when building in monorepo context

## Development

```bash
# Install dependencies
pnpm install

# Build the service (syncs proto, generates types, compiles TypeScript)
pnpm build

# Run tests
pnpm test

# Start the service
pnpm start
```

## Docker Build

The Dockerfile does not require the `crates/` directory to be copied. The vendored proto in `services/gateway/proto/` is sufficient for building the service.

```bash
docker build -f infra/docker/Dockerfile.gateway -t aethercore-gateway .
```
