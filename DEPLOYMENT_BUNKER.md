# CLOUD_ZERO Deployment Guide

**Mission Critical: Air-Gapped Tactical Operations**

This guide covers deploying AetherCore in bunker mode (air-gapped, on-premises) for tactical servers without cloud dependencies.

---

## 🎯 Deployment Options

AetherCore supports two bunker deployment modes:

| Mode | Use Case | Complexity | Scalability |
|------|----------|------------|-------------|
| **Docker Compose** | Single tactical server | Low | Single node |
| **Kubernetes** | Multi-node tactical cluster | Medium | Multi-node |

**Quick Decision:**
- **Single Server** (Dell XR4000, NVIDIA IGX): Use **Docker Compose**
- **Cluster** (3+ nodes): Use **Kubernetes** (K3s/RKE2)

---

## 🚀 Option 1: Docker Compose (Recommended for Single Server)

### Prerequisites

- Docker Engine 20.10+
- Docker Compose plugin
- 64GB RAM minimum
- 16 vCPU minimum
- 1TB NVMe storage
- TPM 2.0 (optional but recommended)

### Quick Start

```bash
# Clone repository (or transfer via USB in air-gap)
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# Navigate to bunker deployment
cd infra/deploy/bunker

# Run genesis bootloader (interactive)
sudo ./init-bunker.sh

# Or specify custom data path
sudo ./init-bunker.sh /mnt/nvme/aethercore .env.bunker
```

The `init-bunker.sh` script will:
1. ✅ Verify hardware (TPM, NVMe, radios)
2. 🔐 Generate secrets and certificates
3. 📁 Initialize data directories
4. 🗄️ Launch PostgreSQL and run migrations
5. 🚀 Start the full stack

### Access Points

After deployment:

```bash
# Tactical Glass Dashboard
https://localhost

# Grafana (Observability)
http://localhost:3003

# Prometheus (Metrics)
http://localhost:9090

# MinIO Console (S3)
http://localhost:9001
```

Credentials are in `.env.bunker` (generated during initialization).

### Management

```bash
# View all services
docker compose -f docker-compose.bunker.yml ps

# View logs
docker compose -f docker-compose.bunker.yml logs -f

# Restart service
docker compose -f docker-compose.bunker.yml restart gateway

# Stop all
docker compose -f docker-compose.bunker.yml down

# Start all
docker compose -f docker-compose.bunker.yml up -d
```

### Full Documentation

See [infra/deploy/bunker/README.md](./infra/deploy/bunker/README.md) for complete documentation including:
- Pre-loading images for air-gap
- Database backups and restore
- Security hardening
- Troubleshooting

---

## 🏗️ Option 2: Kubernetes (For Multi-Node Clusters)

### Prerequisites

- Kubernetes 1.24+ (K3s, RKE2, or standard)
- kubectl + kustomize
- 64GB RAM per node
- 16 vCPU per node
- NVMe storage
- TPM 2.0 on each node

### Quick Start

```bash
# Install K3s (lightweight Kubernetes)
curl -sfL https://get.k3s.io | sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Navigate to K8s overlay
cd infra/k8s/overlays/bunker

# Generate secrets
cp secrets.env.example secrets.env
# Edit secrets.env with secure values

# Create TLS certificates
kubectl create secret tls tactical-glass-tls \
  --cert=/path/to/cert.crt \
  --key=/path/to/key.key \
  --namespace=aethercore

# Deploy stack
kustomize build . | kubectl apply -f -

# Watch deployment
kubectl get pods -n aethercore -w
```

### Access Points

```bash
# Get node IP
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

# Access via NodePort
echo "Tactical Glass: https://${NODE_IP}:30443"
echo "Grafana: http://${NODE_IP}:30300"
```

### Management

```bash
# View pods
kubectl get pods -n aethercore

# View logs
kubectl logs -n aethercore -l app=gateway -f

# Scale services
kubectl scale deployment gateway -n aethercore --replicas=4

# Update deployment
kustomize build . | kubectl apply -f -
```

### Full Documentation

See [infra/k8s/overlays/bunker/README.md](./infra/k8s/overlays/bunker/README.md) for complete documentation including:
- K3s vs RKE2 selection
- Multi-node configuration
- Storage provisioning
- Ingress setup
- Advanced operations

---

## 🔐 Security Considerations

### Secrets Management

**Docker Compose:**
- Secrets stored in `.env.bunker` (generated, 600 permissions)
- Back up to encrypted USB drive
- Rotate secrets every 90 days

**Kubernetes:**
- Use `sealed-secrets` for production
- Or external secret operators (Vault)
- Never commit secrets to git

### TPM Integration

Both deployment modes support TPM 2.0:

```bash
# Verify TPM presence
ls -l /dev/tpm0

# Check TPM info
tpm2_getcap properties-fixed
```

TPM provides:
- Hardware root of trust (CodeRalphie)
- Ed25519 signing without keys in memory
- Sealed storage for sensitive data

### Network Isolation

```bash
# Configure firewall (example for Docker)
ufw allow 443/tcp   # HTTPS (Tactical Glass)
ufw allow 3003/tcp  # Grafana
ufw deny 5432/tcp   # PostgreSQL (internal only)
ufw deny 6379/tcp   # Redis (internal only)
```

---

## 📦 Air-Gap Image Transfer

Both deployment modes support air-gapped operation.

### 1. On Internet-Connected System

