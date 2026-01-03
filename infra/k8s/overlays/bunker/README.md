# AetherCore Kubernetes Bunker Mode

**CLOUD_ZERO: Kubernetes Bare-Metal Deployment**

This overlay provides Kubernetes manifests for deploying AetherCore on bare-metal tactical servers using K3s, RKE2, or standard Kubernetes.

## 🎯 Overview

This deployment configuration:
- Uses **local-path** storage instead of cloud EBS/PV
- Deploys **NodePort** services instead of LoadBalancers
- Optimized for **64GB RAM / 16 vCPU** nodes
- Configures **Prometheus** with 72h retention
- Supports **local container registry** (localhost:5000)
- Enables **TPM access** for CodeRalphie hardware root of trust

## 📋 Prerequisites

### Kubernetes Distribution

Choose one:

**K3s (Recommended for edge/tactical)**
```bash
# Install K3s
curl -sfL https://get.k3s.io | sh -

# Access cluster
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes
```

**RKE2 (For high-security environments)**
```bash
# Install RKE2
curl -sfL https://get.rke2.io | sh -
systemctl enable rke2-server
systemctl start rke2-server

# Access cluster
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
kubectl get nodes
```

**Standard Kubernetes**
```bash
# Use kubeadm, microk8s, or other distribution
# Ensure version 1.24+
kubectl version
```

### Required Tools

```bash
# Kustomize (v4.0+)
curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
sudo mv kustomize /usr/local/bin/

# Kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Helm (optional, for Traefik ingress)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Storage Configuration

```bash
# Install local-path-provisioner (if not using K3s)
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml

# Prepare NVMe mount
sudo mkdir -p /mnt/nvme/aethercore/k8s-volumes
sudo chmod 700 /mnt/nvme/aethercore
```

### Ingress Controller

```bash
# Install Traefik (if not using K3s which includes it)
helm repo add traefik https://traefik.github.io/charts
helm repo update

helm install traefik traefik/traefik \
  --namespace traefik \
  --create-namespace \
  --set ports.web.nodePort=30080 \
  --set ports.websecure.nodePort=30443 \
  --set service.type=NodePort
```

## 🚀 Deployment

### 1. Prepare Secrets

```bash
cd infra/k8s/overlays/bunker

# Copy example secrets file
cp secrets.env.example secrets.env

# Generate secure passwords
export POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
export JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
export MINIO_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
export GRAFANA_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

# Fill secrets.env
cat > secrets.env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
DATABASE_URL=postgresql://aethercore:${POSTGRES_PASSWORD}@postgres:5432/aethercore
EOF

# Secure the file
chmod 600 secrets.env

# Enable secret generation in kustomization.yaml
# Uncomment the secretGenerator section
```

### 2. Generate TLS Certificates

```bash
# Generate self-signed certificates
cd ../../../scripts
./generate-tactical-certs.sh /tmp/certs

# Create Kubernetes secret
kubectl create secret tls tactical-glass-tls \
  --cert=/tmp/certs/tactical-glass.crt \
  --key=/tmp/certs/tactical-glass.key \
  --namespace=aethercore \
  --dry-run=client -o yaml | kubectl apply -f -

# Clean up temp files
rm -rf /tmp/certs
```

### 3. Pre-load Images (Air-Gap)

If deploying without internet access:

```bash
# Set up local registry
docker run -d -p 5000:5000 --restart=always --name registry registry:2

# Pull and push images
for img in postgres:16-alpine redis:7-alpine nginx:1.25-alpine \
           minio/minio:latest prom/prometheus:latest grafana/grafana:latest; do
  docker pull $img
  docker tag $img localhost:5000/$img
  docker push localhost:5000/$img
done

# Load your application images
docker load -i aethercore-images.tar
for svc in gateway auth collaboration fleet h2-ingest; do
  docker tag aethercore/${svc}:latest localhost:5000/aethercore/${svc}:latest
  docker push localhost:5000/aethercore/${svc}:latest
done
```

### 4. Label Nodes

```bash
# Label nodes for h2-ingest (telemetry) workload
kubectl label nodes <node-name> aethercore.io/telemetry=true

# Verify
kubectl get nodes --show-labels | grep telemetry
```

### 5. Deploy Stack

```bash
cd infra/k8s/overlays/bunker

# Verify manifests
kustomize build . | less

# Deploy to cluster
kustomize build . | kubectl apply -f -

# Watch deployment
kubectl get pods -n aethercore -w
```

### 6. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n aethercore

# Check services
kubectl get svc -n aethercore

# Check storage
kubectl get pvc -n aethercore

# Check ingress
kubectl get ingress -n aethercore
```

## 🌐 Access

### Via NodePort

```bash
# Get node IP
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

# Access services
echo "Tactical Glass: https://${NODE_IP}:30443"
echo "Grafana: http://${NODE_IP}:30300"
```

### Via Ingress (Recommended)

Add to `/etc/hosts` on operator workstation:

```
<NODE_IP> tactical-glass.local
<NODE_IP> grafana.tactical-glass.local
<NODE_IP> minio.tactical-glass.local
```

Then access:
- **Tactical Glass**: https://tactical-glass.local
- **Grafana**: http://grafana.tactical-glass.local
- **MinIO Console**: http://minio.tactical-glass.local

## 🔧 Configuration

### Resource Limits

Edit `resources-patch.yaml` to adjust CPU/memory:

```yaml
resources:
  limits:
    cpu: "2000m"      # 2 cores
    memory: "2Gi"     # 2GB RAM
  requests:
    cpu: "500m"
    memory: "512Mi"
```

