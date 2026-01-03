#!/bin/bash
# AetherCore Dashboard Deployment Script
# Builds and deploys the dashboard to S3 + CloudFront

set -e

PROJECT_NAME="${1:-aethercore}"
ENVIRONMENT="${2:-internal}"
AWS_REGION="${3:-us-east-1}"

echo "=========================================="
echo "AetherCore Dashboard Deployment"
echo "=========================================="
echo "Project:     ${PROJECT_NAME}"
echo "Environment: ${ENVIRONMENT}"
echo "AWS Region:  ${AWS_REGION}"
echo "=========================================="

# Get Terraform outputs
cd "$(dirname "$0")/../terraform/environments/${ENVIRONMENT}"

if [ ! -f "terraform.tfstate" ]; then
    echo "ERROR: Terraform state not found. Run 'terraform apply' first."
    exit 1
fi

S3_BUCKET=$(terraform output -raw dashboard_s3_bucket)
CLOUDFRONT_ID=$(terraform output -raw cloudfront_distribution_id)

echo "S3 Bucket:     ${S3_BUCKET}"
echo "CloudFront ID: ${CLOUDFRONT_ID}"
echo ""

# Build dashboard
echo "Building dashboard..."
cd "$(dirname "$0")/../../packages/dashboard"

if [ ! -f "package.json" ]; then
    echo "ERROR: Dashboard package.json not found"
    exit 1
fi

npm install
npm run build

if [ ! -d "dist" ]; then
    echo "ERROR: Dashboard build failed - dist directory not found"
    exit 1
fi

echo "✓ Dashboard built successfully"
echo ""

# Deploy to S3
echo "Deploying to S3..."
aws s3 sync dist/ "s3://${S3_BUCKET}/" \
    --region "${AWS_REGION}" \
    --delete \
    --cache-control "public, max-age=31536000" \
    --exclude "*.html" \
    --exclude "*.json"

# Deploy HTML files with shorter cache
aws s3 sync dist/ "s3://${S3_BUCKET}/" \
    --region "${AWS_REGION}" \
    --cache-control "public, max-age=0, must-revalidate" \
    --include "*.html" \
    --include "*.json"

echo "✓ Files uploaded to S3"
echo ""

# Invalidate CloudFront cache
echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
    --distribution-id "${CLOUDFRONT_ID}" \
    --paths "/*" \
    --region "${AWS_REGION}"

echo "✓ CloudFront cache invalidated"
echo ""

echo "=========================================="
echo "✓ Dashboard Deployment Complete!"
echo "=========================================="
echo ""
echo "Dashboard URL: https://$(terraform output -raw cloudfront_domain_name)"
echo ""