```bash
# Pull all required images
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:1.25-alpine
docker pull minio/minio:latest
docker pull prom/prometheus:latest
docker pull grafana/grafana:latest

# Build AetherCore images
docker build -t localhost:5000/aethercore/gateway:latest -f infra/docker/Dockerfile.gateway .
docker build -t localhost:5000/aethercore/auth:latest -f infra/docker/Dockerfile.auth .
docker build -t localhost:5000/aethercore/collaboration:latest -f infra/docker/Dockerfile.collaboration .
# ... (build other services)

# Save to tar
docker save -o aethercore-images.tar \
  postgres:16-alpine \
  redis:7-alpine \
  nginx:1.25-alpine \
  minio/minio:latest \
  prom/prometheus:latest \
  grafana/grafana:latest \
  localhost:5000/aethercore/gateway:latest \
  localhost:5000/aethercore/auth:latest \
  localhost:5000/aethercore/collaboration:latest
  # ... (other services)
```

### 2. Transfer to Tactical Server

```bash
# Copy via USB or secure transfer
# aethercore-images.tar -> /tmp/

# On tactical server
docker load -i /tmp/aethercore-images.tar

# Verify
docker images | grep aethercore
```

### 3. Local Registry (Optional, for Kubernetes)

```bash
# Start local registry
docker run -d -p 5000:5000 --restart=always --name registry registry:2

# Tag and push images
for img in gateway auth collaboration fleet h2-ingest; do
  docker tag localhost:5000/aethercore/${img}:latest localhost:5000/aethercore/${img}:latest
  docker push localhost:5000/aethercore/${img}:latest
done
```

---

## 🗄️ Database Operations

### Backups

**Docker Compose:**
```bash
# Backup PostgreSQL
docker exec aethercore-bunker-postgres pg_dump -U aethercore aethercore > backup-$(date +%Y%m%d).sql

# Backup to mounted volume
docker exec aethercore-bunker-postgres pg_dump -U aethercore aethercore > /backup/backup-$(date +%Y%m%d).sql
```

**Kubernetes:**
```bash
# Backup PostgreSQL
kubectl exec -n aethercore postgres-0 -- pg_dump -U aethercore aethercore > backup-$(date +%Y%m%d).sql
```

### Restore

**Docker Compose:**
```bash
cat backup.sql | docker exec -i aethercore-bunker-postgres psql -U aethercore aethercore
```

**Kubernetes:**
```bash
cat backup.sql | kubectl exec -i -n aethercore postgres-0 -- psql -U aethercore aethercore
```

---

## 📊 Monitoring

### Metrics (Prometheus)

**Docker Compose:** http://localhost:9090  
**Kubernetes:** Port-forward or NodePort

```bash
# Kubernetes port-forward
kubectl port-forward -n aethercore svc/prometheus 9090:9090
```

### Dashboards (Grafana)

**Docker Compose:** http://localhost:3003  
**Kubernetes:** http://<NODE_IP>:30300

Default credentials:
- User: `admin`
- Password: See `.env.bunker` or secrets

### Logs

**Docker Compose:**
```bash
# All services
docker compose -f docker-compose.bunker.yml logs -f

# Specific service
docker compose -f docker-compose.bunker.yml logs -f h2-ingest
```

**Kubernetes:**
```bash
# All pods
kubectl logs -n aethercore -l layer=engine -f

# Specific pod
kubectl logs -n aethercore gateway-xxx-yyy -f
```

---

## 🐛 Troubleshooting

### Service Won't Start

**Check Logs:**
```bash
# Docker
docker compose -f docker-compose.bunker.yml logs <service>

# Kubernetes
kubectl describe pod <pod> -n aethercore
kubectl logs <pod> -n aethercore
```

**Check Resources:**
```bash
# Docker
docker stats

# Kubernetes
kubectl top nodes
kubectl top pods -n aethercore
```

### Database Connection Issues

**Test Connectivity:**
```bash
# Docker
docker exec aethercore-bunker-postgres pg_isready -U aethercore

# Kubernetes
kubectl exec -n aethercore postgres-0 -- pg_isready -U aethercore
```

### TPM Issues

```bash
# Check TPM device
ls -l /dev/tpm0

# Check permissions
sudo chmod 666 /dev/tpm0  # Temporary fix
sudo usermod -a -G tss $USER  # Permanent fix

# Verify TPM functionality
tpm2_getcap properties-fixed
```

---

## 🔄 Upgrades

### Docker Compose

```bash
# Pull new images (if connected)
docker compose -f docker-compose.bunker.yml pull

# Or load from tar (air-gap)
docker load -i aethercore-images-new.tar

# Restart with new images
docker compose -f docker-compose.bunker.yml up -d

# Rollback if needed
docker compose -f docker-compose.bunker.yml down
docker compose -f docker-compose.bunker.yml up -d
```

### Kubernetes

```bash
# Update manifests
cd infra/k8s/overlays/bunker

# Apply changes
kustomize build . | kubectl apply -f -

# Monitor rollout
kubectl rollout status deployment/gateway -n aethercore

# Rollback if needed
kubectl rollout undo deployment/gateway -n aethercore
```

---

## 📞 Support

For tactical deployment support:

1. **Check Logs** - Most issues are logged
2. **Review Documentation** - Detailed docs in deployment directories
3. **Hardware Verification** - Ensure TPM, NVMe, radios are accessible
4. **Resource Allocation** - Verify CPU/RAM/disk availability
5. **Network Connectivity** - Check internal network between services

---

## 📚 Additional Documentation

- **Docker Compose**: [infra/deploy/bunker/README.md](./infra/deploy/bunker/README.md)
- **Kubernetes**: [infra/k8s/overlays/bunker/README.md](./infra/k8s/overlays/bunker/README.md)
- **Architecture**: [docs/architecture/](./docs/)
- **Security**: [SECURITY.md](./SECURITY.md)

---

**Mission Status: OPERATIONAL**

**Security Classification**: UNCLASSIFIED  
**Distribution**: Authorized Personnel Only  
**Last Updated**: 2026-01-03
