# AetherCore Docker Compose Guide

**Classification:** OPERATIONAL  
**Purpose:** Development environment setup and troubleshooting  
**Last Updated:** 2026-02-15

---

## Overview

This guide covers the Docker Compose development environment for AetherCore. The compose stack is intended for **development and testing only**. For production deployment, see [DEPLOYMENT_PRODUCTION.md](../DEPLOYMENT_PRODUCTION.md).

## Quick Start

### Prerequisites

- Docker 24.0+
- Docker Compose 2.20+
- Available ports: 50051, 5432, 6379, 3000, 3001, 8080 (or customize via `.env`)

### First Run

```bash
cd /home/runner/work/AetherCore/AetherCore/infra/docker

# Copy the example environment file
cp .env.example .env

# Start the stack
docker compose up -d

# View logs
docker compose logs -f

# Check service health
docker compose ps
```

### Stopping the Stack

```bash
# Stop services (preserves volumes)
docker compose stop

# Stop and remove containers (preserves volumes)
docker compose down

# Stop, remove containers AND volumes (clean slate)
docker compose down -v
```

---

## Port Configuration

All ports are configurable via environment variables to avoid conflicts with existing services or enable running multiple stacks simultaneously.

### Default Ports

| Service       | Default Port | Environment Variable    |
|---------------|--------------|-------------------------|
| C2 Router     | 50051        | `C2_ROUTER_PORT`        |
| PostgreSQL    | 5432         | `POSTGRES_PORT`         |
| Redis         | 6379         | `REDIS_PORT`            |
| Gateway       | 3000         | `GATEWAY_PORT`          |
| Auth          | 3001         | `AUTH_PORT`             |
| Collaboration | 8080         | `COLLABORATION_PORT`    |

### Customizing Ports

Edit your `.env` file to change port mappings:

```bash
# .env
C2_ROUTER_PORT=50052
POSTGRES_PORT=5433
REDIS_PORT=6380
GATEWAY_PORT=3100
AUTH_PORT=3101
COLLABORATION_PORT=8081
```

After changing ports, restart the stack:

```bash
docker compose down
docker compose up -d
```

---

## Running Multiple Stacks Side-by-Side

You can run multiple AetherCore stacks simultaneously for testing different configurations or versions.

### Method 1: Using Different .env Files

```bash
# Create a second environment configuration
cp .env.example .env-dev2

# Edit .env-dev2 to use different ports
# C2_ROUTER_PORT=50052
# POSTGRES_PORT=5433
# REDIS_PORT=6380
# GATEWAY_PORT=3100
# AUTH_PORT=3101
# COLLABORATION_PORT=8081

# Start the second stack with a different project name
docker compose --env-file .env-dev2 -p aethercore-dev2 up -d

# View second stack status
docker compose -p aethercore-dev2 ps

# Stop second stack
docker compose -p aethercore-dev2 down
```

### Method 2: Using Project Names

```bash
# Default stack (uses .env)
docker compose -p aethercore-main up -d

# Second stack with custom ports
export C2_ROUTER_PORT=50052
export POSTGRES_PORT=5433
export REDIS_PORT=6380
export GATEWAY_PORT=3100
export AUTH_PORT=3101
export COLLABORATION_PORT=8081
docker compose -p aethercore-alt up -d

# List all compose projects
docker compose ls

# Manage specific projects
docker compose -p aethercore-main logs -f
docker compose -p aethercore-alt logs -f
```

---

## Troubleshooting

### Port Conflicts

**Symptom:** Error message like `Error starting userland proxy: listen tcp4 0.0.0.0:5432: bind: address already in use`

**Cause:** Another service (or AetherCore instance) is already using the port.

**Solution 1: Identify the conflicting process**

```bash
# Linux/macOS - Find what's using port 5432
sudo lsof -i :5432
# or
sudo netstat -tulpn | grep 5432

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 5432 | Select-Object -Property LocalAddress, LocalPort, State, OwningProcess
Get-Process -Id <OwningProcess>
```

**Solution 2: Change the port in .env**

