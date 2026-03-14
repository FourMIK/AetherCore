# AetherCore Development Docker Compose Stack

This directory contains the Docker Compose configuration for running AetherCore services locally for development and testing.

## Quick Start

```bash
# Copy the example environment file
cp .env.example .env

# (Optional) Customize ports in .env to avoid conflicts

# Start the stack
docker compose up -d

# View logs
docker compose logs -f

# Stop the stack (preserves data)
docker compose down

# Stop and remove all data
docker compose down -v
```

## Demo Boot (Stealth Synthetic, SF Bay AO)

Use the one-command demo profile to boot with deterministic synthetic Lattice ingest, REST-only, and fail-visible preflight checks:

```bash
pnpm run demo:lattice:boot
```

The command enforces:
- `LATTICE_INTEGRATION_MODE=stealth_readonly`
- `LATTICE_PROTOCOL_MODE=rest`
- `LATTICE_INPUT_MODE=synthetic`
- `LATTICE_SYNTHETIC_SCENARIO=sf_bay_maritime_incursion_v1`
- `LATTICE_SYNTHETIC_INGEST_INTERVAL_MS=2000` (accelerated demo ingest cadence)

Preflight validation is performed against:
- `GET /api/lattice/status`
- `GET /api/lattice/scenario/preflight`

To stop the stack:

```bash
pnpm run demo:lattice:down
```

## Services

- **c2-router** (port 50051): Mock C2 Router gRPC service
- **postgres** (port 5432): PostgreSQL 16 database
- **redis** (port 6379): Redis 7 cache
- **gateway** (port 3000): Gateway API service
- **auth** (port 3001): Authentication service
- **collaboration** (port 8080): Collaboration/WebSocket service
- **lattice-bridge** (port 3010): Lattice entities/tasks/objects bridge service

## Configuration

All ports are configurable via `.env` file. See `.env.example` for available options.
Lattice bridge defaults to `LATTICE_INTEGRATION_MODE=stealth_readonly` and `LATTICE_INPUT_MODE=synthetic` with REST-only ingest and outbound writes disabled.
Use `LATTICE_SYNTHETIC_INGEST_INTERVAL_MS` to tune synthetic ingest speed for demos (lower = faster).
Bridge-to-gateway and bridge control-plane calls use `LATTICE_GATEWAY_INTERNAL_TOKEN` (default local value in `.env.example`; rotate for shared environments).
When switching to `LATTICE_INTEGRATION_MODE=standard` and `LATTICE_PROTOCOL_MODE=hybrid|grpc`, set `LATTICE_GRPC_TARGET` and transport vars (`LATTICE_GRPC_INSECURE` or TLS/mTLS cert paths).

## Documentation

For detailed documentation on:
- Port configuration and conflicts
- Running multiple stacks side-by-side
- Troubleshooting
- Cleanup procedures
- Development workflows

See: [Docker Compose Guide](../../docs/DOCKER_COMPOSE_GUIDE.md)
Demo runbook: [Lattice Demo Playbook](../../docs/LATTICE_DEMO_PLAYBOOK.md)

## Production Deployment

This compose file is for **development only**. For production deployment, see:
- [DEPLOYMENT_PRODUCTION.md](../../DEPLOYMENT_PRODUCTION.md)
- [infra/deploy/bunker/docker-compose.bunker.yml](../deploy/bunker/docker-compose.bunker.yml)
