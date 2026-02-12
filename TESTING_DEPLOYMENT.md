# AetherCore Testing Deployment Guide

**Classification:** TEST & EVALUATION  
**Purpose:** Complete deployment package for testing team  
**Version:** 0.1.0-alpha  
**Date:** 2026-02-12

---

## 🎯 Quick Start for Testing Team

This guide provides everything your testing team needs to deploy, configure, and validate AetherCore in a testing environment.

### What's Included

1. **Complete Build & Deployment Scripts**
2. **Testing Environment Configuration**
3. **Automated Setup Procedures**
4. **Validation & Health Check Tools**
5. **Troubleshooting Guides**
6. **Test Scenarios & Validation Checklist**

---

## 📋 Prerequisites

### Hardware Requirements (Testing Environment)

**Minimum Configuration:**
- 4-core CPU @ 2.5 GHz
- 8GB RAM
- 50GB available storage
- Network connectivity

**Optional (for TPM testing):**
- TPM 2.0 hardware module
- Secure Boot capable system

### Software Requirements

- **Operating System:** Ubuntu 20.04+, macOS 11+, or Windows 10+
- **Docker:** 24.0+ with Docker Compose 2.20+
- **Rust:** 1.75+ (stable)
- **Node.js:** 20.x LTS
- **pnpm:** Latest version
- **Git:** 2.30+

---

## 🚀 Deployment Options

Choose the deployment method that best fits your testing needs:

### Option A: Docker-based Testing (Recommended)

**Best for:** Quick setup, isolated testing, CI/CD integration

```bash
# 1. Clone the repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# 2. Run the automated testing deployment
./scripts/deploy-testing.sh
```

This will:
- Build all Docker containers
- Deploy the complete stack
- Run initial health checks
- Display access URLs

### Option B: Local Development Build

**Best for:** Development testing, debugging, code inspection

```bash
# 1. Clone the repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# 2. Install dependencies
pnpm install

# 3. Build Rust services
cargo build --release

# 4. Start the desktop application
cd packages/dashboard
pnpm tauri dev
```

### Option C: Binary Distribution (Coming Soon)

Pre-built binaries will be available for download from GitHub Releases:
- Linux: `.AppImage`
- macOS: `.dmg` (Universal Binary)
- Windows: `.msi`

---

## 🔧 Configuration for Testing

### Environment Configuration

Create a testing configuration file:

```bash
cp config/production.yaml config/testing.yaml
```

Edit `config/testing.yaml` to set testing-specific values:

```yaml
# Testing Configuration
environment: testing
log_level: debug

# Dev Mode (simulated TPM)
tpm:
  enabled: false
  dev_mode: true

# Network Configuration
network:
  bind_address: "0.0.0.0"
  port: 8080
  mesh_ports: [7000, 7001, 7002]

# Database (SQLite for testing)
database:
  type: sqlite
  path: "./data/testing.db"

# C2 Endpoint
c2:
  endpoint: "ws://localhost:8080/ws"
  tls_enabled: false

# Test Identity
identity:
  operator_id: "test-operator-001"
  squad_id: "test-squad-alpha"
```

### Environment Variables

Set these environment variables for testing:

```bash
# Core configuration
export AETHERCORE_ENV=testing
export RUST_LOG=debug
export RUST_BACKTRACE=1

# Dev mode (disable TPM requirements)
export AETHERCORE_DEV_MODE=true

# Database
export DATABASE_URL="sqlite://data/testing.db"

# Ports
export AETHERCORE_PORT=8080
export AETHERCORE_WS_PORT=8080
```

---

## ✅ Validation & Health Checks

After deployment, run the validation script:

```bash
./scripts/test-deployment-health.sh
```

This checks:
- ✓ All services are running
- ✓ Database connectivity
- ✓ API endpoints responding
- ✓ WebSocket connections working
- ✓ Cryptographic functions operational

### Manual Verification

1. **Dashboard Access:**
   - Open browser to `http://localhost:8080`
   - Login with test credentials (see below)
   - Verify UI loads without errors

2. **API Health Check:**
   ```bash
   curl http://localhost:8080/api/health
   # Expected: {"status": "healthy", "version": "0.1.0"}
   ```

3. **WebSocket Connection:**
   ```bash
   # Using websocat (install if needed)
   websocat ws://localhost:8080/ws
   # Should connect successfully
   ```

### Test Credentials

**Default Test User:**
- Operator ID: `test-operator-001`
- Squad ID: `test-squad-alpha`
- Auth Token: Auto-generated (see logs)

---

## 🧪 Test Scenarios

### Scenario 1: Basic Node Connection

**Objective:** Verify node can connect to mesh

1. Start the dashboard
2. Navigate to "Mesh Connection" tab
3. Click "Connect to Local Mesh"
4. Verify status shows "🟢 Connected"

**Expected Result:** Node appears on tactical map

### Scenario 2: Identity & Signature Verification

**Objective:** Test Ed25519 signature enforcement

1. Generate a test identity: `./scripts/generate-test-identity.sh`
2. Send signed telemetry via API
3. Verify signature validation in logs

**Expected Result:** Valid signatures accepted, invalid rejected

### Scenario 3: Merkle Vine Integrity

**Objective:** Validate historical data anchoring