```bash
# Edit .env and change the conflicting port
echo "POSTGRES_PORT=5433" >> .env

# Restart the stack
docker compose down
docker compose up -d
```

**Solution 3: Stop conflicting containers**

```bash
# List all running containers
docker ps

# Stop conflicting AetherCore containers
docker compose -p <project-name> down

# Or stop all containers
docker stop $(docker ps -q)
```

### Container Name Conflicts

**Symptom:** Error like `The container name "/aethercore-postgres" is already in use`

**Cause:** This shouldn't occur with the updated compose file, but may happen if you have old containers from previous configurations.

**Solution:**

```bash
# List all containers (including stopped)
docker ps -a | grep aethercore

# Remove conflicting containers
docker rm -f aethercore-postgres aethercore-redis aethercore-gateway aethercore-auth aethercore-collaboration aethercore-c2-router

# Or remove all stopped containers
docker container prune
```

### Fresh Start / Clean Slate

When you need to completely reset your development environment:

```bash
# Stop all services and remove volumes (DESTROYS ALL DATA)
docker compose down -v

# Remove any orphaned containers
docker compose down --remove-orphans

# Remove build cache (optional)
docker compose build --no-cache

# Start fresh
docker compose up -d
```

### Service Won't Start

**Check logs for specific service:**

```bash
docker compose logs <service-name>
# Examples:
docker compose logs postgres
docker compose logs gateway
docker compose logs auth
```

**Check service health:**

```bash
docker compose ps

# Look for services in "unhealthy" state
# Check healthcheck logs
docker inspect <container-id> | grep -A 10 Health
```

**Common issues:**

1. **Database connection errors:** Wait for PostgreSQL to finish initializing (check logs)
2. **Network errors:** Ensure Docker network is created: `docker network ls`
3. **Build errors:** Rebuild with `docker compose build --no-cache`

### Database Issues

**Reset database (DESTROYS DATA):**

```bash
docker compose down -v postgres
docker compose up -d postgres
```

**Access database console:**

```bash
docker compose exec postgres psql -U aethercore -d aethercore
```

**Run migrations manually:**

```bash
docker compose exec gateway npm run migrate
```

### View All Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f gateway

# Last 100 lines
docker compose logs --tail=100

# With timestamps
docker compose logs -f --timestamps
```

---

## Cleanup Procedures

### Regular Cleanup (Keep Data)

```bash
# Stop services
docker compose stop

# Remove containers but keep volumes
docker compose down
```

### Deep Cleanup (Remove Everything)

```bash
# Remove containers and volumes
docker compose down -v

# Remove images (optional, will need to rebuild)
docker compose down --rmi all

# Remove orphaned containers
docker compose down --remove-orphans

# Clean up Docker system (removes all unused resources)
docker system prune -a --volumes
```

### Selective Cleanup

```bash
# Remove only specific service
docker compose rm -f postgres

# Remove specific volume
docker volume rm infra_docker_postgres_data

# List volumes
docker volume ls
```

---

## Development Workflow

### Making Code Changes

1. **Rebuild specific service:**
   ```bash
   docker compose build gateway
   docker compose up -d gateway
   ```

2. **Rebuild all services:**
   ```bash
   docker compose build
   docker compose up -d
   ```

3. **Force recreate containers:**
   ```bash
   docker compose up -d --force-recreate
   ```

### Debugging

1. **Execute commands in running container:**
   ```bash
   docker compose exec gateway sh
   docker compose exec postgres psql -U aethercore
   ```

2. **View real-time logs:**
   ```bash
   docker compose logs -f gateway
   ```

3. **Inspect container:**
   ```bash
   docker compose exec gateway env
   docker compose exec gateway ps aux
   ```

---

## Environment Variables Reference

### Required Variables

These must be set in `.env` (defaults provided):

```bash
# Ports
C2_ROUTER_PORT=50051
POSTGRES_PORT=5432
REDIS_PORT=6379
GATEWAY_PORT=3000
AUTH_PORT=3001
COLLABORATION_PORT=8080

