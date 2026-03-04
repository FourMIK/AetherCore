# AWS AetherCore Integration - Documentation Index

**Integration Date:** March 3, 2026  
**Status:** ✅ COMPLETE & READY  
**AWS Endpoint:** `https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/`

---

## 📚 Documentation Files

### Getting Started (Start Here)

**👉 [AWS_QUICK_REFERENCE.md](AWS_QUICK_REFERENCE.md)** (4.5 KB)
- Quick command reference
- Environment variables at a glance
- Service endpoints table
- Fast troubleshooting lookup
- **Read this first for quick setup**

### Detailed Setup & Troubleshooting

**📖 [AWS_TESTBED_SETUP.md](AWS_TESTBED_SETUP.md)** (11.1 KB)
- Complete step-by-step setup guide
- Network architecture diagrams
- Detailed configuration explanation
- Comprehensive troubleshooting section
- Local ↔ AWS switching instructions
- **Read this for detailed guidance**

### Integration Reference

**📖 [AWS_INTEGRATION_COMPLETE.md](AWS_INTEGRATION_COMPLETE.md)** (11.6 KB)
- Integration architecture overview
- Data flow diagrams
- Security model explanation
- File changes summary
- Testing checklist
- **Read this to understand the system**

### Integration Status

**📖 [AWS_INTEGRATION_STATUS.md](AWS_INTEGRATION_STATUS.md)** (12.5 KB)
- Complete integration summary
- Connectivity test results
- Endpoint reference tables
- Service descriptions
- Next steps and operational workflow
- **Read this for final verification**

---

## 🛠️ Tools & Scripts

### Network Verification
**🔧 [check-aws-connectivity.ps1](check-aws-connectivity.ps1)** (3.8 KB)
```powershell
# Run to verify AWS connectivity
./check-aws-connectivity.ps1

# Expected output:
# ✅ DNS Resolution - PASSED
# ✅ Port 443 - REACHABLE
# ✅ Configuration Files - FOUND
# ✅ Dashboard Config - VERIFIED
```

---

## ⚙️ Configuration Files

### Network Profile
**🔧 [config/aws-testbed.yaml](config/aws-testbed.yaml)** (5.8 KB)
- Complete AWS testbed configuration
- All network endpoints defined
- TPM, security, and policy settings
- Merkle Vine and Trust Mesh config
- **Reference for production deployment**

### Dashboard Configuration
**⚙️ [packages/dashboard/.env](packages/dashboard/.env)** (Updated)
```
✓ VITE_API_ENDPOINT=https://aethercore-aws-testbed-alb-...amazonaws.com/api
✓ VITE_GATEWAY_URL=wss://aethercore-aws-testbed-alb-...amazonaws.com
✓ AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-...amazonaws.com:50051
```

### Docker Configuration
**⚙️ [infra/docker/.env](infra/docker/.env)** (Updated)
```
✓ AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-...amazonaws.com:50051
✓ AWS_REGION=us-east-1
✓ AETHERCORE_PROFILE=aws-testbed
```

---

## 🚀 Quick Start Guide

### Step 1: Verify Everything is Ready
```powershell
./check-aws-connectivity.ps1
# Should show all checks passed
```

### Step 2: Launch Dashboard
```powershell
cd packages/dashboard
pnpm tauri dev
# Tactical Glass opens and connects to AWS
```

### Step 3: Start Backend Services
```powershell
cd infra/docker
docker compose up -d
docker compose logs -f gateway
# Services connect to AWS C2 Router
```

### Step 4: Start Operations
- Dashboard displays live telemetry
- Commands are forwarded to AWS network
- Edge nodes can connect to mesh

---

## 📊 Network Architecture

### Service Endpoints

| Service | Protocol | Endpoint | Port | Purpose |
|---------|----------|----------|------|---------|
| **API** | HTTPS | `/api` | 443 | REST, telemetry, health |
| **Mesh** | WSS | `/` | 443 | Gossip, streaming, trust |
| **C2 Router** | gRPC | `:50051` | 50051 | Commands, revocation |
| **Collaboration** | WSS | `:8080` | 8080 | Real-time mission data |

### Component Roles

```
Tactical Glass (Dashboard)
    ↓ HTTPS/WSS
    ↓
AWS ALB
    ├→ API Gateway (REST)
    ├→ Mesh Link (WSS)
    ├→ C2 Router (gRPC)
    └→ Collaboration (WSS)
    ↓
Backend Services (Docker)
    ├→ Gateway Service
    ├→ Auth Service
    ├→ Fleet Service
    └→ Collaboration Service
```

---

## 🔐 Security Features

### Cryptographic Standards
- ✅ **BLAKE3** - All hashing
- ✅ **Ed25519** - All signatures
- ✅ **TLS 1.3** - All encrypted channels
- ✅ **Merkle Vine** - Tamper-evident history
- ✅ **Byzantine Detection** - Aetheric Sweep

### Fail-Visible Doctrine
- ❌ No graceful degradation on crypto failures
- ✅ Explicit rejection of unverifiable data
- ✅ All operations must be cryptographically certain
- ✅ System halts rather than continues in compromised state

---

## 📋 Files Summary

