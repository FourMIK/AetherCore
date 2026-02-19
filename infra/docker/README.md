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

## Services

- **c2-router** (port 50051): Mock C2 Router gRPC service
- **postgres** (port 5432): PostgreSQL 16 database
- **redis** (port 6379): Redis 7 cache
- **gateway** (port 3000): Gateway API service
- **auth** (port 3001): Authentication service
- **collaboration** (port 8080): Collaboration/WebSocket service

## Configuration

All ports are configurable via `.env` file. See `.env.example` for available options.

## Documentation

For detailed documentation on:
- Port configuration and conflicts
- Running multiple stacks side-by-side
- Troubleshooting
- Cleanup procedures
- Development workflows

See: [Docker Compose Guide](../../docs/DOCKER_COMPOSE_GUIDE.md)

## Production Deployment

This compose file is for **development only**. For production deployment, see:
- [DEPLOYMENT_PRODUCTION.md](../../DEPLOYMENT_PRODUCTION.md)
- [infra/deploy/bunker/docker-compose.bunker.yml](../deploy/bunker/docker-compose.bunker.yml)
