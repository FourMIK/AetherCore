# OPERATION SOVEREIGN GENESIS - Deployment Guide

**Classification:** OPERATIONAL  
**Doctrine:** "Truth as a Weapon"  
**Philosophy:** "Fail-Visible"  
**Status:** TRL-9 Production Ready

## Overview

This guide documents the deployment of AetherCore platform and CodeRalphie edge nodes in production configuration, transitioning from TRL-6 simulation to TRL-9 operational state.

## Security Posture

### Core Principles
1. **Hardware-Rooted Trust**: All cryptographic operations backed by TPM 2.0
2. **Fail-Visible Design**: Unverified data is flagged/rejected, never hidden
3. **BLAKE3 Hashing**: Exclusive hash algorithm, SHA-256 deprecated
4. **Ed25519 Signing**: TPM-backed signatures, private keys never in memory
5. **Merkle Vine Structure**: Every event contains hash of ancestor

### Configuration Requirements
- Production configuration: `config/production.yaml`
- TPM hardware mode enforced via `AETHERCORE_PRODUCTION=1`
- Secure boot with strict mode enabled
- TLS 1.3 minimum for all authenticated pathways
- WebSocket Secure (WSS) required for C2 connections

## Prerequisites

### Hardware Requirements
- **AetherCore Bunker Server:**
  - 64GB RAM minimum
  - 16 vCPU minimum  
  - NVMe storage for PostgreSQL
  - Network: 10GbE recommended

- **CodeRalphie Edge Nodes:**
  - TPM 2.0 chip (/dev/tpm0)
  - Secure Boot capable
  - ARM64 or x86_64 processor
  - Minimum 4GB RAM

### Software Requirements
- Docker 24.0+
- Docker Compose 2.20+
- Rust 1.75+ (for building CodeRalphie)
- Node.js 20+ (for building Tactical Glass)

## Phase 1: AetherCore Bunker Deployment

### Step 1: Prepare Environment

```bash
# Set production mode
export AETHERCORE_PRODUCTION=1

# Create data directories
sudo mkdir -p /mnt/nvme/aethercore/{postgres,redis,minio,grafana,prometheus}
sudo mkdir -p /var/log/aethercore

# Set permissions
sudo chown -R $USER:$USER /mnt/nvme/aethercore
sudo chown -R $USER:$USER /var/log/aethercore

# Verify TPM availability (if bunker has TPM)
ls -l /dev/tpm0
```

### Step 2: Configure Secrets

Create `.env` file in `infra/deploy/bunker/`:

```bash
cd /home/runner/work/AetherCore/AetherCore/infra/deploy/bunker

cat > .env << 'EOF'
# Database
POSTGRES_PASSWORD=<GENERATE_STRONG_PASSWORD>
POSTGRES_USER=aethercore
POSTGRES_DB=aethercore

# MinIO (S3-compatible storage)
MINIO_ROOT_USER=aethercore
MINIO_ROOT_PASSWORD=<GENERATE_STRONG_PASSWORD>

# JWT Authentication
JWT_SECRET=<GENERATE_STRONG_SECRET>

# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<GENERATE_STRONG_PASSWORD>

# Rust logging
RUST_LOG=info,aethercore=debug

# Bunker paths
BUNKER_DATA_PATH=/mnt/nvme/aethercore
DASHBOARD_BUILD_PATH=../../../packages/dashboard/dist

# Container registry (if using local)
REGISTRY=localhost:5000
VERSION=latest
EOF

# Secure the file
chmod 600 .env
```

### Step 3: Build Services

```bash
# Build Rust services (h2-ingest, identity, etc.)
cd /home/runner/work/AetherCore/AetherCore
cargo build --release --features hardware-tpm

# Build Dashboard (Tactical Glass)
cd packages/dashboard
npm install
npm run build

# Build service containers (if not using pre-built images)
cd /home/runner/work/AetherCore/AetherCore
docker-compose -f infra/docker/docker-compose.yml build
```

### Step 4: Deploy Bunker Stack

```bash
cd /home/runner/work/AetherCore/AetherCore/infra/deploy/bunker

# Start the stack
docker-compose -f docker-compose.bunker.yml up -d

# Verify services
docker-compose -f docker-compose.bunker.yml ps

# Check logs
docker-compose -f docker-compose.bunker.yml logs -f gateway
docker-compose -f docker-compose.bunker.yml logs -f h2-ingest
docker-compose -f docker-compose.bunker.yml logs -f auth
```

