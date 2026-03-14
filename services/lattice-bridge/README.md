# AetherCore Lattice Bridge

`@aethercore/lattice-bridge` is the dedicated integration service between AetherCore and Anduril Lattice.

## Scope (Phase 1)

- Bidirectional `Entities` synchronization with non-destructive AetherCore verification overlays.
- Read-only `Tasks` ingestion (`listen-as-agent` semantics, no automatic C2 dispatch).
- `Objects` metadata and evidence linkage workflows.
- Hybrid protocol operation (`REST` + `gRPC`) with fail-visible health and audit surfaces.

## Stealth Read-Only Posture

- Default integration mode is `stealth_readonly`.
- Default input mode is `synthetic` (deterministic synthetic entities/tasks/objects).
- Stealth mode enforces REST ingest only and disables outbound writes to Lattice.
- Blocked write routes return `403` with `STEALTH_READ_ONLY` and emit sync-audit entries.

## Runtime

- Service port: `3010` (default)
- Health endpoint: `GET /health`
- Status endpoint: `GET /api/lattice/status`
- Mode endpoints: `GET /api/lattice/mode`, `POST /api/lattice/mode`
- Lattice API target: v2 endpoints only (`/api/v2/*`)
- Tasks endpoint: `GET /api/lattice/tasks` (read-only inbox)
- Objects endpoints: `GET /api/lattice/objects`, `GET /api/lattice/objects/:objectId`, `POST /api/lattice/objects/upload`

## Required environment variables

- `LATTICE_BASE_URL`
- `LATTICE_CLIENT_ID`
- `LATTICE_CLIENT_SECRET`
- `LATTICE_AGENT_ID`
- `LATTICE_GRPC_TARGET` (required only when `LATTICE_INTEGRATION_MODE=standard` and `LATTICE_PROTOCOL_MODE` is `grpc` or `hybrid`)

## Optional environment variables

- `LATTICE_INTEGRATION_MODE` (`stealth_readonly` | `standard`, default `stealth_readonly`)
- `LATTICE_PROTOCOL_MODE` (`hybrid` | `rest` | `grpc`, default `hybrid`; forced to `rest` in stealth mode)
- `LATTICE_INPUT_MODE` (`synthetic` | `live`, default `synthetic`)
- `LATTICE_SYNTHETIC_SCENARIO` (default `joint_multidomain`)
- `LATTICE_SYNTHETIC_SEED` (default `AETHERCORE-STABLE-SEED-001`)
- `LATTICE_SYNTHETIC_TIMELINE` (`dual` | `realtime`, default `dual`)
- `LATTICE_SYNTHETIC_REPLAY_HOURS` (default `24`)
- `LATTICE_SANDBOX_MODE` (`true` | `false`, default `true`)
- `SANDBOXES_TOKEN` (required when `LATTICE_SANDBOX_MODE=true`)
- `LATTICE_GRPC_INSECURE` (`false` by default; insecure is rejected in production)
- `LATTICE_GRPC_CA_CERT_PATH`
- `LATTICE_GRPC_CLIENT_CERT_PATH`
- `LATTICE_GRPC_CLIENT_KEY_PATH`
- `LATTICE_GRPC_SERVER_NAME_OVERRIDE`
- `LATTICE_GRPC_POLL_WINDOW_MS` (default `1500`)
- `LATTICE_GRPC_MAX_EVENTS` (default `256`)
- `LATTICE_GATEWAY_INTERNAL_URL` (default `http://gateway:3000/internal/lattice/events`)
- `LATTICE_GATEWAY_INTERNAL_TOKEN`
- `LATTICE_POLL_INTERVAL_MS` (default `15000` in stealth mode, `5000` otherwise)
- `LATTICE_BRIDGE_DATA_DIR` (default `./data`)

## Protobuf snapshot

- Vendored source of truth: `proto/lattice-sdk/`
- Snapshot metadata: `proto/lattice-sdk/VERSION.json`
- Generate declarations: `pnpm --filter @aethercore/lattice-bridge run proto:types`
- Refresh vendored snapshot manually: `pnpm --filter @aethercore/lattice-bridge run proto:update`

## Durability

The bridge persists state in a local SQLite DB (`lattice-bridge.db`) with tables:

- `lattice_entity_binding`
- `lattice_stream_cursor`
- `lattice_task_inbox`
- `lattice_object_registry`
- `lattice_sync_audit`
- `lattice_dead_letter`
- `lattice_runtime_mode`
