#!/bin/bash
# AetherCore Kubernetes Bunker Pre-Deployment Validation
# Checks for placeholder secrets and configuration issues before deployment
#
# Usage: ./validate-bunker-deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OVERLAY_DIR="${SCRIPT_DIR}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VALIDATION_FAILED=false

echo "=========================================="
echo "AetherCore Bunker Pre-Deployment Validation"
echo "=========================================="
echo ""

# Check 1: Secrets file exists
echo "Checking secrets configuration..."
if [ ! -f "${OVERLAY_DIR}/secrets.env" ]; then
    echo -e "${RED}✗ FAIL${NC}: secrets.env not found"
    echo "  Action: Copy secrets.env.example to secrets.env and fill in values"
    VALIDATION_FAILED=true
else
    echo -e "${GREEN}✓ PASS${NC}: secrets.env exists"
    
    # Check 2: No placeholder values
    if grep -q "CHANGE_ME" "${OVERLAY_DIR}/secrets.env" 2>/dev/null; then
        echo -e "${RED}✗ FAIL${NC}: Placeholder values detected in secrets.env"
        echo "  Found placeholders:"
        grep "CHANGE_ME" "${OVERLAY_DIR}/secrets.env" | sed 's/^/    /'
        VALIDATION_FAILED=true
    else
        echo -e "${GREEN}✓ PASS${NC}: No placeholders in secrets.env"
    fi
    
    # Check 3: Required secrets present
    REQUIRED_SECRETS=("POSTGRES_PASSWORD" "JWT_SECRET" "MINIO_ROOT_PASSWORD" "GRAFANA_ADMIN_PASSWORD" "DATABASE_URL")
    for secret in "${REQUIRED_SECRETS[@]}"; do
        if ! grep -q "^${secret}=" "${OVERLAY_DIR}/secrets.env"; then
            echo -e "${RED}✗ FAIL${NC}: Missing required secret: ${secret}"
            VALIDATION_FAILED=true
        fi
    done
    
    # Check 4: Secret strength (basic check)
    for secret in POSTGRES_PASSWORD JWT_SECRET MINIO_ROOT_PASSWORD GRAFANA_ADMIN_PASSWORD; do
        VALUE=$(grep "^${secret}=" "${OVERLAY_DIR}/secrets.env" | cut -d= -f2 | tr -d '"' | tr -d "'")
        if [ ${#VALUE} -lt 16 ]; then
            echo -e "${YELLOW}⚠ WARN${NC}: ${secret} is shorter than 16 characters (weak)"
        fi
    done
fi

echo ""

# Check 5: Kustomization secretGenerator is enabled
echo "Checking kustomization.yaml..."
if grep -q "^# secretGenerator:" "${OVERLAY_DIR}/kustomization.yaml" 2>/dev/null; then
    echo -e "${RED}✗ FAIL${NC}: secretGenerator is commented out in kustomization.yaml"
    echo "  Action: Uncomment the secretGenerator section"
    VALIDATION_FAILED=true
else
    echo -e "${GREEN}✓ PASS${NC}: secretGenerator configuration detected"
fi

echo ""

# Check 6: TLS certificate secret
echo "Checking TLS certificates..."
if ! kubectl get secret tactical-glass-tls -n aethercore &>/dev/null; then
    echo -e "${YELLOW}⚠ WARN${NC}: tactical-glass-tls secret not found in cluster"
    echo "  Action: Run scripts/generate-tactical-certs.sh and create secret"
    echo "  kubectl create secret tls tactical-glass-tls --cert=cert.crt --key=key.key -n aethercore"
else
    echo -e "${GREEN}✓ PASS${NC}: TLS certificate secret exists"
fi

echo ""

# Check 7: Storage class availability
echo "Checking storage classes..."
if ! kubectl get storageclass local-path &>/dev/null; then
    echo -e "${YELLOW}⚠ WARN${NC}: local-path storage class not found"
    echo "  Action: Install local-path-provisioner or K3s"
else
    echo -e "${GREEN}✓ PASS${NC}: local-path storage class available"
fi

echo ""

# Check 8: Namespace exists
echo "Checking namespace..."
if ! kubectl get namespace aethercore &>/dev/null; then
    echo -e "${YELLOW}⚠ INFO${NC}: aethercore namespace will be created during deployment"
else
    echo -e "${GREEN}✓ PASS${NC}: aethercore namespace exists"
fi

echo ""

# Check 9: Node labels for h2-ingest
echo "Checking node labels for h2-ingest..."
if ! kubectl get nodes -l aethercore.io/telemetry=true 2>/dev/null | grep -q Ready; then
    echo -e "${YELLOW}⚠ WARN${NC}: No nodes labeled for h2-ingest DaemonSet"
    echo "  Action: Label nodes with: kubectl label nodes <node-name> aethercore.io/telemetry=true"
else
    echo -e "${GREEN}✓ PASS${NC}: Telemetry nodes labeled"
fi

echo ""

# Check 10: Ingress controller
echo "Checking ingress controller..."
if kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik &>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}: Traefik ingress controller detected"
elif kubectl get pods -n traefik &>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}: Traefik ingress controller detected"
else
    echo -e "${YELLOW}⚠ WARN${NC}: No ingress controller detected"
    echo "  Action: Install Traefik or configure ingress-patch.yaml for your controller"
fi

echo ""

# Final verdict
echo "=========================================="
if [ "$VALIDATION_FAILED" = true ]; then
    echo -e "${RED}VALIDATION FAILED${NC}"
    echo "=========================================="
    echo ""
    echo "Fix the errors above before deploying."
    echo "Run this script again to revalidate."
    exit 1
else
    echo -e "${GREEN}VALIDATION PASSED${NC}"
    echo "=========================================="
    echo ""
    echo "✓ Ready to deploy!"
    echo ""
    echo "Deploy command:"
    echo "  kustomize build ${OVERLAY_DIR} | kubectl apply -f -"
    echo ""
    echo "Monitor deployment:"
    echo "  kubectl get pods -n aethercore -w"
    exit 0
fi