### Step 5: Initialize Database Schema

```bash
# Run migrations (if applicable)
docker-compose -f docker-compose.bunker.yml exec gateway npm run migrate

# Verify database
docker-compose -f docker-compose.bunker.yml exec postgres \
  psql -U aethercore -d aethercore -c "\dt"
```

## Phase 2: CodeRalphie Edge Node Deployment

### Step 1: Build CodeRalphie

```bash
cd /home/runner/work/AetherCore/AetherCore

# For ARM64 (e.g., Raspberry Pi, NVIDIA Jetson)
cargo build --release --target aarch64-unknown-linux-gnu --features hardware-tpm

# For x86_64
cargo build --release --target x86_64-unknown-linux-gnu --features hardware-tpm

# Package binary
mkdir -p dist/coderalphie
cp target/release/coderalphie dist/coderalphie/
cp config/production.yaml dist/coderalphie/config.yaml
```

### Step 2: Deploy to Edge Node

```bash
# Copy to edge node
scp -r dist/coderalphie/ operator@edge-node:/opt/aethercore/

# SSH to edge node
ssh operator@edge-node

# On edge node:
cd /opt/aethercore/coderalphie

# Verify TPM
ls -l /dev/tpm0
tpm2_getcap properties-fixed

# Set production mode
export AETHERCORE_PRODUCTION=1

# Run CodeRalphie
./coderalphie --config config.yaml
```

### Step 3: Verify TPM Attestation

```bash
# On edge node, verify TPM attestation is working
./coderalphie attest --config config.yaml

# Expected output:
# [INFO] TPM hardware detected and enabled
# [INFO] Generated attestation quote with PCRs: [0, 1, 2, 3, 4, 7, 8, 14]
# [INFO] Quote signature: <hex-encoded-signature>
```

## Phase 3: Validation (The Aetheric Sweep)

### Test 1: Node Connection & Attestation

```bash
# On Tactical Glass dashboard:
# 1. Open browser to https://localhost or configured nginx endpoint
# 2. Navigate to "Mesh Connection" tab
# 3. Enter C2 endpoint: wss://c2.aethercore.local:8443
# 4. Click "Connect to C2 Mesh"

# Expected behavior:
# - Status changes to "🟡 Connecting & Attesting..."
# - TPM attestation completes
# - Status changes to "🟢 Connected & Verified"
# - Node appears on tactical map with GREEN indicator

# Check logs:
docker-compose -f docker-compose.bunker.yml logs collaboration | grep attestation
```

### Test 2: Fail-Visible Mode Verification

```bash
# Simulate integrity compromise on edge node:
# Stop streaming valid data or tamper with stream

# Expected behavior in Tactical Glass:
# - Node status changes to "⚠️ UNVERIFIED"
# - Security event logged
# - Visual warning overlay appears
# - If configured, stream fractures or shows "LINK COMPROMISED" banner

# Check security events:
docker-compose -f docker-compose.bunker.yml exec postgres \
  psql -U aethercore -d aethercore \
  -c "SELECT * FROM security_events ORDER BY timestamp DESC LIMIT 10;"
```

### Test 3: Byzantine Node Detection (Aetheric Sweep)

```bash
# Simulate Byzantine behavior:
# 1. Send telemetry with invalid signature
# 2. Send data with broken Merkle Vine chain

# Expected behavior:
# - Node immediately flagged as "BYZANTINE_DETECTED"
# - Node purged from mesh (if byzantine_sweep_enabled: true)
# - Security event emitted
# - Dashboard shows alert: "❌ ATTESTATION FAILED - BYZANTINE NODE"

# Verify sweep action:
docker-compose -f docker-compose.bunker.yml logs h2-ingest | grep byzantine
```

## Phase 4: Production Operations

### Monitoring

Access Grafana dashboard:
```
http://localhost:3003
Login: admin / <GRAFANA_ADMIN_PASSWORD>
```

Key metrics to monitor:
- TPM attestation success rate
- Stream integrity violation rate
- Byzantine node detection rate
- WebSocket connection health
- Database performance

### Log Aggregation