### New Files (6 total)
```
✓ AWS_TESTBED_SETUP.md              (11.1 KB)  Setup guide
✓ AWS_INTEGRATION_COMPLETE.md       (11.6 KB)  Architecture reference
✓ AWS_QUICK_REFERENCE.md            (4.5 KB)   Quick lookup
✓ AWS_INTEGRATION_STATUS.md         (12.5 KB)  Status & checklist
✓ check-aws-connectivity.ps1        (3.8 KB)   Verification script
✓ config/aws-testbed.yaml           (5.8 KB)   Network config
```

### Modified Files (4 total)
```
✓ packages/dashboard/.env
✓ packages/dashboard/.env.example
✓ infra/docker/.env
✓ infra/docker/.env.example
```

---

## 🔍 Reading Path by Use Case

### I Just Want to Get Started
1. Read: **AWS_QUICK_REFERENCE.md**
2. Run: `./check-aws-connectivity.ps1`
3. Launch: `cd packages/dashboard && pnpm tauri dev`

### I Need Complete Understanding
1. Read: **AWS_INTEGRATION_COMPLETE.md** (architecture)
2. Read: **AWS_TESTBED_SETUP.md** (detailed setup)
3. Reference: **AWS_QUICK_REFERENCE.md** (commands)

### I Need to Troubleshoot
1. Reference: **AWS_QUICK_REFERENCE.md** (fast lookup)
2. Read: **AWS_TESTBED_SETUP.md** (troubleshooting section)
3. Run: `./check-aws-connectivity.ps1 -Verbose`

### I'm Deploying to Production
1. Read: **AWS_INTEGRATION_STATUS.md** (checklist)
2. Review: **config/aws-testbed.yaml** (all settings)
3. Consult: **AGENTS.md** (coding standards)
4. Reference: **SECURITY.md** (security requirements)

---

## ✅ Integration Checklist

### Configuration
- [x] AWS endpoint configured in dashboard
- [x] AWS endpoint configured in Docker services
- [x] AWS testbed YAML profile created
- [x] Environment variables verified

### Documentation
- [x] Setup guide written
- [x] Architecture documented
- [x] Quick reference created
- [x] Integration status summarized

### Tools & Scripts
- [x] Connectivity verification script created and tested
- [x] Network endpoints verified
- [x] Configuration files tested

### Testing
- [x] DNS resolution verified
- [x] Network connectivity checked
- [x] Configuration files validated
- [x] Dashboard endpoints verified

---

## 🎯 Next Steps

### Immediate (Today)
1. Review **AWS_QUICK_REFERENCE.md**
2. Run `./check-aws-connectivity.ps1`
3. Launch dashboard: `pnpm tauri dev`
4. Start services: `docker compose up -d`

### Short Term (This Week)
1. Deploy CodeRalphie edge nodes
2. Configure nodes with C2 Router endpoint
3. Monitor telemetry in dashboard
4. Test command dispatch

### Medium Term (This Month)
1. Scale mesh to multiple nodes
2. Test Byzantine detection (Aetheric Sweep)
3. Integrate with revocation registry
4. Execute field operations

### Long Term (Production)
1. Provision hardware TPM nodes
2. Deploy to contested environments
3. Integrate The Great Gospel
4. Deploy Materia Slot capabilities

---

## 📞 Support Resources

### Documentation
- **AGENTS.md** - Architecture & coding standards
- **ARCHITECTURE.md** - System design & boundaries
- **PROTOCOL_OVERVIEW.md** - Merkle Vine & Trust Mesh
- **SECURITY.md** - Cryptographic requirements
- **CONTRIBUTING.md** - Development workflow

### Tools
- `./check-aws-connectivity.ps1` - Verify connectivity
- `docker compose logs` - Monitor services
- Browser DevTools (F12) - Debug dashboard

### Troubleshooting
1. Check relevant section in **AWS_TESTBED_SETUP.md**
2. Run connectivity verification script
3. Review service logs: `docker compose logs -f`
4. Verify environment variables are correct

---

## 🌐 AWS Details

**Region:** us-east-1  
**ALB Endpoint:** aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com  
**Resolved IP:** 3.90.80.77  
**Profile:** aws-testbed  
**Environment:** testbed (simulated TPM, debug keys allowed)  

---

## 📈 Integration Status

```
Configuration ............ ✅ COMPLETE
Environment Setup ........ ✅ COMPLETE
Documentation ............ ✅ COMPLETE
Network Verification ..... ✅ PASSED
Connectivity Test ........ ✅ PASSED

Status: 🟢 READY FOR OPERATIONS
```

---

## 🚀 You're Ready!

Your AetherCore deployment is now fully integrated with the AWS testbed network.

**Next action:** Launch the dashboard and backend services.

```powershell
# Terminal 1: Dashboard
cd packages/dashboard
pnpm tauri dev

# Terminal 2: Backend Services
cd infra/docker
docker compose up -d
docker compose logs -f gateway
```

---

**Last Updated:** March 3, 2026  
**Integration Status:** COMPLETE  
**System Status:** READY FOR OPERATIONS

Enjoy your AWS-connected AetherCore deployment! 🎯

