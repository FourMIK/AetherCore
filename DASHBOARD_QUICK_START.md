# AetherCore Dashboard - Quick Start Guide

## 🚀 Start Everything

### Option 1: Quick Launch (Recommended)

```powershell
# From project root
cd C:\Users\Owner\StudioProjects\AetherCore

# 1. Start backend services
cd infra\docker
docker compose up -d

# 2. Start dashboard (opens in new window)
cd ..\..\packages\dashboard
pnpm tauri dev
```

### Option 2: Check Health First

```powershell
# From project root
cd C:\Users\Owner\StudioProjects\AetherCore

# Run health check
.\check-dashboard-health.ps1

# If services aren't running, start them
cd infra\docker
docker compose up -d

# Then start dashboard
cd ..\..\packages\dashboard
pnpm tauri dev
```

---

## 📍 Important URLs

- **Dashboard:** http://localhost:1420
- **Gateway API:** http://localhost:3000
- **Collaboration:** http://localhost:8080

---

## ✅ Verify It's Working

Open browser to http://localhost:1420 and check:

1. **Connection Indicator** (top right) should be green
2. **Map View** should load
3. **Nodes List** may show local RalphieNode

---

## 🛑 Stop Everything

```powershell
# Stop dashboard: Close the Tauri window or press Ctrl+C in terminal

# Stop backend services
cd infra\docker
docker compose down
```

---

## 📚 Full Documentation

See `DASHBOARD_ENDPOINTS_COMPLETE.md` for complete details.

