#!/bin/bash
# AetherCore Testing Deployment Script
# Purpose: Automated deployment for testing team
# Classification: TEST & EVALUATION

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║         AetherCore Testing Deployment Script              ║"
echo "║                                                            ║"
echo "║         Classification: TEST & EVALUATION                 ║"
echo "║         Version: 0.1.0-alpha                              ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Configuration
DEPLOYMENT_DIR="${REPO_ROOT}/deployments/testing"
LOGS_DIR="${DEPLOYMENT_DIR}/logs"
DATA_DIR="${DEPLOYMENT_DIR}/data"
CONFIG_FILE="${REPO_ROOT}/config/testing.yaml"

# Check prerequisites
echo -e "${BLUE}[1/8] Checking prerequisites...${NC}"

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}  ✓${NC} $1 found"
        return 0
    else
        echo -e "${RED}  ✗${NC} $1 not found"
        return 1
    fi
}

PREREQ_OK=true
check_command "docker" || PREREQ_OK=false
check_command "docker-compose" || check_command "docker" || PREREQ_OK=false
check_command "cargo" || PREREQ_OK=false
check_command "node" || PREREQ_OK=false
check_command "pnpm" || PREREQ_OK=false
check_command "git" || PREREQ_OK=false

if [ "$PREREQ_OK" = false ]; then
    echo -e "${RED}Error: Missing required tools. Please install missing prerequisites.${NC}"
    echo "See TESTING_DEPLOYMENT.md for installation instructions."
    exit 1
fi

echo -e "${GREEN}All prerequisites satisfied!${NC}"
echo ""

# Create directory structure
echo -e "${BLUE}[2/8] Setting up deployment directories...${NC}"
mkdir -p "$DEPLOYMENT_DIR"
mkdir -p "$LOGS_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "${DEPLOYMENT_DIR}/config"
echo -e "${GREEN}  ✓${NC} Directories created"
echo ""

# Create testing configuration
echo -e "${BLUE}[3/8] Generating testing configuration...${NC}"

if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'EOF'
# AetherCore Testing Configuration
environment: testing
log_level: debug

# Dev Mode (simulated TPM)
tpm:
  enabled: false
  dev_mode: true

# Network Configuration
network:
  bind_address: "0.0.0.0"
  port: 8080
  mesh_ports: [7000, 7001, 7002]

# Database (SQLite for testing)
database:
  type: sqlite
  path: "./data/testing.db"

# C2 Endpoint
c2:
  endpoint: "ws://localhost:8080/ws"
  tls_enabled: false

# Test Identity
identity:
  operator_id: "test-operator-001"
  squad_id: "test-squad-alpha"

# Logging
logging:
  level: debug
  format: pretty
  targets:
    - console
    - file
  file:
    path: "./logs/aethercore.log"
    rotation: daily
    max_size: "100MB"

# Security (Testing Mode)
security:
  signature_verification: true
  byzantine_sweep: true
  fail_visible: true
  attestation_required: false

# Performance
performance:
  mesh_update_interval: 60
  max_connections: 100
  connection_timeout: 30
EOF
    echo -e "${GREEN}  ✓${NC} Configuration file created: $CONFIG_FILE"
else
    echo -e "${YELLOW}  ⚠${NC} Configuration file already exists: $CONFIG_FILE"
fi
echo ""

# Set environment variables
echo -e "${BLUE}[4/8] Setting environment variables...${NC}"

export AETHERCORE_ENV=testing
export RUST_LOG=debug
export RUST_BACKTRACE=1
export AETHERCORE_DEV_MODE=true
export DATABASE_URL="sqlite://${DATA_DIR}/testing.db"
export AETHERCORE_PORT=8080
export AETHERCORE_WS_PORT=8080

cat > "${DEPLOYMENT_DIR}/.env" << EOF
# AetherCore Testing Environment
AETHERCORE_ENV=testing
RUST_LOG=debug
RUST_BACKTRACE=1
AETHERCORE_DEV_MODE=true
DATABASE_URL=sqlite://${DATA_DIR}/testing.db
AETHERCORE_PORT=8080
AETHERCORE_WS_PORT=8080
EOF

echo -e "${GREEN}  ✓${NC} Environment configured"
echo -e "  ${CYAN}Config:${NC} $CONFIG_FILE"
echo -e "  ${CYAN}Data:${NC} $DATA_DIR"
echo -e "  ${CYAN}Logs:${NC} $LOGS_DIR"
echo ""

# Install dependencies
echo -e "${BLUE}[5/8] Installing dependencies...${NC}"
echo -e "${YELLOW}This may take a few minutes on first run...${NC}"

if [ ! -d "node_modules" ]; then
    pnpm install --frozen-lockfile > "${LOGS_DIR}/npm-install.log" 2>&1
    echo -e "${GREEN}  ✓${NC} Node.js dependencies installed"
else
    echo -e "${YELLOW}  ⚠${NC} Node.js dependencies already installed (skipping)"
fi
echo ""

# Build Rust services
echo -e "${BLUE}[6/8] Building Rust services...${NC}"
echo -e "${YELLOW}This will take 5-10 minutes on first build...${NC}"

