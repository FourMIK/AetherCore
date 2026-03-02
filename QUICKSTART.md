# Quick Start Guide - Manual Steps

## Issue: Docker Desktop Not Starting

Docker Desktop is currently unable to start. Please follow these steps:

### 1. Fix Docker Desktop

**Option A: Restart Docker Desktop from System Tray**
1. Right-click the Docker icon in your system tray (bottom-right of screen)
2. Click "Restart"
3. Wait 1-2 minutes for Docker to fully start
4. Verify it's running: open PowerShell and run `docker ps`

**Option B: Restart from Docker Desktop UI**
1. Open "Docker Desktop" from Start menu
2. Click the gear icon (Settings) in top-right
3. Go to "Troubleshoot"
4. Click "Restart Docker Desktop"
5. Wait 1-2 minutes

**Option C: Check WSL2 (if above doesn't work)**
1. Open PowerShell as Administrator
2. Run: `wsl --update`
3. Run: `wsl --set-default-version 2`
4. Restart Docker Desktop

**Option D: Full Reset (last resort)**
1. Open Docker Desktop
2. Go to Settings → Troubleshoot
3. Click "Reset to factory defaults"
4. Restart Docker Desktop

### 2. Once Docker is Running

Open PowerShell in the AetherCore directory and run:

```powershell
# Navigate to docker directory
cd infra/docker

# Start all services (this will build images on first run - takes 5-10 minutes)
docker compose up -d --build

# Wait for services to be healthy (this checks every 10 seconds)
docker compose ps

# You should see all services in "running" state with "healthy" status
```

### 3. Install Dashboard Dependencies

In a NEW PowerShell window:

```powershell
# Navigate to dashboard
cd packages/dashboard

# Install dependencies (one-time setup, takes 2-3 minutes)
pnpm install
```

### 4. Start the Dashboard

Choose ONE option:

**Option A: Desktop App (Recommended)**
```powershell
cd packages/dashboard
pnpm tauri dev
```

**Option B: Web Browser**
```powershell
cd packages/dashboard
pnpm dev
```
Then open http://localhost:5173 in your browser.

### 5. Verify Everything is Running

**Check Docker Services:**
```powershell
cd infra/docker
docker compose ps
```

You should see:
- ✅ c2-router (healthy)
- ✅ postgres (healthy)
- ✅ redis (healthy)
- ✅ gateway (healthy)
- ✅ auth (healthy)
- ✅ collaboration (healthy)

**View Service Logs:**
```powershell
# All services
docker compose logs -f

# Specific service
docker compose logs -f collaboration
docker compose logs -f gateway
```

### 6. Access the Dashboard

Once `pnpm tauri dev` or `pnpm dev` finishes starting:
- **Desktop App:** Opens automatically
- **Web:** Navigate to http://localhost:5173

You should see:
- 🔴 Red banner at top: "TPM DISABLED - Hardware-Rooted Trust Features Disabled"
- Dashboard with connection status
- Ability to add nodes and view mesh

## Troubleshooting

### "Cannot connect to Docker daemon"
- Docker Desktop is not running
- Follow step 1 above to restart it

### Port conflicts (address already in use)
Edit `infra/docker/.env` and change conflicting ports:
```bash
COLLABORATION_PORT=8081  # Changed from 8080
GATEWAY_PORT=3001        # Changed from 3000
# etc...
```

Then restart:
```powershell
cd infra/docker
docker compose down
docker compose up -d
```

### Dashboard shows "Connection Failed"
1. Check collaboration service is running:
   ```powershell
   docker compose ps collaboration
   ```

2. Check logs:
   ```powershell
   docker compose logs collaboration
   ```

3. Verify WebSocket URL in `packages/dashboard/.env`:
   ```bash
   VITE_GATEWAY_URL=ws://localhost:8080
   ```

### Builds are slow
First time builds take 5-10 minutes to download base images and build services. Subsequent starts are much faster (30-60 seconds).

## Quick Commands Reference

```powershell
# Start services
cd infra/docker
docker compose up -d

# Stop services
docker compose down

# Restart services
docker compose restart

# View logs
docker compose logs -f

# Rebuild specific service
docker compose up -d --build collaboration

# Remove everything (clean slate)
docker compose down -v

# Start dashboard
cd packages/dashboard
pnpm tauri dev
```

## Next Steps

Once everything is running:
1. Explore the dashboard
2. Try adding a node
3. View mesh topology
4. Check System Admin panel for TPM status

For more details, see `LOCAL_SETUP.md`
