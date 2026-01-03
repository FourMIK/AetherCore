#!/bin/bash
# AetherCore Genesis Bootloader - Bunker Mode Initialization
# Air-gapped tactical server bootstrap for CLOUD_ZERO operation
#
# This script:
#   1. Verifies hardware prerequisites (TPM, NVMe, radios)
#   2. Generates secrets if missing
#   3. Initializes data directories
#   4. Launches PostgreSQL and waits for health
#   5. Runs database migrations
#   6. Launches the full AetherCore stack
#
# Usage: ./init-bunker.sh [data_path] [env_file]

set -e

# Configuration
BUNKER_DATA_PATH="${1:-/mnt/nvme/aethercore}"
ENV_FILE="${2:-.env.bunker}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.bunker.yml"
CERT_DIR="${BUNKER_DATA_PATH}/certs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "=========================================="
echo "AetherCore Genesis Bootloader"
echo "CLOUD_ZERO - Bunker Mode Initialization"
echo "=========================================="
echo "Data path:    ${BUNKER_DATA_PATH}"
echo "Env file:     ${ENV_FILE}"
echo "Compose file: ${COMPOSE_FILE}"
echo "=========================================="
echo ""

# Function to print colored messages
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to generate random secure string
generate_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# ============================================================================
# PHASE 1: Hardware Prerequisites Check
# ============================================================================
log_info "Phase 1: Hardware Prerequisites Check"
echo ""

# Check for TPM device (CodeRalphie)
log_info "Checking TPM 2.0 presence (/dev/tpm0)..."
if [ -e /dev/tpm0 ]; then
    log_success "TPM device found: $(ls -l /dev/tpm0)"
    
    # Check TPM permissions
    if [ ! -r /dev/tpm0 ]; then
        log_warning "TPM device not readable. You may need elevated permissions."
        log_info "Run: sudo chmod 666 /dev/tpm0 (or add user to tss group)"
    fi
else
    log_warning "TPM device /dev/tpm0 NOT FOUND"
    log_warning "TPM-backed signing will be unavailable"
    log_warning "Identity verification will operate in degraded mode"
    echo ""
    read -p "Continue without TPM? (yes/NO): " CONTINUE_NO_TPM
    if [ "$CONTINUE_NO_TPM" != "yes" ]; then
        log_error "TPM required for bunker mode. Exiting."
        exit 1
    fi
fi
echo ""

# Check for NVMe storage
log_info "Checking NVMe storage availability..."
if df -h "${BUNKER_DATA_PATH}" 2>/dev/null | grep -qE 'nvme|ssd'; then
    log_success "NVMe/SSD storage detected"
    df -h "${BUNKER_DATA_PATH}" | tail -1
elif [ -d "$(dirname "${BUNKER_DATA_PATH}")" ]; then
    log_warning "NVMe not detected, using available storage"
    df -h "${BUNKER_DATA_PATH}" 2>/dev/null | tail -1 || df -h "$(dirname "${BUNKER_DATA_PATH}")" | tail -1
else
    log_error "Data path parent directory does not exist: $(dirname "${BUNKER_DATA_PATH}")"
    exit 1
fi
echo ""

# Check for radio devices
log_info "Checking for RF radio interfaces (/dev/ttyUSB*)..."
if ls /dev/ttyUSB* 1> /dev/null 2>&1; then
    log_success "Radio interfaces found:"
    ls -l /dev/ttyUSB* | awk '{print "  " $0}'
else
    log_warning "No USB radio interfaces detected (/dev/ttyUSB*)"
    log_warning "RF telemetry ingestion will be unavailable"
fi
echo ""

# Check Docker
log_info "Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Install Docker Engine first."
    exit 1
fi
log_success "Docker found: $(docker --version)"

if ! docker compose version &> /dev/null; then
    log_error "Docker Compose plugin not found. Install docker-compose-plugin."
    exit 1
fi
log_success "Docker Compose found: $(docker compose version)"
echo ""