if [ ! -f "target/debug/h2-ingest" ] || [ ! -f "target/debug/aethercore-cli" ]; then
    cargo build --workspace > "${LOGS_DIR}/cargo-build.log" 2>&1
    echo -e "${GREEN}  ✓${NC} Rust services built (debug mode)"
else
    echo -e "${YELLOW}  ⚠${NC} Rust services already built (skipping)"
    echo -e "  ${CYAN}Hint:${NC} Run 'cargo clean' to force rebuild"
fi
echo ""

# Build dashboard
echo -e "${BLUE}[7/8] Building dashboard...${NC}"

cd packages/dashboard
if [ ! -d "dist" ]; then
    pnpm build > "${LOGS_DIR}/dashboard-build.log" 2>&1
    echo -e "${GREEN}  ✓${NC} Dashboard built"
else
    echo -e "${YELLOW}  ⚠${NC} Dashboard already built (skipping)"
fi
cd "$REPO_ROOT"
echo ""

# Start services
echo -e "${BLUE}[8/8] Starting services...${NC}"

# Create docker-compose for testing
cat > "${DEPLOYMENT_DIR}/docker-compose.testing.yml" << 'EOF'
version: '3.8'

services:
  # AetherCore Gateway
  gateway:
    build:
      context: ../..
      dockerfile: docker/Dockerfile.dashboard
    ports:
      - "8080:8080"
    environment:
      - REACT_APP_API_URL=http://localhost:8080/api
      - REACT_APP_WS_URL=ws://localhost:8080/ws
      - REACT_APP_TPM_ENABLED=false
    volumes:
      - ./logs:/var/log/aethercore
    restart: unless-stopped
    networks:
      - aethercore-test

networks:
  aethercore-test:
    driver: bridge
EOF

echo -e "${CYAN}Deployment method:${NC}"
echo "  1) Docker Compose (recommended)"
echo "  2) Local processes (development)"
echo "  3) Skip and configure manually"
echo ""
read -p "Select option [1-3]: " -n 1 -r DEPLOY_METHOD
echo ""

case $DEPLOY_METHOD in
    1)
        echo -e "${BLUE}Starting Docker services...${NC}"
        cd "$DEPLOYMENT_DIR"
        docker-compose -f docker-compose.testing.yml up -d
        echo -e "${GREEN}  ✓${NC} Docker services started"
        ;;
    2)
        echo -e "${BLUE}Starting local processes...${NC}"
        echo -e "${YELLOW}  Note: Services will run in foreground. Press Ctrl+C to stop.${NC}"
        echo ""
        echo "Starting dashboard in dev mode..."
        cd "${REPO_ROOT}/packages/dashboard"
        pnpm tauri dev > "${LOGS_DIR}/dashboard-dev.log" 2>&1 &
        DASHBOARD_PID=$!
        echo -e "${GREEN}  ✓${NC} Dashboard started (PID: $DASHBOARD_PID)"
        echo -e "  ${CYAN}Logs:${NC} ${LOGS_DIR}/dashboard-dev.log"
        ;;
    3)
        echo -e "${YELLOW}Skipping automatic startup.${NC}"
        echo "To start manually:"
        echo "  Docker: cd ${DEPLOYMENT_DIR} && docker-compose -f docker-compose.testing.yml up"
        echo "  Local: cd ${REPO_ROOT}/packages/dashboard && pnpm tauri dev"
        ;;
    *)
        echo -e "${YELLOW}Invalid option. Skipping automatic startup.${NC}"
        ;;
esac

cd "$REPO_ROOT"
echo ""

# Summary
echo -e "${GREEN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║         Deployment Complete!                              ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

echo -e "${CYAN}Access Points:${NC}"
echo "  Dashboard:    http://localhost:8080"
echo "  API:          http://localhost:8080/api"
echo "  WebSocket:    ws://localhost:8080/ws"
echo "  Health Check: http://localhost:8080/api/health"
echo ""

echo -e "${CYAN}Next Steps:${NC}"
echo "  1. Open browser to http://localhost:8080"
echo "  2. Run validation: ./scripts/test-deployment-health.sh"
echo "  3. Follow test scenarios in TESTING_DEPLOYMENT.md"
echo ""

echo -e "${CYAN}Useful Commands:${NC}"
echo "  Stop services:    docker-compose -f ${DEPLOYMENT_DIR}/docker-compose.testing.yml down"
echo "  View logs:        tail -f ${LOGS_DIR}/*.log"
echo "  Check health:     curl http://localhost:8080/api/health"
echo "  Clean data:       rm -rf ${DATA_DIR}/*"
echo ""

echo -e "${CYAN}Documentation:${NC}"
echo "  Testing Guide:    TESTING_DEPLOYMENT.md"
echo "  Architecture:     ARCHITECTURE.md"
echo "  Security:         SECURITY.md"
echo "  Troubleshooting:  See TESTING_DEPLOYMENT.md section 🐛"
echo ""

echo -e "${YELLOW}⚠️  Remember:${NC} This is a TESTING deployment with dev mode enabled."
echo "   Do NOT use this configuration in production!"
echo ""

echo -e "${GREEN}Happy Testing! 🚀${NC}"