### Storage Sizing

Edit individual StatefulSet volumeClaimTemplates:

```yaml
resources:
  requests:
    storage: 100Gi  # Adjust size
```

### Prometheus Retention

Edit `prometheus-statefulset.yaml`:

```yaml
args:
- --storage.tsdb.retention.time=72h  # Change retention
```

### Local Registry

Edit `kustomization.yaml` images section:

```yaml
images:
  - name: postgres
    newName: my-registry:5000/postgres
```

## 🛠️ Operations

### Scale Services

```bash
# Scale gateway
kubectl scale deployment gateway -n aethercore --replicas=4

# Scale auth
kubectl scale deployment auth -n aethercore --replicas=3
```

### View Logs

```bash
# All pods
kubectl logs -n aethercore -l app=gateway --tail=100 -f

# Specific pod
kubectl logs -n aethercore gateway-xxx-yyy -f

# Previous crashed container
kubectl logs -n aethercore gateway-xxx-yyy --previous
```

### Database Access

```bash
# Connect to PostgreSQL
kubectl exec -it -n aethercore postgres-0 -- psql -U aethercore

# Backup database
kubectl exec -n aethercore postgres-0 -- pg_dump -U aethercore aethercore > backup.sql

# Restore database
cat backup.sql | kubectl exec -i -n aethercore postgres-0 -- psql -U aethercore aethercore
```

### MinIO Management

```bash
# Port-forward MinIO console
kubectl port-forward -n aethercore svc/minio 9001:9001

# Access at http://localhost:9001
# User: aethercore
# Password: from secrets.env
```

### Update Deployment

```bash
# Edit manifests
vim gateway-deployment.yaml

# Apply changes
kustomize build . | kubectl apply -f -

# Rollout status
kubectl rollout status deployment/gateway -n aethercore

# Rollback if needed
kubectl rollout undo deployment/gateway -n aethercore
```

### Restart Services

```bash
# Restart deployment
kubectl rollout restart deployment/gateway -n aethercore

# Delete pod (will be recreated)
kubectl delete pod gateway-xxx-yyy -n aethercore
```

## 🐛 Troubleshooting

### Pods Not Starting

```bash
# Describe pod
kubectl describe pod <pod-name> -n aethercore

# Check events
kubectl get events -n aethercore --sort-by='.lastTimestamp'

# Check node resources
kubectl top nodes
kubectl describe node <node-name>
```

### Storage Issues

```bash
# Check PVC status
kubectl get pvc -n aethercore

# Check PV
kubectl get pv

# Check local-path-provisioner
kubectl logs -n kube-system -l app=local-path-provisioner
```

### TPM Access Issues

```bash
# Verify TPM device on node
kubectl debug node/<node-name> -it --image=ubuntu -- ls -l /dev/tpm0

# Check pod security context
kubectl get pod <pod-name> -n aethercore -o yaml | grep -A10 securityContext
```

### Network/Ingress Issues

```bash
# Check Traefik
kubectl get pods -n traefik
kubectl logs -n traefik -l app.kubernetes.io/name=traefik

# Test internal connectivity
kubectl run -it --rm debug --image=nicolaka/netshoot -n aethercore -- bash
# From debug pod:
curl http://gateway:3000/health
curl http://postgres:5432
```

### Image Pull Issues

```bash
# Check image pull policy
kubectl get deployment gateway -n aethercore -o yaml | grep imagePullPolicy

# Verify images in local registry
curl http://localhost:5000/v2/_catalog

# Check node can access registry
kubectl debug node/<node-name> -it --image=ubuntu -- curl http://localhost:5000/v2/
```

## 🔐 Security

### Secrets Management

For production, use sealed-secrets:

```bash
# Install sealed-secrets
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Create sealed secret
kubectl create secret generic bunker-secrets \
  --from-env-file=secrets.env \
  --namespace=aethercore \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > sealed-secrets.yaml

# Apply sealed secret
kubectl apply -f sealed-secrets.yaml
```

### Network Policies

```bash
# Apply network policies (example)
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: aethercore
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF
```

### RBAC

```bash
# Create service account for apps
kubectl create serviceaccount aethercore-app -n aethercore

# Bind minimal permissions
kubectl create rolebinding aethercore-app \
  --serviceaccount=aethercore:aethercore-app \
  --clusterrole=view \
  --namespace=aethercore
```

## 📚 Additional Resources

- [Kustomize Documentation](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/)
- [K3s Documentation](https://docs.k3s.io/)
- [RKE2 Documentation](https://docs.rke2.io/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [Local Path Provisioner](https://github.com/rancher/local-path-provisioner)

## 🆚 Docker Compose vs Kubernetes

| Feature | Docker Compose | Kubernetes |
|---------|----------------|------------|
| **Simplicity** | ✅ Easier | ❌ More complex |
| **Scalability** | ❌ Limited | ✅ Highly scalable |
| **HA** | ❌ Single node | ✅ Multi-node |
| **Orchestration** | ❌ Basic | ✅ Advanced |
| **Resource Mgmt** | ⚠️ Basic | ✅ Comprehensive |
| **Use Case** | Single server | Multi-node cluster |

**Recommendation**: 
- Use **Docker Compose** for single-server deployments
- Use **Kubernetes** for multi-node tactical clusters

---

**Security Classification**: UNCLASSIFIED  
**Distribution**: Authorized Personnel Only  
**Last Updated**: 2026-01-03
