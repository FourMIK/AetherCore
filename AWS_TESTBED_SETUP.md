# AWS AetherCore Testbed Network Integration Guide

**Last Updated:** March 3, 2026  
**Network:** AWS AetherCore Testbed  
**Endpoint:** `https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/`  
**Region:** `us-east-1`  

---

## Overview

Your AetherCore deployment is now hooked up to the AWS-hosted testbed network. This document provides instructions for connecting the Tactical Glass dashboard and backend services.

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│             AWS AetherCore Testbed Network                  │
│                                                             │
│  ALB: aethercore-aws-testbed-alb-1408772759.us-east-1...  │
│                                                             │
│  ├── API Gateway (HTTP/HTTPS)      :443                    │
│  ├── WebSocket Mesh (WSS)          :443                    │
│  ├── Collaboration (WSS)           :8080                   │
│  └── C2 Router (gRPC)              :50051                  │
└─────────────────────────────────────────────────────────────┘
        ↑                                      ↑
        │ Dashboard Connection             │ Service Connection
        │                                      │
   ┌─────────┐                          ┌──────────────┐
   │Tactical │ (Tauri+React)            │Backend Stack │
   │  Glass  │                          │ (Docker)     │
   └─────────┘                          └──────────────┘
```

---

## Quick Start

### 1. Dashboard Setup (Tactical Glass)

The dashboard is pre-configured to connect to the AWS testbed. Simply start the app:

```powershell
cd packages/dashboard
pnpm tauri dev
```

**Environment File:** `packages/dashboard/.env`

Current Configuration:
```dotenv
VITE_API_ENDPOINT=https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api
VITE_GATEWAY_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com
VITE_COLLABORATION_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:8080
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051
AETHERCORE_PROFILE=aws-testbed
```

### 2. Backend Services Setup (Docker)

Backend services are configured to forward commands and telemetry to the AWS network.

```powershell
cd infra/docker
# Services will automatically use AETHER_BUNKER_ENDPOINT from .env
docker compose up -d
docker compose logs -f gateway
```

**Environment File:** `infra/docker/.env`

Current Configuration:
```dotenv
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051
AWS_REGION=us-east-1
AETHERCORE_PROFILE=aws-testbed
```

### 3. Verify Connectivity

#### Dashboard Verification

1. Open Tactical Glass (desktop app)
2. Check the status bar for network connectivity indicator
3. You should see nodes from the AWS testbed appearing in the mesh view

#### Gateway Service Verification

```powershell
# Check gateway logs
docker compose logs gateway | grep -E "c2_target|bunker_endpoint"

# Expected output should show AWS endpoint configuration
```

#### Direct Endpoint Tests

```powershell
# Test API Gateway
curl -k https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api/health

# Test WebSocket connectivity (requires wscat or similar)
wscat -c wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com
```

---

## Configuration Files

### New Files Created

1. **`config/aws-testbed.yaml`** - Complete AWS testbed configuration
   - Network endpoints
   - TPM settings (simulated mode for testbed)
   - Security policies (Fail-Visible enabled)
   - Merkle Vine, Trust Mesh, Byzantine detection settings

2. **Updated Files**
   - `packages/dashboard/.env` - Dashboard endpoints
   - `packages/dashboard/.env.example` - Example configuration
   - `infra/docker/.env` - Docker service endpoints
   - `infra/docker/.env.example` - Docker example configuration

---

## Network Endpoints Reference

| Service | Endpoint | Protocol | Purpose |
|---------|----------|----------|---------|
| **API Gateway** | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api` | HTTPS | REST API, Node telemetry |
| **Mesh Link** | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com` | WSS | Aetheric mesh gossip, telemetry streaming |
| **Collaboration** | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:8080` | WSS | Mission Guardian, real-time collab |
| **C2 Router** | `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051` | gRPC | Command & Control, CodeRalphie routing |

---

## Switching Between Local & AWS

### Switch to Local Development

If you want to switch back to local Docker services:

**Dashboard (`packages/dashboard/.env`):**
```dotenv
VITE_API_ENDPOINT=http://localhost:3000
VITE_GATEWAY_URL=ws://localhost:3000
VITE_COLLABORATION_URL=ws://localhost:8080
AETHER_BUNKER_ENDPOINT=localhost:50051
```

**Docker (`infra/docker/.env`):**
```dotenv
AETHER_BUNKER_ENDPOINT=c2-router:50051  # Docker service DNS
```

### Switch Back to AWS

Simply revert to the values in this guide or use the provided configuration files.

---

## Fail-Visible Security Model

All network operations follow the **Fail-Visible doctrine**:

- ❌ **No graceful degradation** on crypto failures
- ✅ **Explicit rejection** of unverifiable data
- ✅ **BLAKE3** hashing for all integrity checks
- ✅ **Ed25519** signatures (TPM-backed in production)
- ✅ **TLS 1.3** only for all encrypted channels