# Check compose file exists
if [ ! -f "${COMPOSE_FILE}" ]; then
    log_error "Docker Compose file not found: ${COMPOSE_FILE}"
    exit 1
fi
log_success "Compose file found: ${COMPOSE_FILE}"
echo ""

# ============================================================================
# PHASE 2: Secrets Generation
# ============================================================================
log_info "Phase 2: Secrets and Configuration"
echo ""

if [ -f "${ENV_FILE}" ]; then
    log_info "Environment file exists: ${ENV_FILE}"
    log_warning "Using existing secrets. To regenerate, delete ${ENV_FILE}"
    echo ""
    # Source existing env file
    source "${ENV_FILE}"
else
    log_info "Generating new environment file: ${ENV_FILE}"
    
    # Generate secrets
    POSTGRES_PASSWORD=$(generate_secret)
    JWT_SECRET=$(generate_secret)
    MINIO_ROOT_PASSWORD=$(generate_secret)
    GRAFANA_ADMIN_PASSWORD=$(generate_secret)
    
    # Create .env file
    cat > "${ENV_FILE}" <<EOF
# AetherCore Bunker Mode Configuration
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# WARNING: This file contains sensitive secrets. Protect accordingly.

# Data paths
BUNKER_DATA_PATH=${BUNKER_DATA_PATH}
DASHBOARD_BUILD_PATH=../../../packages/dashboard/dist

# Container registry (local)
REGISTRY=localhost:5000
VERSION=latest

# PostgreSQL
POSTGRES_DB=aethercore
POSTGRES_USER=aethercore
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_SHARED_BUFFERS=4GB
POSTGRES_EFFECTIVE_CACHE_SIZE=12GB
POSTGRES_MAX_CONNECTIONS=200

# JWT Authentication
JWT_SECRET=${JWT_SECRET}

# MinIO (S3-compatible storage)
MINIO_ROOT_USER=aethercore
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
S3_BUCKET=aethercore-proofs

# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}

# Rust services
RUST_LOG=info

# Feature flags
TPM_ENABLED=true
MERKLE_VINE_ENABLED=true
HASH_ALGORITHM=BLAKE3
SIGNING_ALGORITHM=Ed25519
SIGNING_BACKEND=TPM
EOF

    chmod 600 "${ENV_FILE}"
    log_success "Environment file generated: ${ENV_FILE}"
    log_warning "Secrets have been generated. Back up ${ENV_FILE} to secure offline storage."
    echo ""
fi

# Export environment variables
export $(grep -v '^#' "${ENV_FILE}" | xargs)

# ============================================================================
# PHASE 3: Data Directory Initialization
# ============================================================================
log_info "Phase 3: Data Directory Initialization"
echo ""

log_info "Creating data directories in ${BUNKER_DATA_PATH}..."
mkdir -p "${BUNKER_DATA_PATH}"/{postgres,postgres-backup,redis,minio,prometheus,grafana,nginx-logs,certs}

# Set permissions
chmod 700 "${BUNKER_DATA_PATH}"
chmod 700 "${CERT_DIR}"

log_success "Data directories created"
echo ""

# ============================================================================
# PHASE 4: TLS Certificate Generation
# ============================================================================
log_info "Phase 4: TLS Certificate Generation"
echo ""

if [ ! -f "${CERT_DIR}/tactical-glass.crt" ]; then
    log_info "Generating self-signed TLS certificates..."
    
    CERT_GEN_SCRIPT="${SCRIPT_DIR}/../../../scripts/generate-tactical-certs.sh"
    if [ -f "${CERT_GEN_SCRIPT}" ]; then
        bash "${CERT_GEN_SCRIPT}" "${CERT_DIR}" 3650
    else
        log_error "Certificate generation script not found: ${CERT_GEN_SCRIPT}"
        log_info "Please generate certificates manually and place in ${CERT_DIR}"
        exit 1
    fi
else
    log_success "TLS certificates already exist in ${CERT_DIR}"
fi
echo ""

# ============================================================================
# PHASE 5: Database Bootstrap
# ============================================================================
log_info "Phase 5: Database Bootstrap"
echo ""

