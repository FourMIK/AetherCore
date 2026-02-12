# AetherCore Testing Distribution Package

**Version:** 0.1.0-alpha  
**Release Date:** 2026-02-12  
**Classification:** TEST & EVALUATION  
**Purpose:** Complete deployment package for testing team

---

## 📦 Package Overview

This package contains everything your testing team needs to deploy, configure, test, and evaluate AetherCore in a controlled testing environment.

### What is AetherCore?

**AetherCore** is a hardware-rooted trust fabric for contested multi-domain environments. It replaces "Trust-by-Policy" with **Cryptographic Certainty**, designed for:

- Autonomous swarms
- Critical infrastructure
- Edge operations where network integrity is paramount

**Key Features:**
- 🛡️ Hardware-Rooted Identity (TPM 2.0 / Secure Enclave)
- 🔗 Merkle Vine™ Integrity (historical data anchoring)
- ⚡ The Aetheric Sweep (Byzantine node detection)
- 🖥️ Tactical Glass (GPU-accelerated dashboard)

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites

- Docker 24.0+ with Docker Compose 2.20+
- OR: Rust 1.75+, Node.js 20+, pnpm
- 8GB RAM minimum
- Port 8080 available

### Deploy in 3 Steps

```bash
# 1. Extract package
tar xzf aethercore-testing-0.1.0-alpha.tar.gz
cd aethercore-testing-0.1.0-alpha

# 2. Read quick start guide
cat QUICKSTART_TESTING.md

# 3. Run automated deployment
./scripts/deploy-testing.sh
```

**Access Dashboard:** http://localhost:8080

---

## 📚 Documentation Included

### Getting Started
1. **START_HERE.md** - Package overview and quick navigation
2. **QUICKSTART_TESTING.md** - 5-minute deployment guide
3. **TESTING_DEPLOYMENT.md** - Complete testing guide with scenarios

### Reference Documentation
4. **README.md** - Project overview and capabilities
5. **ARCHITECTURE.md** - System design and data flow
6. **SECURITY.md** - Security guidelines and threat model
7. **INSTALLATION.md** - Detailed installation procedures
8. **DEPLOYMENT_PRODUCTION.md** - Production deployment reference

---

## 🛠️ Tools & Scripts Included

### Deployment Scripts
- **`scripts/deploy-testing.sh`** - Automated deployment with interactive prompts
- **`scripts/test-deployment-health.sh`** - Health check validation
- **`scripts/generate-test-identity.sh`** - Ed25519 identity generator
- **`scripts/create-testing-package.sh`** - Package creation tool

### Configuration Files
- **`config/testing.yaml`** - Testing environment configuration
- **`.env.example`** - Environment variable template
- **`docker-compose.yml`** - Docker deployment configuration

---

## ✅ Testing Workflow

### Phase 1: Setup (10-15 minutes)
1. Extract package and verify checksums
2. Review prerequisites and install missing tools
3. Run deployment script
4. Verify with health checks

### Phase 2: Initial Validation (15 minutes)
1. Access dashboard at http://localhost:8080
2. Check API health endpoint
3. Verify WebSocket connectivity
4. Generate test identity
5. Connect to local mesh

### Phase 3: Test Scenarios (30-60 minutes)
Execute the 5 test scenarios in TESTING_DEPLOYMENT.md:
1. Basic node connection
2. Identity & signature verification
3. Merkle Vine integrity validation
4. Byzantine node detection
5. Fail-visible mode verification

### Phase 4: Report Findings
1. Document results using provided template
2. Report issues on GitHub
3. Share feedback with team

---

## 🧪 Test Scenarios Summary

### Scenario 1: Basic Node Connection
**Goal:** Verify node mesh connectivity  
**Time:** 5 minutes  
**Expected:** Node appears on tactical map with green indicator

### Scenario 2: Identity & Signature Verification
**Goal:** Test Ed25519 signature enforcement  
**Time:** 10 minutes  
**Expected:** Valid signatures accepted, invalid rejected

### Scenario 3: Merkle Vine Integrity
**Goal:** Validate historical data anchoring  
**Time:** 10 minutes  
**Expected:** Broken chains detected and flagged

### Scenario 4: Byzantine Node Detection
**Goal:** Test Aetheric Sweep functionality  
**Time:** 15 minutes  
**Expected:** Byzantine node isolated automatically

### Scenario 5: Fail-Visible Mode
**Goal:** Verify unverified data visibility  
**Time:** 10 minutes  
**Expected:** Unverified data shown with warnings

---

## 🔐 Security Configuration

### Testing Mode Features
- ✓ **Dev Mode Enabled** - TPM validation disabled for compatibility
- ✓ **HTTP/WS Transport** - Unencrypted for local testing
- ✓ **Test Identities** - Plaintext keys for development
- ✓ **SQLite Database** - Lightweight for testing
- ✓ **Verbose Logging** - Debug-level logs enabled
- ✓ **CORS Unrestricted** - Allow all origins for testing

### ⚠️ Security Warnings

**This testing configuration includes:**
- No TPM hardware requirements
- No TLS/encryption for local testing
- Test keys stored in plaintext
- Simplified authentication

**DO NOT use this configuration in production!**

For production deployment, see DEPLOYMENT_PRODUCTION.md

---

## 📊 Performance Expectations