If a signature cannot be verified or a Merkle chain is broken, the node halts rather than operating in a compromised state.

---

## Merkle Vine Streaming

All telemetry from edge nodes flows through the Merkle Vine:

```
Node Telemetry → Ancestor Hash Check → Stream Integrity Tracker → Vault (Historical Anchor)
```

This ensures:
- **Tamper-evident** event chains (cannot inject retroactively)
- **Historical audit trail** of all operations
- **Byzantine detection** via trust score gossip

---

## Troubleshooting

### Dashboard Cannot Connect to AWS

**Symptom:** Dashboard shows "Connection Failed" or "Waiting for Network"

**Fix:**
1. Verify internet connectivity
2. Check firewall rules allow HTTPS/WSS to AWS ALB
3. Verify ALB endpoint DNS resolution:
   ```powershell
   nslookup aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com
   ```
4. Check dashboard logs (DevTools → Console in Tauri window)

### Gateway Cannot Reach C2 Router

**Symptom:** Gateway logs show: `Failed to reach C2 Router` or `gRPC connection refused`

**Fix:**
1. Verify `AETHER_BUNKER_ENDPOINT` in `infra/docker/.env`
2. Check gateway logs:
   ```powershell
   docker compose logs gateway | tail -50
   ```
3. Verify AWS ALB is reachable from your network
4. Check if firewall blocks port 50051 to AWS

### WebSocket Connection Fails

**Symptom:** Dashboard shows WebSocket errors in console

**Fix:**
1. Verify WSS endpoint is not being downgraded to WS
2. Check browser console (F12) for CORS/SSL errors
3. Ensure VITE_GATEWAY_URL uses `wss://` (not `ws://`)

### Telemetry Not Appearing

**Symptom:** Dashboard shows "No nodes available"

**Fix:**
1. Check if edge nodes are streaming telemetry to gateway
2. Verify gateway `/api/nodes` endpoint responds:
   ```powershell
   curl -k https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api/health
   ```
3. Check telemetry schema validation in gateway logs

---

## Environment Variables Reference

### Dashboard (`packages/dashboard/.env`)

```dotenv
# API endpoint for REST calls
VITE_API_ENDPOINT=https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api

# WebSocket for mesh connection
VITE_GATEWAY_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com

# Collaboration WebSocket
VITE_COLLABORATION_URL=wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:8080

# Backend C2 Router endpoint
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051

# Network profile
AETHERCORE_PROFILE=aws-testbed

# Production mode (requires hardware TPM)
AETHERCORE_PRODUCTION=false

# Allow insecure localhost (false for AWS)
VITE_DEV_ALLOW_INSECURE_LOCALHOST=false

# TPM enforcement
TPM_ENABLED=false
```

### Docker (`infra/docker/.env`)

```dotenv
# C2 Router endpoint (AWS or local)
AETHER_BUNKER_ENDPOINT=aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051

# AWS configuration
AWS_REGION=us-east-1
AETHERCORE_PROFILE=aws-testbed

# Standard ports (can be customized)
C2_ROUTER_PORT=50051
GATEWAY_PORT=3000
AUTH_PORT=3001
COLLABORATION_PORT=8080

# Database
POSTGRES_DB=aethercore
POSTGRES_USER=aethercore
POSTGRES_PASSWORD=aethercore_dev_password

# Environment
NODE_ENV=development
LOG_LEVEL=debug
```

---

## Next Steps

1. **Start the Dashboard:**
   ```powershell
   cd packages/dashboard
   pnpm tauri dev
   ```

2. **Start Backend Services:**
   ```powershell
   cd infra/docker
   docker compose up -d
   ```

3. **Monitor Connectivity:**
   - Watch dashboard for node appearances
   - Check gateway logs for telemetry ingestion
   - Monitor revocation registry syncs

4. **Field Operations:**
   - Deploy edge nodes (CodeRalphie) to mesh
   - Verify Merkle Vine chain integrity
   - Monitor Aetheric Sweep for Byzantine detection

---

## Documentation References

- **AGENTS.md** - Architecture and coding standards
- **ARCHITECTURE.md** - System boundaries and data flow
- **PROTOCOL_OVERVIEW.md** - Merkle Vine and Trust Mesh
- **SECURITY.md** - Cryptographic standards
- **config/aws-testbed.yaml** - Complete configuration reference

---

## Support

For issues or questions regarding AWS integration:

1. Check `infra/docker/README.md` for Docker troubleshooting
2. Review gateway logs: `docker compose logs gateway -f`
3. Check dashboard DevTools console (F12 in Tauri window)
4. Verify network connectivity to AWS endpoints
5. Ensure firewall rules allow HTTPS/WSS traffic

**Remember:** This is not a web app. Every operation is cryptographically verified. If something fails, the system will halt rather than degrade gracefully. Check logs for explicit error messages indicating the failure point.