log_info "Starting PostgreSQL container..."
cd "${SCRIPT_DIR}"
docker compose -f docker-compose.bunker.yml up -d postgres

log_info "Waiting for PostgreSQL to become healthy..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker compose -f docker-compose.bunker.yml ps postgres | grep -q "healthy"; then
        log_success "PostgreSQL is healthy"
        break
    fi
    echo -n "."
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    log_error "PostgreSQL failed to become healthy within ${MAX_WAIT} seconds"
    log_info "Check logs: docker compose -f docker-compose.bunker.yml logs postgres"
    exit 1
fi
echo ""

# ============================================================================
# PHASE 6: Database Migrations
# ============================================================================
log_info "Phase 6: Database Migrations"
echo ""

log_info "Running database migrations..."
REPO_ROOT="${SCRIPT_DIR}/../../.."

# Check for migration directories
MIGRATION_FOUND=false

# Try sqlx migrations (Rust)
if [ -d "${REPO_ROOT}/migrations" ] || [ -d "${REPO_ROOT}/crates/"*"/migrations" ]; then
    log_info "Rust (sqlx) migrations found"
    if command -v sqlx &> /dev/null; then
        cd "${REPO_ROOT}"
        export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
        sqlx migrate run || log_warning "sqlx migrations failed or not needed"
        MIGRATION_FOUND=true
    else
        log_warning "sqlx CLI not found. Install: cargo install sqlx-cli"
    fi
fi

# Try Node.js migrations
if [ -d "${REPO_ROOT}/packages/db" ]; then
    log_info "Node.js migrations found in packages/db"
    cd "${REPO_ROOT}/packages/db"
    export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
    if grep -q "db:migrate" package.json; then
        npm run db:migrate || log_warning "Node.js migrations failed or not needed"
        MIGRATION_FOUND=true
    elif grep -q "migrate" package.json; then
        npm run migrate || log_warning "Node.js migrations failed or not needed"
        MIGRATION_FOUND=true
    fi
fi

if [ "$MIGRATION_FOUND" = false ]; then
    log_warning "No migrations found. Database may need manual initialization."
fi
echo ""

# ============================================================================
# PHASE 7: Full Stack Launch
# ============================================================================
log_info "Phase 7: Full Stack Launch"
echo ""

log_info "Launching full AetherCore stack..."
cd "${SCRIPT_DIR}"
docker compose -f docker-compose.bunker.yml up -d

echo ""
log_info "Waiting for all services to become healthy (this may take 2-3 minutes)..."
sleep 30

# Check service health
log_info "Checking service health..."
docker compose -f docker-compose.bunker.yml ps

echo ""
echo "=========================================="
log_success "AetherCore Bunker Mode Initialized!"
echo "=========================================="
echo ""
echo "Access Points:"
echo "  Tactical Glass:   https://localhost (credentials in ${ENV_FILE})"
echo "  Grafana:          http://localhost:3003 (admin / see ${ENV_FILE})"
echo "  Prometheus:       http://localhost:9090"
echo "  MinIO Console:    http://localhost:9001 (aethercore / see ${ENV_FILE})"
echo ""
echo "Management Commands:"
echo "  View logs:        docker compose -f ${COMPOSE_FILE} logs -f [service]"
echo "  Stop stack:       docker compose -f ${COMPOSE_FILE} down"
echo "  Restart service:  docker compose -f ${COMPOSE_FILE} restart [service]"
echo "  Check status:     docker compose -f ${COMPOSE_FILE} ps"
echo ""
echo "Data Location:      ${BUNKER_DATA_PATH}"
echo "Secrets Location:   ${ENV_FILE}"
echo ""
log_warning "IMPORTANT: Back up ${ENV_FILE} and ${CERT_DIR} to secure offline storage"
log_warning "SECURITY: This is a tactical deployment. Follow operational security procedures."
echo ""
echo "=========================================="
echo "Mission Status: OPERATIONAL"
echo "=========================================="
echo ""
