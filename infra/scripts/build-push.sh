#!/bin/bash
# AetherCore Docker Build and Push Script
#
# This script builds Docker images for all services and pushes them to ECR.
#
# Usage: ./build-push.sh [aws-region] [project-name] [image-tag]

set -e

AWS_REGION="${1:-us-east-1}"
PROJECT_NAME="${2:-aethercore}"
IMAGE_TAG="${3:-latest}"

echo "=========================================="
echo "AetherCore Docker Build & Push"
echo "=========================================="
echo "AWS Region:      ${AWS_REGION}"
echo "Project Name:    ${PROJECT_NAME}"
echo "Image Tag:       ${IMAGE_TAG}"
echo "=========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed. Please install it first."
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "ERROR: AWS credentials not configured."
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✓ AWS Account ID: ${ACCOUNT_ID}"
echo ""

# ECR repository URLs
ECR_BASE_URL="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
GATEWAY_REPO="${ECR_BASE_URL}/${PROJECT_NAME}-gateway"
AUTH_REPO="${ECR_BASE_URL}/${PROJECT_NAME}-auth"
COLLAB_REPO="${ECR_BASE_URL}/${PROJECT_NAME}-collaboration"
RUST_REPO="${ECR_BASE_URL}/${PROJECT_NAME}-rust-base"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${ECR_BASE_URL}"
echo "✓ Logged in to ECR"
echo ""

# Get repository root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
echo "Repository root: ${REPO_ROOT}"
echo ""

# Build and push Gateway service
echo "=========================================="
echo "Building Gateway service..."
echo "=========================================="
docker build \
    -t "${GATEWAY_REPO}:${IMAGE_TAG}" \
    -t "${GATEWAY_REPO}:latest" \
    -f "${REPO_ROOT}/infra/docker/Dockerfile.gateway" \
    "${REPO_ROOT}"

echo "Pushing Gateway image..."
docker push "${GATEWAY_REPO}:${IMAGE_TAG}"
docker push "${GATEWAY_REPO}:latest"
echo "✓ Gateway image pushed"
echo ""

# Build and push Auth service
echo "=========================================="
echo "Building Auth service..."
echo "=========================================="
docker build \
    -t "${AUTH_REPO}:${IMAGE_TAG}" \
    -t "${AUTH_REPO}:latest" \
    -f "${REPO_ROOT}/infra/docker/Dockerfile.auth" \
    "${REPO_ROOT}"

echo "Pushing Auth image..."
docker push "${AUTH_REPO}:${IMAGE_TAG}"
docker push "${AUTH_REPO}:latest"
echo "✓ Auth image pushed"
echo ""

# Build and push Collaboration service
echo "=========================================="
echo "Building Collaboration service..."
echo "=========================================="
docker build \
    -t "${COLLAB_REPO}:${IMAGE_TAG}" \
    -t "${COLLAB_REPO}:latest" \
    -f "${REPO_ROOT}/infra/docker/Dockerfile.collaboration" \
    "${REPO_ROOT}"

echo "Pushing Collaboration image..."
docker push "${COLLAB_REPO}:${IMAGE_TAG}"
docker push "${COLLAB_REPO}:latest"
echo "✓ Collaboration image pushed"
echo ""

# Build and push Rust base image
echo "=========================================="
echo "Building Rust base image..."
echo "=========================================="
docker build \
    -t "${RUST_REPO}:${IMAGE_TAG}" \
    -t "${RUST_REPO}:latest" \
    -f "${REPO_ROOT}/infra/docker/Dockerfile.rust-base" \
    "${REPO_ROOT}"

echo "Pushing Rust base image..."
docker push "${RUST_REPO}:${IMAGE_TAG}"
docker push "${RUST_REPO}:latest"
echo "✓ Rust base image pushed"
echo ""

echo "=========================================="
echo "✓ Build & Push Complete!"
echo "=========================================="
echo ""
echo "Images pushed:"
echo "  - ${GATEWAY_REPO}:${IMAGE_TAG}"
echo "  - ${AUTH_REPO}:${IMAGE_TAG}"
echo "  - ${COLLAB_REPO}:${IMAGE_TAG}"
echo "  - ${RUST_REPO}:${IMAGE_TAG}"
echo ""
echo "Next steps:"
echo "1. Deploy to ECS:"
echo "   cd infra/terraform/environments/internal"
echo "   terraform apply -var='image_tag=${IMAGE_TAG}'"
echo ""