### Baseline Metrics (Testing Environment)
- **Startup Time:** < 10 seconds
- **API Response:** < 100ms (p95)
- **WebSocket Latency:** < 50ms
- **Signature Verification:** < 5ms per operation
- **Memory Usage (Idle):** < 200MB
- **CPU Usage (Idle):** < 5%

Monitor performance with:
```bash
./scripts/performance-monitor.sh
```

---

## 🐛 Troubleshooting

### Common Issues

#### Services Won't Start
```bash
# Check logs
docker-compose logs
# or
tail -f deployments/testing/logs/*.log
```

#### Port Already in Use
```bash
# Find what's using port 8080
sudo lsof -i :8080
# Change port if needed
export AETHERCORE_PORT=8081
```

#### Connection Failures
```bash
# Test connectivity
curl http://localhost:8080/api/health
# Check firewall
sudo ufw status
```

See TESTING_DEPLOYMENT.md section 🐛 for complete troubleshooting guide.

---

## 📝 Test Report Template

Document your testing using this template:

```markdown
# AetherCore Test Report

**Tester:** [Your Name]
**Date:** [YYYY-MM-DD]
**Version:** 0.1.0-alpha
**Environment:** [OS, hardware]

## Deployment
- [ ] Method: [Docker/Local]
- [ ] Success: [Yes/No]
- [ ] Time: [X minutes]

## Test Scenarios
- [ ] Scenario 1: [Pass/Fail]
- [ ] Scenario 2: [Pass/Fail]
- [ ] Scenario 3: [Pass/Fail]
- [ ] Scenario 4: [Pass/Fail]
- [ ] Scenario 5: [Pass/Fail]

## Issues Found
[List any issues]

## Performance
- Startup: [X sec]
- API response: [X ms]
- Memory: [X MB]
- CPU: [X%]

## Additional Notes
[Feedback]
```

---

## 🔄 Deployment Options

### Option A: Docker (Recommended)
**Pros:** Quick setup, isolated, reproducible  
**Cons:** Requires Docker

```bash
docker-compose up -d
./scripts/test-deployment-health.sh
```

### Option B: Local Build
**Pros:** Development debugging, code inspection  
**Cons:** Longer setup, more dependencies

```bash
./scripts/deploy-testing.sh
# Follow interactive prompts
```

### Option C: Pre-built Binaries (Future)
Coming soon: .AppImage, .dmg, .msi installers

---

## 📞 Support & Reporting

### Getting Help
1. **Documentation:** Check included .md files
2. **Troubleshooting:** TESTING_DEPLOYMENT.md section 🐛
3. **GitHub Issues:** https://github.com/FourMIK/AetherCore/issues
4. **Email:** testing@example.com

### Reporting Issues
When reporting issues, include:
- Test report (see template above)
- Log files from `deployments/testing/logs/`
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if UI-related)

### Providing Feedback
We value your feedback on:
- Deployment experience
- Documentation clarity
- UI/UX observations
- Performance characteristics
- Feature requests
- Bug reports

---

## 🧹 Cleanup

### Stop Services
```bash
# Docker deployment
docker-compose down

# Remove containers and volumes
docker-compose down -v
```

### Remove Data
```bash
# Remove test data
rm -rf deployments/testing/data/*

# Remove identities
rm -rf deployments/testing/identities/*

# Remove logs
rm -rf deployments/testing/logs/*
```

### Complete Removal
```bash
# Remove entire deployment directory
rm -rf deployments/

# Or remove entire package
cd ..
rm -rf aethercore-testing-0.1.0-alpha/
```

---

## 📦 Package Verification

### Verify Package Integrity

```bash
# Verify SHA256 checksum
sha256sum -c aethercore-testing-0.1.0-alpha.sha256

# Expected output:
# aethercore-testing-0.1.0-alpha.tar.gz: OK
```

### Package Contents Verification

```bash
# List package contents
tar tzf aethercore-testing-0.1.0-alpha.tar.gz | head -20

# Extract and verify structure
tar xzf aethercore-testing-0.1.0-alpha.tar.gz
cd aethercore-testing-0.1.0-alpha
ls -la
```

---

## 🎯 Success Criteria

Your testing deployment is successful when:

- ✅ All health checks pass
- ✅ Dashboard accessible at http://localhost:8080
- ✅ API returns 200 OK for health endpoint
- ✅ WebSocket connection established
- ✅ Test identity generated successfully
- ✅ At least 3 of 5 test scenarios pass

---

## 📈 What's Next?

### After Successful Testing
1. **Document Results:** Complete test report
2. **Report Issues:** Create GitHub issues for bugs
3. **Share Feedback:** Email findings to team
4. **Production Planning:** Review DEPLOYMENT_PRODUCTION.md

### Future Releases
- Binary distributions for all platforms
- CI/CD pipeline integration
- Automated test suite
- Performance benchmarking tools
- Integration with monitoring systems

---

## 📄 License

Copyright © 2026 FourMIK  
Released under the Apache 2.0 License

See LICENSE file in package for details.

---

## 🙏 Acknowledgments

Thank you for testing AetherCore!

Your feedback helps us build a more robust and secure system for contested environments.

---

**Questions?** See START_HERE.md or contact testing@example.com

**Ready to start?** Open QUICKSTART_TESTING.md

---

*This package was created on 2026-02-12 for testing evaluation of AetherCore v0.1.0-alpha*
