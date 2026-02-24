#!/bin/bash
# AetherCore AWS Infrastructure Bootstrap Script
# 
# This script creates the S3 bucket and DynamoDB table required for
# Terraform remote state management.
#
# Usage: ./bootstrap-aws.sh [aws-region] [project-name]

set -e

AWS_REGION="${1:-us-east-1}"
PROJECT_NAME="${2:-aethercore}"
STATE_BUCKET="${PROJECT_NAME}-terraform-state"
LOCK_TABLE="${PROJECT_NAME}-terraform-locks"

echo "=========================================="
echo "AetherCore AWS Bootstrap"
echo "=========================================="
echo "AWS Region:      ${AWS_REGION}"
echo "Project Name:    ${PROJECT_NAME}"
echo "State Bucket:    ${STATE_BUCKET}"
echo "Lock Table:      ${LOCK_TABLE}"
echo "=========================================="
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI is not installed. Please install it first."
    echo "Visit: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "ERROR: AWS credentials not configured."
    echo "Run: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✓ AWS Account ID: ${ACCOUNT_ID}"
echo ""

# Create S3 bucket for Terraform state
echo "Creating S3 bucket for Terraform state..."
if aws s3 ls "s3://${STATE_BUCKET}" 2>&1 | grep -q 'NoSuchBucket'; then
    aws s3api create-bucket \
        --bucket "${STATE_BUCKET}" \
        --region "${AWS_REGION}" \
        $([ "${AWS_REGION}" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=${AWS_REGION}")
    
    echo "✓ S3 bucket created: ${STATE_BUCKET}"
    
    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket "${STATE_BUCKET}" \
        --versioning-configuration Status=Enabled
    
    echo "✓ Versioning enabled"
    
    # Enable encryption
    aws s3api put-bucket-encryption \
        --bucket "${STATE_BUCKET}" \
        --server-side-encryption-configuration '{
            "Rules": [{
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }]
        }'
    
    echo "✓ Encryption enabled"
    
    # Block public access
    aws s3api put-public-access-block \
        --bucket "${STATE_BUCKET}" \
        --public-access-block-configuration \
            "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    
    echo "✓ Public access blocked"
    
    # Add tags
    aws s3api put-bucket-tagging \
        --bucket "${STATE_BUCKET}" \
        --tagging "TagSet=[
            {Key=Project,Value=AetherCore},
            {Key=Environment,Value=infrastructure},
            {Key=ManagedBy,Value=Terraform}
        ]"
    
    echo "✓ Tags applied"
else
    echo "✓ S3 bucket already exists: ${STATE_BUCKET}"
fi
echo ""

# Create DynamoDB table for state locking
echo "Creating DynamoDB table for state locking..."
if ! aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${AWS_REGION}" &> /dev/null; then
    aws dynamodb create-table \
        --table-name "${LOCK_TABLE}" \
        --attribute-definitions AttributeName=LockID,AttributeType=S \
        --key-schema AttributeName=LockID,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "${AWS_REGION}" \
        --tags "Key=Project,Value=AetherCore" \
               "Key=Environment,Value=infrastructure" \
               "Key=ManagedBy,Value=Terraform"
    
    echo "✓ DynamoDB table created: ${LOCK_TABLE}"
    
    # Wait for table to be active
    echo "  Waiting for table to be active..."
    aws dynamodb wait table-exists \
        --table-name "${LOCK_TABLE}" \
        --region "${AWS_REGION}"
    
    echo "✓ Table is active"
else
    echo "✓ DynamoDB table already exists: ${LOCK_TABLE}"
fi
echo ""

echo "=========================================="
echo "✓ Bootstrap Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Set required environment variables:"
echo "   export TF_VAR_db_password='your-secure-password'"
echo "   export TF_VAR_jwt_secret='your-jwt-secret'"
echo ""
echo "2. Initialize Terraform:"
echo "   cd infra/terraform/environments/internal"
echo "   terraform init -backend-config=backend.hcl"
echo ""
echo "3. Plan and apply infrastructure:"
echo "   terraform plan"
echo "   terraform apply"
echo ""
