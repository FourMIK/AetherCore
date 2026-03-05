# AWS AetherCore Integration - Quick Reference Card

## Network Endpoint
```
https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/
```

## Environment Variables

### Dashboard (`packages/dashboard/.env`)
```env
VITE_API_ENDPOINT=https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api
VITE_GATEWAY_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com
VITE_COLLABORATION_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:8080
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051
AETHERCORE_PROFILE=aws-testbed
AETHERCORE_PRODUCTION=false
TPM_ENABLED=false
```

### Docker Services (`infra/docker/.env`)
```env
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051
AWS_REGION=us-east-1
AETHERCORE_PROFILE=aws-testbed
```

## Quick Commands

| Action | Command |
|--------|---------|
| **Check connectivity** | `.\check-aws-connectivity.ps1` |
| **Start dashboard** | `cd packages/dashboard && pnpm tauri dev` |
| **Start services** | `cd infra/docker && docker compose up -d` |
| **View gateway logs** | `docker compose logs -f gateway` |
| **Stop services** | `docker compose down` |
| **Review setup** | `cat AWS_TESTBED_SETUP.md` |

## Service Endpoints

| Service | URL | Port | Protocol |
|---------|-----|------|----------|
| API Gateway | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api` | 443 | HTTPS |
| Mesh Gossip | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com` | 443 | WSS |
| C2 Router | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051` | 50051 | gRPC |
| Collaboration | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:8080` | 8080 | WSS |

## Data Flow

```
Dashboard (Tactical Glass)
    ↓ HTTPS REST + WSS
    ↓
AWS ALB (API Gateway)
    ↓ gRPC + Protocol buffers
    ↓
Backend Services (Docker)
    ↓ gRPC
    ↓
C2 Router (Aether Bunker)
    ↓
Edge Nodes (CodeRalphie)
    ↓
Mesh Network → Merkle Vine → Trust Mesh
```

## Configuration Files

| File | Purpose |
|------|---------|
| `packages/dashboard/.env` | Dashboard network settings |
| `infra/docker/.env` | Backend service settings |
| `config/aws-testbed.yaml` | Complete AWS profile config |
| `AWS_TESTBED_SETUP.md` | Detailed setup & troubleshooting |
| `check-aws-connectivity.ps1` | Verify connectivity |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Dashboard won't connect | Check firewall allows HTTPS/WSS |
| Services can't reach C2 | Verify `AETHER_BUNKER_ENDPOINT` in `.env` |
| No nodes visible | Check if nodes are streaming telemetry |
| WebSocket errors | Ensure `wss://` not `ws://` |
| Port 50051 unreachable | May need VPC/network config |
| Port 8080 unreachable | May need VPC/network config |

## Security Model

✅ **BLAKE3** - All hashing  
✅ **Ed25519** - All signatures  
✅ **TLS 1.3** - All encrypted channels  
✅ **Merkle Vine** - Tamper-evident history  
✅ **Byzantine Detection** - Aetheric Sweep  
✅ **Fail-Visible** - Explicit error handling  

## Test Configuration

Use connectivity check to verify:
```powershell
./check-aws-connectivity.ps1 -Verbose
```

Expected results:
- DNS resolution: ✅
- Port 443 (HTTPS/WSS): ✅
- Configuration files: ✅
- Dashboard config: ✅

## Environment Switching

**To local (Docker only):**
```env
VITE_API_ENDPOINT=http://localhost:3000
VITE_GATEWAY_URL=ws://localhost:3000
AETHER_BUNKER_ENDPOINT=localhost:50051
```

**Back to AWS:**
Use current `.env` files.

## Important Notes

- 🔒 All communication is TLS 1.3 encrypted
- 🔐 No unverified data allowed (Fail-Visible)
- 📊 All telemetry goes through Merkle Vine
- 🚫 No graceful degradation on crypto failures
- ⚡ Bitcoin-style Byzantine detection enabled

## AWS Region
- **Region:** us-east-1
- **ALB DNS:** aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com
- **IP:** 3.90.80.77

## Documentation

- **Setup Guide:** `AWS_TESTBED_SETUP.md`
- **Integration Summary:** `AWS_INTEGRATION_COMPLETE.md`
- **Architecture:** `ARCHITECTURE.md`
- **Coding Standards:** `AGENTS.md`
- **Security:** `SECURITY.md`

---

**Status:** ✅ Integration Complete  
**Ready to launch:** `pnpm tauri dev` (dashboard) + `docker compose up -d` (services)

