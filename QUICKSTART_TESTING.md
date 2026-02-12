# AetherCore Testing Package - Quick Start

**Version:** 0.1.0-alpha  
**Date:** 2026-02-12  
**For:** Testing Team

---

## 🚀 Get Started in 5 Minutes

This is the fastest way to get AetherCore running for testing.

### Prerequisites Check

Before you start, ensure you have:

- [ ] **Docker** installed (version 24.0+)
- [ ] **Git** installed (version 2.30+)
- [ ] **8GB RAM** available
- [ ] **Port 8080** available
- [ ] **Internet connection** for downloading dependencies

### Step 1: Clone & Deploy

```bash
# Clone the repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Run automated deployment
./scripts/deploy-testing.sh
```

The script will:
- ✓ Check prerequisites
- ✓ Create configuration
- ✓ Build services
- ✓ Start deployment

**Time:** 10-15 minutes (first run)

### Step 2: Verify Deployment

```bash
# Run health checks
./scripts/test-deployment-health.sh
```

Expected output: All checks passing ✓

### Step 3: Access Dashboard

Open your browser to:
```
http://localhost:8080
```

You should see the AetherCore Tactical Glass dashboard.

---

## 🧪 Run Your First Test

### Test 1: Connect to Local Mesh

1. Open dashboard at `http://localhost:8080`
2. Click **"Mesh Connection"** tab
3. Click **"Connect to Local Mesh"**
4. Verify status shows **"🟢 Connected"**

✓ **Success:** You're connected to the mesh!

### Test 2: Generate Test Identity

```bash
# Generate a test operator identity
./scripts/generate-test-identity.sh my-test-operator test-squad-bravo
```

Your identity is saved in `deployments/testing/identities/`

### Test 3: Check API Health

```bash
# Query the health endpoint
curl http://localhost:8080/api/health

# Expected response:
# {"status":"healthy","version":"0.1.0"}
```

✓ **Success:** API is responding!

---

## 📖 Next Steps

After successful initial setup:

1. **Read Full Guide:** See [TESTING_DEPLOYMENT.md](TESTING_DEPLOYMENT.md)
2. **Run Test Scenarios:** Follow scenarios in testing guide
3. **Review Architecture:** See [ARCHITECTURE.md](ARCHITECTURE.md)
4. **Report Issues:** Use [GitHub Issues](https://github.com/FourMIK/AetherCore/issues)

---

## 🛑 Common Issues & Quick Fixes

### Issue: "Port 8080 already in use"

**Fix:**
```bash
# Find what's using port 8080
sudo lsof -i :8080

# Stop the service or change AetherCore port
export AETHERCORE_PORT=8081
```

### Issue: "Docker daemon not running"

**Fix:**
```bash
# Start Docker
sudo systemctl start docker

# Or on macOS
open -a Docker
```

### Issue: "Permission denied"

**Fix:**
```bash
# Make scripts executable
chmod +x scripts/*.sh

# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Then log out and back in
```

### Issue: Services won't start

**Fix:**
```bash
# Check logs
docker-compose -f deployments/testing/docker-compose.testing.yml logs

# Or check individual service logs
tail -f deployments/testing/logs/*.log
```

---

## 🧹 Cleanup

To stop and remove testing deployment:

```bash
# Stop Docker services
cd deployments/testing
docker-compose -f docker-compose.testing.yml down

# Remove data (optional)
rm -rf deployments/testing/data/*

# Remove identities (optional)
rm -rf deployments/testing/identities/*
```

---

## 📞 Need Help?

1. **Check Troubleshooting:** [TESTING_DEPLOYMENT.md](TESTING_DEPLOYMENT.md) section 🐛
2. **Review Logs:** `deployments/testing/logs/`
3. **GitHub Issues:** [Report a problem](https://github.com/FourMIK/AetherCore/issues/new)
4. **Email Support:** testing@example.com

---

## ✅ Testing Checklist

Use this to track your testing progress:

- [ ] Successfully deployed AetherCore
- [ ] All health checks passing
- [ ] Dashboard accessible at http://localhost:8080
- [ ] API health check returns 200 OK
- [ ] Generated test identity
- [ ] Connected to local mesh
- [ ] Ran basic test scenarios
- [ ] Reviewed architecture documentation
- [ ] Reported any issues found

---

## 📦 What You're Testing

**AetherCore** is a hardware-rooted trust fabric for contested environments:

- **🛡️ Hardware Identity:** Every node cryptographically bound to silicon
- **🔗 Merkle Vine:** Historical data anchoring prevents retroactive injection
- **⚡ Aetheric Sweep:** Automated Byzantine node detection and isolation
- **🖥️ Tactical Glass:** GPU-accelerated fleet command dashboard

**Current Status:** Alpha release (v0.1.0) - Dev mode enabled for testing

---

## 🔐 Security Notes

This testing deployment runs in **DEV MODE**:

- ✓ TPM validation disabled (for compatibility)
- ✓ Test identities use plaintext keys
- ✓ HTTP used instead of HTTPS
- ✓ SQLite instead of PostgreSQL

**⚠️ Never use this configuration in production!**

For production deployment, see [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)

---

**Happy Testing! 🚀**

*For detailed testing procedures, see [TESTING_DEPLOYMENT.md](TESTING_DEPLOYMENT.md)*
