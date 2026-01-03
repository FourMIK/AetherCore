#!/bin/bash
# AetherCore Database Migration Script
# Runs database migrations against the RDS instance
#
# This script retrieves the DATABASE_URL from AWS Secrets Manager and runs migrations.
# Supports both Node.js-based and Rust-based (sqlx) migration systems.

set -e

PROJECT_NAME="${1:-aethercore}"
ENVIRONMENT="${2:-internal}"
AWS_REGION="${3:-us-east-1}"

echo "=========================================="
echo "AetherCore Database Migration Runner"
echo "=========================================="
echo "Project:     ${PROJECT_NAME}"
echo "Environment: ${ENVIRONMENT}"
echo "AWS Region:  ${AWS_REGION}"
echo "=========================================="
echo ""

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
echo "✓ AWS credentials validated"
echo ""

# Get the secret ARN from Terraform outputs
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/../infra/terraform/environments/${ENVIRONMENT}"

if [ ! -d "${TERRAFORM_DIR}" ]; then
    echo "ERROR: Terraform directory not found: ${TERRAFORM_DIR}"
    exit 1
fi

cd "${TERRAFORM_DIR}"

if [ ! -f "terraform.tfstate" ]; then
    echo "ERROR: Terraform state not found. Run 'terraform apply' first."
    exit 1
fi

echo "Retrieving database secret ARN from Terraform..."
SECRET_ARN=$(terraform output -raw database_secret_arn 2>/dev/null)

if [ -z "${SECRET_ARN}" ]; then
    echo "ERROR: Database secret ARN not found in Terraform outputs."
    echo "Ensure 'database_secret_arn' output exists in your Terraform configuration."
    exit 1
fi

echo "✓ Secret ARN: ${SECRET_ARN}"
echo ""

# Retrieve DATABASE_URL from AWS Secrets Manager
echo "Retrieving DATABASE_URL from AWS Secrets Manager..."
DATABASE_URL=$(aws secretsmanager get-secret-value \
    --secret-id "${SECRET_ARN}" \
    --region "${AWS_REGION}" \
    --query 'SecretString' \
    --output text 2>/dev/null)

if [ -z "${DATABASE_URL}" ]; then
    echo "ERROR: Failed to retrieve DATABASE_URL from Secrets Manager."
    exit 1
fi

echo "✓ DATABASE_URL retrieved successfully"
echo ""

# Export DATABASE_URL for migration tools
export DATABASE_URL

# Navigate to repository root
REPO_ROOT="${SCRIPT_DIR}/.."
cd "${REPO_ROOT}"

# Detect and run migration system
MIGRATION_EXECUTED=false

# Check for sqlx migrations (Rust)
if [ -d "migrations" ] || [ -d "crates/*/migrations" ]; then
    echo "=========================================="
    echo "Running sqlx migrations (Rust)..."
    echo "=========================================="
    
    if command -v sqlx &> /dev/null; then
        sqlx migrate run
        echo "✓ sqlx migrations completed"
        MIGRATION_EXECUTED=true
    else
        echo "WARNING: sqlx CLI not found. Install with: cargo install sqlx-cli"
    fi
    echo ""
fi

# Check for Node.js migrations
if [ -d "packages/db" ] || [ -d "services/auth/migrations" ] || [ -d "services/fleet/migrations" ]; then
    echo "=========================================="
    echo "Running Node.js migrations..."
    echo "=========================================="
    
    # Try db:migrate script in packages/db if it exists
    if [ -d "packages/db" ] && [ -f "packages/db/package.json" ]; then
        cd "packages/db"
        if grep -q "db:migrate" package.json; then
            npm run db:migrate
            echo "✓ packages/db migrations completed"
            MIGRATION_EXECUTED=true
        fi
        cd "${REPO_ROOT}"
    fi
    
    # Try service-specific migrations
    for service in auth fleet; do
        SERVICE_DIR="services/${service}"
        if [ -d "${SERVICE_DIR}" ] && [ -f "${SERVICE_DIR}/package.json" ]; then
            cd "${SERVICE_DIR}"
            if grep -q "db:migrate\|migrate" package.json; then
                npm run db:migrate || npm run migrate
                echo "✓ ${service} service migrations completed"
                MIGRATION_EXECUTED=true
            fi
            cd "${REPO_ROOT}"
        fi
    done
    echo ""
fi

# Check if any migrations were executed
if [ "${MIGRATION_EXECUTED}" = false ]; then
    echo "WARNING: No migration systems detected."
    echo ""
    echo "Expected migration locations:"
    echo "  - Rust (sqlx):       ./migrations/ or ./crates/*/migrations/"
    echo "  - Node.js:           ./packages/db/ or ./services/*/migrations/"
    echo ""
    echo "To set up migrations:"
    echo "  - For sqlx: sqlx migrate add <name>"
    echo "  - For Node.js: Add 'db:migrate' script to package.json"
    echo ""
    exit 0
fi

echo "=========================================="
echo "✓ Database Migrations Complete!"
echo "=========================================="
echo ""
echo "Database migrations have been successfully applied to:"
echo "  Environment: ${ENVIRONMENT}"
echo "  Region:      ${AWS_REGION}"
echo ""
