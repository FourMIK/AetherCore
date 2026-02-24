# AetherCore Bunker Mode Deployment

**CLOUD_ZERO: Air-Gapped Tactical Operations**

This directory contains deployment artifacts for running the complete AetherCore stack on ruggedized tactical servers (e.g., Dell XR4000, NVIDIA IGX) without internet access.

## 🎯 Mission Objectives

- **Zero Cloud Dependency**: All services run locally in containers
- **Hardware Root of Trust**: TPM 2.0 integration via CodeRalphie
- **High-Velocity Telemetry**: Host networking for UDP throughput
- **Tactical Persistence**: NVMe-backed data stores
- **Self-Contained**: Local S3 (MinIO), observability, and auth

## 📋 Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 16 vCPU | 32 vCPU |
| RAM | 64 GB | 128 GB |
| Storage | 1 TB NVMe SSD | 2 TB NVMe SSD |
| TPM | TPM 2.0 | TPM 2.0 |
| Network | 10 GbE | 25 GbE |

### Required Hardware
- **TPM 2.0** (`/dev/tpm0`) - CodeRalphie hardware root of trust
- **NVMe Storage** - PostgreSQL and high-IOPS workloads
- **USB Radios** (`/dev/ttyUSB*`) - Optional, for RF telemetry ingestion

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Install Docker Engine (20.10+)
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt-get install docker-compose-plugin  # Debian/Ubuntu
# or
yum install docker-compose-plugin      # RHEL/CentOS

# Verify installation
docker --version
docker compose version
```

### 2. Prepare Data Directory

```bash
# Create NVMe mount point (adjust to your NVMe device)
sudo mkdir -p /mnt/nvme/aethercore
sudo chmod 700 /mnt/nvme/aethercore

# Or use default location (less performant)
mkdir -p /opt/aethercore
```

### 3. Bootstrap the Stack

```bash
cd infra/deploy/bunker

# Run genesis bootloader (interactive)
sudo ./init-bunker.sh

# Or specify custom paths
sudo ./init-bunker.sh /mnt/nvme/aethercore .env.bunker
```

The `init-bunker.sh` script will:
1. ✅ Verify TPM and hardware prerequisites
2. 🔐 Generate secrets and configuration
3. 📁 Initialize data directories
4. 🔒 Create self-signed TLS certificates
5. 🗄️ Launch and initialize PostgreSQL
6. 🔄 Run database migrations
7. 🚀 Launch full stack

### 4. Verify Deployment

```bash
# Check all services are running
docker compose -f docker-compose.bunker.yml ps

# View logs
docker compose -f docker-compose.bunker.yml logs -f

# Check specific service
docker compose -f docker-compose.bunker.yml logs -f gateway
```

## 🌐 Access Points

After successful deployment:

| Service | URL | Credentials |
|---------|-----|-------------|
| **Tactical Glass** | https://localhost | See `.env.bunker` |
| **Grafana** | http://localhost:3003 | `admin` / See `.env.bunker` |
| **Prometheus** | http://localhost:9090 | No auth |
| **MinIO Console** | http://localhost:9001 | `aethercore` / See `.env.bunker` |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TACTICAL GLASS (Nginx)                  │
│                    https://localhost:443                     │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │ Gateway │          │  Auth   │          │Collab   │
   │  :3000  │          │  :3001  │          │  :8080  │
   └────┬────┘          └────┬────┘          └────┬────┘
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐          ┌───▼────┐          ┌───▼────┐
   │PostgreSQL│         │ Redis  │          │ MinIO  │
   │   :5432 │          │  :6379 │          │ :9000  │
   └─────────┘          └────────┘          └────────┘
```

### Service Layers

**Glass Layer**
- `nginx`: TLS termination, reverse proxy, static file serving

**Engine Layer**
- `gateway`: API gateway (Node.js)
- `auth`: TPM-backed authentication (Node.js)
- `collaboration`: WebSocket collaboration (Node.js)
- `fleet`: Fleet management (Node.js)
- `h2-ingest`: High-velocity telemetry ingestion (Rust, host network)

**State Layer**
- `postgres`: PostgreSQL 16 (NVMe-backed)
- `redis`: Redis 7 with AOF persistence

**Truth Layer**
- `minio`: S3-compatible Merkle Proof storage

**Observability Layer**
- `prometheus`: Metrics (72h retention)
- `grafana`: Dashboards

## 🔧 Configuration

### Environment Variables

All configuration is in `.env.bunker` (auto-generated by `init-bunker.sh`).

Key variables:
```bash
BUNKER_DATA_PATH=/mnt/nvme/aethercore  # Data directory
POSTGRES_PASSWORD=<generated>           # Database password
JWT_SECRET=<generated>                  # Auth secret
MINIO_ROOT_PASSWORD=<generated>         # S3 password
```

### Custom Configuration

Edit `docker-compose.bunker.yml` to adjust:
- Resource limits (CPU/memory)
- Port mappings
- Volume mounts
- Environment variables

### TLS Certificates

