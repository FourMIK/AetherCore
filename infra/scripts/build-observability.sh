#!/bin/bash
# AetherCore Observability Stack Build & Push Script

set -e

PROJECT_NAME="${1:-aethercore}"
AWS_REGION="${2:-us-east-1}"
IMAGE_TAG="${3:-latest}"

echo "=========================================="
echo "AetherCore Observability Build & Push"
echo "=========================================="
echo "Project:    ${PROJECT_NAME}"
echo "Region:     ${AWS_REGION}"
echo "Image Tag:  ${IMAGE_TAG}"
echo "=========================================="

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Login to ECR
echo "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${REGISTRY}"

cd "$(dirname "$0")/../observability"

# Build and push Prometheus
echo "Building Prometheus image..."
docker build -f Dockerfile.prometheus -t "${PROJECT_NAME}-prometheus:${IMAGE_TAG}" .
docker tag "${PROJECT_NAME}-prometheus:${IMAGE_TAG}" "${REGISTRY}/${PROJECT_NAME}-prometheus:${IMAGE_TAG}"
docker push "${REGISTRY}/${PROJECT_NAME}-prometheus:${IMAGE_TAG}"
echo "✓ Prometheus image pushed"

# Build and push Grafana
echo "Building Grafana image..."
docker build -f Dockerfile.grafana -t "${PROJECT_NAME}-grafana:${IMAGE_TAG}" .
docker tag "${PROJECT_NAME}-grafana:${IMAGE_TAG}" "${REGISTRY}/${PROJECT_NAME}-grafana:${IMAGE_TAG}"
docker push "${REGISTRY}/${PROJECT_NAME}-grafana:${IMAGE_TAG}"
echo "✓ Grafana image pushed"

echo ""
echo "=========================================="
echo "✓ Observability Stack Images Ready"
echo "=========================================="
echo ""
echo "Prometheus: ${REGISTRY}/${PROJECT_NAME}-prometheus:${IMAGE_TAG}"
echo "Grafana:    ${REGISTRY}/${PROJECT_NAME}-grafana:${IMAGE_TAG}"
echo ""
