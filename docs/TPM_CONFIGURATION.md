# TPM Runtime Configuration Guide

## Overview

AetherCore provides a runtime configuration flag `TPM_ENABLED` that controls hardware-rooted trust validation across the entire system. This flag allows operators to run AetherCore in environments where TPM 2.0 hardware is unavailable or where software-based identity is acceptable for specific use cases.

## ⚠️ Security Warning

**Disabling TPM removes hardware-rooted trust guarantees and significantly reduces security.**

When `TPM_ENABLED=false`:
- Identity attestation is not cryptographically bound to physical hardware
- Nodes cannot prove their boot integrity via PCR measurements
- The system operates without the foundational security principle: "Trust-by-Policy" becomes "Trust-by-Configuration"
- Susceptible to identity spoofing and software-based attacks

**Default Setting:** `TPM_ENABLED=true` (Hardware-rooted trust ENABLED)

## Configuration

### Environment Variable Format

The `TPM_ENABLED` environment variable supports standard boolean parsing:

**False values** (case-insensitive):
- `false`
- `0`
- `no`
- `off`

**True values** (case-insensitive):
- `true`
- `1`
- `yes`
- `on`

**Default:** If undefined or empty, defaults to `true` (TPM enabled)

### Frontend (Dashboard)

Set `REACT_APP_TPM_ENABLED` for the React dashboard:

```bash
# Docker
docker run -e REACT_APP_TPM_ENABLED=false aethercore-dashboard

# Docker Compose
environment:
  - REACT_APP_TPM_ENABLED=false

# Local development (.env)
VITE_TPM_ENABLED=false
```

**Behavior when disabled:**
- WebSocket heartbeats send unsigned/placeholder signatures instead of TPM-signed payloads
- Connection remains active without TPM signing
- Red banner displayed: "TPM DISABLED - Hardware-Rooted Trust Features Disabled"
- System Admin view shows TPM 2.0 status as "Disabled"

### Backend (Identity gRPC Server)

Set `TPM_ENABLED` for the Rust identity service:

```bash
# Environment variable
export TPM_ENABLED=false

# Docker
docker run -e TPM_ENABLED=false aethercore-identity

# Systemd service
Environment="TPM_ENABLED=false"
```

**Behavior when disabled:**
- Node registration accepts empty TPM quote, PCR, and AK certificate fields
- TPM attestation validation is completely skipped
- Logs: "skipping TPM validation (TPM_ENABLED=false)"
- Startup log: "TPM is DISABLED - Hardware-rooted trust features are not active"

### Gateway Service

Set `TPM_ENABLED` for the gateway (TypeScript/Node.js):

```bash
# Environment variable
export TPM_ENABLED=false

# Docker
docker run -e TPM_ENABLED=false aethercore-gateway
```

**Behavior:**
- Gateway does not enforce TPM (stateless proxy)
- Logs TPM mode at startup for audit trail
- Forwards requests to backend services

## Deployment Examples

### Local Development

```bash
# Disable TPM for local testing
export TPM_ENABLED=false
export REACT_APP_TPM_ENABLED=false

# Start services
cargo run --bin identity-server
pnpm run --filter @aethercore/dashboard dev
```

### Docker Compose

```yaml
version: '3.8'
services:
  dashboard:
    image: aethercore-dashboard:latest
    environment:
      - REACT_APP_TPM_ENABLED=false
      - REACT_APP_API_URL=http://api:8080
      - REACT_APP_WS_URL=ws://gateway:3000
    ports:
      - "8443:8443"

  identity:
    image: aethercore-identity:latest
    environment:
      - TPM_ENABLED=false
      - RUST_LOG=info
    ports:
      - "50051:50051"

  gateway:
    image: aethercore-gateway:latest
    environment:
      - TPM_ENABLED=false
      - PORT=3000
    ports:
      - "3000:3000"
```

### AWS ECS Fargate

Task definitions are provided in `infra/ecs/task-definitions/`:

**Dashboard Task Definition** (`aethercore-dashboard.json`):
```json
{
  "environment": [
    {
      "name": "REACT_APP_TPM_ENABLED",
      "value": "false"
    }
  ]
}
```

**API Task Definition** (`aethercore-api.json`):
```json
{
  "environment": [
    {
      "name": "TPM_ENABLED",
      "value": "false"
    }
  ]
}
```