1. Send sequence of telemetry events
2. Attempt to inject event with broken chain
3. Verify integrity violation is detected

**Expected Result:** Broken chain flagged, event rejected

### Scenario 4: Byzantine Node Detection

**Objective:** Test Aetheric Sweep functionality

1. Deploy two test nodes
2. Configure one to send invalid signatures
3. Observe detection and isolation

**Expected Result:** Byzantine node flagged and isolated

### Scenario 5: Fail-Visible Mode

**Objective:** Verify unverified data is visible but marked

1. Send unverified telemetry
2. Check dashboard display
3. Verify warning indicators present

**Expected Result:** Data shown with "⚠️ UNVERIFIED" marker

---

## 📊 Performance Baselines

Expected performance in testing environment:

- **Startup Time:** < 10 seconds
- **API Response Time:** < 100ms (p95)
- **WebSocket Latency:** < 50ms
- **Signature Verification:** < 5ms per operation
- **Memory Usage (Idle):** < 200MB
- **CPU Usage (Idle):** < 5%

Monitor with:
```bash
./scripts/performance-monitor.sh
```

---

## 🐛 Troubleshooting

### Issue: Services won't start

**Check:**
```bash
docker-compose logs
# or
cargo run -- --config config/testing.yaml 2>&1 | tee debug.log
```

**Common causes:**
- Port already in use (check with `netstat -tulpn`)
- Missing dependencies (`pnpm install`)
- Database migration needed

### Issue: WebSocket connection fails

**Check:**
1. Firewall allows port 8080
2. WebSocket URL is correct (`ws://` not `wss://` for testing)
3. Backend service is running

**Debug:**
```bash
# Test direct connection
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  http://localhost:8080/ws
```

### Issue: Signature verification fails

**Check:**
1. Dev mode enabled: `export AETHERCORE_DEV_MODE=true`
2. Identity generated: `./scripts/generate-test-identity.sh`
3. Keys are in correct format (Ed25519)

### Issue: High CPU usage

**Possible causes:**
- Too many nodes in mesh (reduce to < 10 for testing)
- Logging level too verbose (set `RUST_LOG=info`)
- Byzantine sweep running continuously (check logs)

---

## 📝 Test Report Template

Use this template to document your testing:

```markdown
# AetherCore Test Report

**Tester:** [Your Name]
**Date:** [YYYY-MM-DD]
**Version:** 0.1.0-alpha
**Environment:** [OS, hardware details]

## Deployment
- [ ] Deployment method: [Docker/Local/Binary]
- [ ] Deployment successful: [Yes/No]
- [ ] Time to deploy: [X minutes]

## Health Checks
- [ ] All services running
- [ ] API accessible
- [ ] WebSocket functional
- [ ] Dashboard loads

## Test Scenarios Executed
- [ ] Scenario 1: Basic Node Connection - [Pass/Fail]
- [ ] Scenario 2: Identity & Signatures - [Pass/Fail]
- [ ] Scenario 3: Merkle Vine Integrity - [Pass/Fail]
- [ ] Scenario 4: Byzantine Detection - [Pass/Fail]
- [ ] Scenario 5: Fail-Visible Mode - [Pass/Fail]

## Performance Metrics
- Startup time: [X seconds]
- API response time: [X ms]
- Memory usage: [X MB]
- CPU usage: [X%]

## Issues Found
[List any issues, errors, or unexpected behavior]

## Additional Notes
[Any other observations or feedback]
```

---

## 🔐 Security Notes for Testing

- **Dev Mode:** TPM validation is disabled for testing convenience
- **Test Keys:** Generated keys are for testing only, not production
- **Network Security:** Testing configuration uses HTTP/WS (not HTTPS/WSS)
- **Database:** SQLite used for testing (PostgreSQL recommended for production)

**⚠️ WARNING:** Do NOT use testing configuration in production environments!

---

## 📚 Additional Resources

- **Architecture:** See [ARCHITECTURE.md](ARCHITECTURE.md)
- **Security:** See [SECURITY.md](SECURITY.md)
- **Protocol Details:** See [PROTOCOL_OVERVIEW.md](PROTOCOL_OVERVIEW.md)
- **Production Deployment:** See [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)
- **API Documentation:** See `docs/API.md`

---

## 🤝 Support & Feedback

### Reporting Issues

1. Check [Troubleshooting](#-troubleshooting) section
2. Search existing [GitHub Issues](https://github.com/FourMIK/AetherCore/issues)
3. If not resolved, create new issue with:
   - Test report (see template above)
   - Log files from `./logs/`
   - Steps to reproduce
   - Expected vs actual behavior

### Contact

- **Testing Questions:** testing@example.com
- **Technical Support:** support@example.com
- **Security Issues:** security@example.com (see [SECURITY.md](SECURITY.md))

---

## 📦 What's Next?

After successful testing:

1. **Document Results:** Fill out test report template
2. **Report Issues:** Create GitHub issues for bugs found
3. **Provide Feedback:** Share usability observations
4. **Production Planning:** Review [DEPLOYMENT_PRODUCTION.md](DEPLOYMENT_PRODUCTION.md)

---

**Status:** TESTING DEPLOYMENT PACKAGE READY ✅  
**Maintainer:** AetherCore Team  
**Testing Support:** Active during evaluation phase