# Database
POSTGRES_DB=aethercore
POSTGRES_USER=aethercore
POSTGRES_PASSWORD=aethercore_dev_password

# Auth
JWT_SECRET=dev_jwt_secret_change_in_production

# Environment
NODE_ENV=development
```

### Optional Variables

```bash
# Rust logging (for any Rust services)
RUST_LOG=info

# Custom database connection string
DATABASE_URL=postgresql://user:pass@host:port/db
```

---

## Network Architecture

The development stack uses a bridge network named `aethercore` (or `<project>_aethercore` with custom project names).

### Service Communication

Services communicate via Docker's internal DNS:

- `postgres:5432` - PostgreSQL
- `redis:6379` - Redis
- `c2-router:50051` - C2 Router
- `gateway:3000` - Gateway API
- `auth:3001` - Auth Service
- `collaboration:8080` - Collaboration Service

### External Access

Host machine access uses mapped ports (configurable via `.env`):

- `localhost:${POSTGRES_PORT}` - PostgreSQL
- `localhost:${REDIS_PORT}` - Redis
- `localhost:${C2_ROUTER_PORT}` - C2 Router
- `localhost:${GATEWAY_PORT}` - Gateway API
- `localhost:${AUTH_PORT}` - Auth Service
- `localhost:${COLLABORATION_PORT}` - Collaboration WebSocket

---

## Best Practices

### Development

1. **Always use `.env` files:** Don't hardcode ports or credentials
2. **Use project names:** Makes it easier to manage multiple stacks
3. **Clean up regularly:** Run `docker compose down -v` when switching branches
4. **Check logs:** Use `docker compose logs -f` to monitor service health

### Team Environments

1. **Share `.env.example`:** Keep it updated with all required variables
2. **Don't commit `.env`:** Add it to `.gitignore` (already done)
3. **Document port changes:** If you change defaults, update team documentation
4. **Use consistent project names:** Agree on naming convention for shared environments

### CI/CD Integration

```bash
# Use explicit project names in CI
docker compose -p aethercore-ci-${BUILD_ID} up -d

# Always clean up after tests
docker compose -p aethercore-ci-${BUILD_ID} down -v
```

---

## Differences from Production

The development compose stack differs from production deployment:

| Aspect | Development | Production (Bunker) |
|--------|-------------|---------------------|
| TPM | Mock/disabled | Required (hardware) |
| TLS | Optional | TLS 1.3 mandatory |
| Secrets | `.env` file | External secrets manager |
| Data persistence | Docker volumes | Host-mounted NVMe |
| Observability | Basic logs | Prometheus + Grafana |
| Network mode | Bridge | Mixed (some host networking) |
| Container names | Project-namespaced | Fixed with `-bunker` suffix |

For production deployment, see [DEPLOYMENT_PRODUCTION.md](../DEPLOYMENT_PRODUCTION.md).

---

## Appendix: Command Reference

### Essential Commands

```bash
# Start
docker compose up -d

# Stop
docker compose stop

# Restart
docker compose restart

# Remove (keep volumes)
docker compose down

# Remove (destroy volumes)
docker compose down -v

# View status
docker compose ps

# View logs
docker compose logs -f

# Execute command
docker compose exec <service> <command>

# Rebuild
docker compose build

# Scale service (not applicable for services with fixed ports)
docker compose up -d --scale worker=3
```

### Advanced Commands

```bash
# List all compose projects
docker compose ls

# Run one-off command
docker compose run --rm gateway npm test

# Validate compose file
docker compose config

# Show running processes
docker compose top

# View resource usage
docker stats

# Export compose config
docker compose config > docker-compose.resolved.yml
```

---

## Related Documentation

- [DEPLOYMENT_PRODUCTION.md](../DEPLOYMENT_PRODUCTION.md) - Production deployment guide
- [INSTALLATION.md](../INSTALLATION.md) - Desktop installation
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [SECURITY.md](../SECURITY.md) - Security guidelines

---

**Status:** OPERATIONAL ✅  
**Maintainer:** AetherCore Development Team  
**Review Cycle:** Quarterly