#### Deploying to ECS (Any AWS Region)

**Prerequisites:**
- AWS CLI configured with credentials
- ECR images pushed to your container registry
- ECS cluster created

The following examples use `us-east-1` region. Adapt the `--region` flag and ARNs for your deployment region.

**Step 1: Register Task Definitions**

```bash
# Register dashboard task definition
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/task-definitions/aethercore-dashboard.json \
  --region us-east-1

# Register API task definition
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/task-definitions/aethercore-api.json \
  --region us-east-1
```

**Step 2: Create or Update Services**

```bash
# Create dashboard service (if not exists)
aws ecs create-service \
  --cluster AetherCore \
  --service-name aethercore-dashboard \
  --task-definition aethercore-dashboard \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --region us-east-1

# Update dashboard service with new task definition
aws ecs update-service \
  --cluster AetherCore \
  --service aethercore-dashboard \
  --task-definition aethercore-dashboard \
  --force-new-deployment \
  --region us-east-1

# Create API service (if not exists)
aws ecs create-service \
  --cluster AetherCore \
  --service-name aethercore-api \
  --task-definition aethercore-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --region us-east-1

# Update API service with new task definition
aws ecs update-service \
  --cluster AetherCore \
  --service aethercore-api \
  --task-definition aethercore-api \
  --force-new-deployment \
  --region us-east-1
```

**Step 3: Update Environment Variables (Runtime)**

To change `TPM_ENABLED` without redeploying:

```bash
# Update task definition with new TPM_ENABLED value
# Edit the JSON file, then re-register
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/task-definitions/aethercore-api.json \
  --region us-east-1

# Force service to use new task definition
aws ecs update-service \
  --cluster AetherCore \
  --service aethercore-api \
  --force-new-deployment \
  --region us-east-1
```

**Step 4: Verify Deployment**

```bash
# Check service status
aws ecs describe-services \
  --cluster AetherCore \
  --services aethercore-dashboard aethercore-api \
  --region us-east-1

# Check task logs
aws logs tail /aws/ecs/aethercore-api --follow --region us-east-1
aws logs tail /aws/ecs/aethercore-dashboard --follow --region us-east-1

# Look for TPM status in logs:
# "Identity Registry Service initialized with TPM_ENABLED=false"
# "TPM is DISABLED - Hardware-rooted trust features are not active"
```

**Step 5: Roll Back (if needed)**

```bash
# Revert to previous task definition
aws ecs update-service \
  --cluster AetherCore \
  --service aethercore-api \
  --task-definition aethercore-api:PREVIOUS_REVISION \
  --force-new-deployment \
  --region us-east-1
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aethercore-identity
spec:
  template:
    spec:
      containers:
      - name: identity
        image: aethercore-identity:latest
        env:
        - name: TPM_ENABLED
          value: "false"
```

## Testing & Verification

A verification script is provided to test TPM disabled mode:

```bash
./scripts/verify-tpm-disabled.sh
```

This script validates:
- Dashboard builds with TPM disabled
- env.js generation includes TPM_ENABLED
- Identity service skips TPM validation when disabled
- Gateway logs TPM status
- Docker configuration supports runtime switch
- ECS task definitions include TPM_ENABLED

### Manual Verification

**1. Dashboard:**
```bash
# Check env.js
curl http://localhost:8080/env.js
# Should show: REACT_APP_TPM_ENABLED: "false"

# Check for TPM disabled banner (red banner at top of UI)
# Check System Admin view - TPM 2.0 should show "Disabled" badge
```

**2. Identity Service:**
```bash
# Check logs for TPM status
docker logs identity-container 2>&1 | grep TPM

# Expected output:
# "Identity Registry Service initialized with TPM_ENABLED=false"
# "⚠️  TPM DISABLED - Hardware-rooted trust validation is disabled"
```

**3. Gateway:**
```bash
# Check logs for TPM status
docker logs gateway-container 2>&1 | grep tpm

# Expected output:
# "tpm_enabled":false
# "TPM is DISABLED - Hardware-rooted trust features are not active"
```

## Use Cases

### When to Disable TPM

**✅ Acceptable:**
- Local development and testing
- CI/CD pipelines and automated testing
- Demo environments without sensitive data
- Cloud VMs without vTPM support
- Prototyping and proof-of-concept deployments