Self-signed certificates are auto-generated. For CA-signed certificates:

```bash
# Replace with your certificates
cp your-cert.crt /mnt/nvme/aethercore/certs/tactical-glass.crt
cp your-key.key /mnt/nvme/aethercore/certs/tactical-glass.key
chmod 600 /mnt/nvme/aethercore/certs/tactical-glass.key

# Restart nginx
docker compose -f docker-compose.bunker.yml restart nginx
```

## 🛠️ Operations

### Start Services

```bash
docker compose -f docker-compose.bunker.yml up -d
```

### Stop Services

```bash
docker compose -f docker-compose.bunker.yml down
```

### Restart Service

```bash
docker compose -f docker-compose.bunker.yml restart <service>
```

### View Logs

```bash
# All services
docker compose -f docker-compose.bunker.yml logs -f

# Specific service
docker compose -f docker-compose.bunker.yml logs -f gateway

# Last 100 lines
docker compose -f docker-compose.bunker.yml logs --tail=100 h2-ingest
```

### Health Checks

```bash
# Service status
docker compose -f docker-compose.bunker.yml ps

# Individual health check
curl -k https://localhost/health
curl http://localhost:3000/health  # Gateway
curl http://localhost:3001/health  # Auth
```

### Database Access

```bash
# Connect to PostgreSQL
docker exec -it aethercore-bunker-postgres psql -U aethercore -d aethercore

# Backup database
docker exec aethercore-bunker-postgres pg_dump -U aethercore aethercore > backup.sql

# Restore database
cat backup.sql | docker exec -i aethercore-bunker-postgres psql -U aethercore aethercore
```

### MinIO Management

```bash
# Access MinIO console
# http://localhost:9001
# User: aethercore
# Password: See .env.bunker

# Create buckets via mc client
docker run --rm --network=host \
  minio/mc alias set bunker http://localhost:9000 aethercore <password>

docker run --rm --network=host \
  minio/mc mb bunker/aethercore-proofs
```

## 📦 Pre-Loading Images (Air-Gap)

If deploying to a system without internet:

```bash
# On internet-connected system, save images
docker save -o aethercore-images.tar \
  postgres:16-alpine \
  redis:7-alpine \
  nginx:1.25-alpine \
  minio/minio:latest \
  prom/prometheus:latest \
  grafana/grafana:latest \
  localhost:5000/aethercore/gateway:latest \
  localhost:5000/aethercore/auth:latest \
  localhost:5000/aethercore/collaboration:latest \
  localhost:5000/aethercore/fleet:latest \
  localhost:5000/aethercore/h2-ingest:latest

# Transfer aethercore-images.tar to tactical system

# On tactical system, load images
docker load -i aethercore-images.tar
```

## 🔐 Security Considerations

### Secrets Management
- **Backup `.env.bunker`** to secure offline storage (encrypted USB)
- Rotate secrets periodically (especially after personnel changes)
- Use hardware-encrypted storage for data directory

### TPM Integration
- Verify TPM ownership before deployment
- Clear TPM if repurposing hardware
- Monitor TPM health via system logs

### Network Isolation
- Deploy on isolated tactical network
- Use firewall rules to restrict access
- Monitor network traffic via Prometheus

### Access Control
- Change default Grafana password immediately
- Restrict SSH access to authorized operators
- Use VPN or bastion host for remote access

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check Docker daemon
systemctl status docker

# Check logs
docker compose -f docker-compose.bunker.yml logs

# Check disk space
df -h

# Check permissions
ls -la /mnt/nvme/aethercore
```

### TPM Not Detected

```bash
# Check TPM device
ls -l /dev/tpm0

# Check TPM status
cat /sys/class/tpm/tpm0/device/enabled
cat /sys/class/tpm/tpm0/device/active

# Install TPM tools
apt-get install tpm2-tools
tpm2_getcap properties-fixed
```

### Database Connection Errors

```bash
# Check PostgreSQL logs
docker compose -f docker-compose.bunker.yml logs postgres

# Verify network
docker network inspect bunker_aethercore-bunker

# Test connection
docker exec aethercore-bunker-postgres pg_isready -U aethercore
```

### High Memory Usage

```bash
# Check resource usage
docker stats

# Adjust limits in docker-compose.bunker.yml
# Restart services
docker compose -f docker-compose.bunker.yml restart
```

## 📚 Additional Resources

- [AetherCore Documentation](../../../docs/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [PostgreSQL Tuning](https://pgtune.leopard.in.ua/)
- [Nginx Performance](https://www.nginx.com/blog/tuning-nginx/)
- [MinIO Administration](https://min.io/docs/minio/linux/operations/operations.html)

## 🚨 Support

For operational issues in tactical environments:

1. Check service logs
2. Verify hardware prerequisites
3. Review security configuration
4. Consult system documentation
5. Contact mission control if issue persists

---

**Security Classification**: UNCLASSIFIED  
**Distribution**: Authorized Personnel Only  
**Last Updated**: 2026-01-03
