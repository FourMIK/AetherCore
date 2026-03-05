# AetherCore Local Development Setup (TPM Disabled)

This guide will help you get AetherCore running locally with TPM disabled for development and testing.

## Prerequisites

Before starting, ensure you have the following installed:

- **Docker Desktop** (includes Docker Compose)
  - Download: https://www.docker.com/products/docker-desktop
  - Required for backend services (PostgreSQL, Redis, Gateway, Auth, Collaboration)
  
- **Node.js 22.x**
  - Download: https://nodejs.org/
  - Check version: `node --version`
  
- **pnpm** (Package Manager)
  - Install: `npm install -g pnpm`
  - Check version: `pnpm --version`

- **Rust 1.75+** (Optional, only if building Rust services)
  - Download: https://rustup.rs/
  - Check version: `rustc --version`

## Quick Start

### Automated Setup (Recommended)

Run the setup script from the repository root:

```powershell
.\start-local.ps1
```

This script will:
1. Verify all prerequisites are installed
2. Start all Docker services with TPM disabled
3. Wait for services to become healthy
4. Display service URLs and next steps

### Manual Setup

If you prefer to run commands manually:

1. **Start Docker Services**
   ```powershell
   cd infra/docker
   docker compose up -d
   ```

2. **Verify Services Are Running**
   ```powershell
   docker compose ps
   ```

3. **View Service Logs** (optional)
   ```powershell
   docker compose logs -f
   ```

## Running the Dashboard

### Option 1: Tauri Desktop Application (Recommended)

```powershell
cd packages/dashboard
pnpm install
pnpm tauri dev
```

This will launch the full desktop application with:
- Hardware-accelerated rendering
- System tray integration
- Native window controls

### Option 2: Web Development Server

```powershell
cd packages/dashboard
pnpm install
pnpm dev
```

Then open http://localhost:5173 in your browser.

## Service Endpoints

Once all services are running, you can access:

| Service | Endpoint | Purpose |
|---------|----------|---------|
| C2 Router | `grpc://localhost:50051` | Command & Control gRPC |
| PostgreSQL | `localhost:5432` | Database |
| Redis | `localhost:6379` | Cache & Pub/Sub |
| Gateway | `http://localhost:3000` | API Gateway |
| Auth | `http://localhost:3001` | Authentication Service |
| Collaboration | `http://localhost:8080` | WebSocket & Mission Data |

## TPM Configuration

### Current Status
TPM is **DISABLED** for local development. This means:
- ✓ No TPM 2.0 hardware required
- ✓ Works on all development machines
- ✓ Faster node registration (no attestation)
- ⚠️ Hardware-rooted trust features disabled
- ⚠️ Identity attestation not cryptographically bound

### Configuration Files

**Docker Services** (`infra/docker/.env`):
```bash
TPM_ENABLED=false
```

**Dashboard** (`packages/dashboard/.env`):
```bash
VITE_TPM_ENABLED=false
```

### Re-enabling TPM

To enable TPM for production or testing with real hardware:

1. Update `infra/docker/.env`:
   ```bash
   TPM_ENABLED=true
   ```

2. Update `packages/dashboard/.env`:
   ```bash
   VITE_TPM_ENABLED=true
   ```

3. Restart services:
   ```powershell
   cd infra/docker
   docker compose down
   docker compose up -d
   ```

⚠️ **Warning:** Enabling TPM requires actual TPM 2.0 hardware or a TPM simulator. The services will fail to start without proper TPM access.

## Troubleshooting

### Port Conflicts

If you see errors about ports already in use, you can customize the ports in `infra/docker/.env`:

```bash
C2_ROUTER_PORT=50051
POSTGRES_PORT=5432
REDIS_PORT=6379
GATEWAY_PORT=3000
AUTH_PORT=3001
COLLABORATION_PORT=8080
```

Change any conflicting ports and restart:
```powershell
cd infra/docker
docker compose down
docker compose up -d
```

### Services Won't Start

1. **Check Docker is running:**
   ```powershell
   docker ps
   ```

2. **View service logs:**
   ```powershell
   cd infra/docker
   docker compose logs
   ```

3. **Rebuild services:**
   ```powershell
   docker compose down
   docker compose up -d --build
   ```

### Dashboard Won't Connect

1. Verify backend services are healthy:
   ```powershell
   cd infra/docker
   docker compose ps
   ```

2. Check Collaboration service is running on port 8080:
   ```powershell
   curl http://localhost:8080/health
   ```

3. Verify dashboard `.env` has correct WebSocket URL:
   ```bash
   VITE_GATEWAY_URL=ws://localhost:8080
   ```

### Database Connection Issues

1. Check PostgreSQL is running:
   ```powershell
   docker compose ps postgres
   ```

2. Test connection:
   ```powershell
   docker compose exec postgres psql -U aethercore -d aethercore
   ```

3. Reset database:
   ```powershell
   docker compose down -v
   docker compose up -d
   ```

## Stopping Services

### Stop All Services
```powershell
cd infra/docker
docker compose down
```

### Stop and Remove Volumes (Clean Slate)
```powershell
cd infra/docker
docker compose down -v
```

This will delete all database data and cached information.

## Development Workflow

1. **Start backend services** (once per session):
   ```powershell
   .\start-local.ps1
   ```

2. **Run dashboard** in dev mode:
   ```powershell
   cd packages/dashboard
   pnpm tauri dev
   ```

3. **Make changes** to code - hot reload is enabled

4. **View logs** when debugging:
   ```powershell
   cd infra/docker
   docker compose logs -f [service-name]
   ```

5. **Stop services** when done:
   ```powershell
   cd infra/docker
   docker compose down
   ```

## Additional Resources

- [TPM Configuration Guide](docs/TPM_CONFIGURATION.md) - Detailed TPM setup and security implications
- [Docker Compose Guide](docs/DOCKER_COMPOSE_GUIDE.md) - Advanced Docker configuration
- [Architecture Overview](ARCHITECTURE.md) - System design and component interaction
- [Installation Guide](INSTALLATION.md) - Production deployment instructions

## Getting Help

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Review service logs: `docker compose logs -f`
3. Consult the documentation in the `docs/` directory
4. Check for open issues on GitHub

## Security Notice

⚠️ **This configuration is for LOCAL DEVELOPMENT ONLY**

With TPM disabled:
- Identity attestation is not cryptographically bound to hardware
- Nodes cannot prove boot integrity via PCR measurements
- The system lacks hardware-rooted trust guarantees
- Susceptible to identity spoofing and software-based attacks

**Never deploy to production with TPM_ENABLED=false**

For production deployment, see:
- [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)
- [SECURITY.md](SECURITY.md)
- [SECURITY_HARDENING.md](SECURITY_HARDENING.md)