**❌ Not Recommended:**
- Production deployments with sensitive data
- Contested/adversarial network environments
- Critical infrastructure or military operations
- Multi-tenant environments
- Any scenario requiring high-assurance identity

### Hybrid Deployments

You can run mixed environments where some nodes have TPM enabled and others don't:

- **Command & Control**: TPM enabled (high-trust nodes)
- **Edge Sensors**: TPM enabled (deployed in field)
- **Development Dashboard**: TPM disabled (local testing)
- **CI Test Agents**: TPM disabled (ephemeral containers)

**Note:** The system does not distinguish between TPM-enabled and TPM-disabled nodes in the mesh. All nodes are treated equally once enrolled. TPM enforcement is per-service, not per-node.

## Security Implications

### Threat Model Changes

**With TPM Enabled (Default):**
- Attacker must compromise physical hardware (TPM chip)
- Boot integrity verified via PCR measurements
- Private keys never leave hardware security module
- Identity bound to silicon (cannot be cloned)

**With TPM Disabled:**
- Attacker can spoof identity in software
- No boot integrity verification
- Private keys stored in software (extractable)
- Identity can be cloned or forged

### Attack Scenarios

**Scenario 1: Compromised Node**
- **TPM Enabled**: Attacker cannot extract private key or forge attestation. Node can be identified as compromised via Aetheric Sweep.
- **TPM Disabled**: Attacker can extract key, impersonate node, and potentially infiltrate mesh.

**Scenario 2: Supply Chain Attack**
- **TPM Enabled**: Malicious firmware detected via PCR mismatch. Node fails enrollment.
- **TPM Disabled**: Malicious firmware cannot be detected at hardware level.

**Scenario 3: Insider Threat**
- **TPM Enabled**: Insider cannot clone node identity without physical access to TPM.
- **TPM Disabled**: Insider can copy software keys and create rogue nodes.

### Compensating Controls

If TPM must be disabled, implement additional controls:

1. **Network Segmentation**: Isolate TPM-disabled nodes on separate network segments
2. **Enhanced Monitoring**: Increase logging and anomaly detection
3. **Short-Lived Credentials**: Reduce credential lifetime (hours, not days)
4. **Multi-Factor Authentication**: Require additional authentication factors
5. **Regular Audits**: Frequent security audits and penetration testing
6. **Code Signing**: Enforce strict code signing for all binaries
7. **Runtime Integrity**: Use Linux IMA/EVM for runtime file integrity

## Troubleshooting

### Dashboard Not Showing TPM Banner

**Problem:** TPM disabled but banner not visible

**Solution:**
```bash
# Check env.js
curl http://localhost:8080/env.js

# Verify REACT_APP_TPM_ENABLED is set
# Force refresh browser (Ctrl+Shift+R)
# Check browser console for runtime config
```

### Identity Service Rejecting Registration

**Problem:** Registration fails even with TPM_ENABLED=false

**Solution:**
```bash
# Check identity service logs
docker logs identity-service 2>&1 | grep "TPM_ENABLED"

# Verify environment variable is set
docker exec identity-service env | grep TPM_ENABLED

# Restart service to pick up new environment
docker restart identity-service
```

### WebSocket Connection Failing

**Problem:** Dashboard cannot connect to gateway

**Solution:**
```bash
# Check if TPM_ENABLED matches on both sides
# Dashboard: REACT_APP_TPM_ENABLED
# Backend: TPM_ENABLED

# Check gateway logs for WebSocket errors
docker logs gateway-service 2>&1 | grep WebSocket

# Verify heartbeat is being sent without TPM signature
# Look for: "TPM disabled - sending unsigned heartbeat"
```

## References

- [TPM 2.0 Specification](https://trustedcomputinggroup.org/resource/tpm-library-specification/)
- [AetherCore Architecture](ARCHITECTURE.md)
- [Security Policy](SECURITY.md)
- [Deployment Guide](DEPLOYMENT_PRODUCTION.md)

## Support

For questions or issues related to TPM configuration:
1. Check logs for TPM status messages
2. Run verification script: `./scripts/verify-tpm-disabled.sh`
3. Review this documentation
4. Open an issue on GitHub with logs and configuration

---

**Remember:** Disabling TPM is a significant security decision. Always evaluate the risk vs. operational requirements and implement appropriate compensating controls.