```bash
# View all service logs
docker-compose -f docker-compose.bunker.yml logs -f

# View audit logs
tail -f /var/log/aethercore/audit.log

# Filter security events
docker-compose -f docker-compose.bunker.yml logs | grep SecurityEvent
```

### Backup Strategy

```bash
# PostgreSQL backup
docker-compose -f docker-compose.bunker.yml exec postgres \
  pg_dump -U aethercore aethercore > /backup/aethercore_$(date +%Y%m%d).sql

# MinIO backup (Merkle proofs)
mc mirror aethercore-minio/aethercore-proofs /backup/minio/

# Redis backup (if needed)
docker-compose -f docker-compose.bunker.yml exec redis \
  redis-cli --rdb /data/dump_$(date +%Y%m%d).rdb
```

### Update Procedures

```bash
# Update AetherCore services
cd /home/runner/work/AetherCore/AetherCore
git pull
cargo build --release --features hardware-tpm
docker-compose -f infra/deploy/bunker/docker-compose.bunker.yml build
docker-compose -f infra/deploy/bunker/docker-compose.bunker.yml up -d

# Update CodeRalphie nodes
# Build new binary, SCP to nodes, restart service
```

## Security Verification Checklist

- [ ] TPM hardware mode enforced (AETHERCORE_PRODUCTION=1)
- [ ] All connections use TLS 1.3 / WSS
- [ ] Mock providers removed from dashboard
- [ ] Stub implementations panic in production mode
- [ ] BLAKE3 hashing enforced for all integrity checks
- [ ] Ed25519 signatures with TPM backing
- [ ] Attestation gate enabled in identity service
- [ ] Merkle Vine chain validation active
- [ ] Fail-visible mode enabled in dashboard
- [ ] Byzantine sweep enabled
- [ ] Audit logging configured and active
- [ ] Secrets secured with proper permissions
- [ ] Database backups automated
- [ ] Monitoring and alerting configured

## Troubleshooting

### TPM Not Available

```bash
# Check TPM status
ls -l /dev/tpm0
dmesg | grep -i tpm

# If missing, check BIOS/UEFI settings
# Enable TPM 2.0 (not TPM 1.2)
# Enable Secure Boot if required
```

### Attestation Failures

```bash
# Check PCR values
tpm2_pcrread

# Verify EK certificate
tpm2_getekcertificate -o ek.crt

# Check logs
docker-compose -f docker-compose.bunker.yml logs identity | grep attestation
```

### Connection Issues

```bash
# Verify network connectivity
nc -zv c2.aethercore.local 8443

# Check TLS certificate
openssl s_client -connect c2.aethercore.local:8443

# Verify WebSocket is working
websocat wss://c2.aethercore.local:8443
```

## Support Contacts

For operational issues or security incidents, contact:
- System Architecture: <architect@example.com>
- Security Operations: <security@example.com>
- Infrastructure: <ops@example.com>

## Appendix A: Production Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AETHERCORE_PRODUCTION` | Yes | Set to "1" or "true" to enforce production mode |
| `RUST_LOG` | No | Logging level (default: info) |
| `TPM_DEVICE` | Yes | TPM device path (default: /dev/tpm0) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `S3_ENDPOINT` | Yes | MinIO/S3 endpoint |
| `VITE_C2_ENDPOINT` | Yes | Dashboard C2 WebSocket endpoint |

## Appendix B: File Structure

```
AetherCore/
├── config/
│   └── production.yaml          # Production configuration
├── crates/
│   ├── identity/
│   │   └── src/
│   │       ├── tpm.rs           # TPM with production guards
│   │       └── attestation.rs   # Attestation protocol
│   └── stream/
│       └── src/
│           └── integrity.rs     # Merkle Vine validation
├── packages/
│   └── dashboard/
│       └── src/
│           ├── App.tsx          # Production mesh connection
│           └── store/
│               └── useTacticalStore.ts  # State management
└── infra/
    └── deploy/
        └── bunker/
            └── docker-compose.bunker.yml  # Bunker deployment
```

## Change Log

- **2026-01-25**: Initial production deployment guide
- **Phase 1**: AetherCore sanitization complete
- **Phase 2**: CodeRalphie hardening complete
- **Phase 3**: Silicon Handshake verification procedures added
- **Phase 4**: Validation and operational procedures documented
