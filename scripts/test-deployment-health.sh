#!/bin/bash
# AetherCore Testing Health Check Script
# Purpose: Validate testing deployment is working correctly
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

# Configuration
API_BASE_URL="${AETHERCORE_API_URL:-http://localhost:8080}"
API_HEALTH_ENDPOINT="${API_BASE_URL}/api/health"
WS_URL="${AETHERCORE_WS_URL:-ws://localhost:8080/ws}"

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║      AetherCore Testing Deployment Health Check           ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Helper function
check_status() {
    local check_name="$1"
    local status="$2"
    local message="${3:-}"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $check_name"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        if [ -n "$message" ]; then
            echo -e "  ${CYAN}→${NC} $message"
        fi
    else
        echo -e "${RED}✗${NC} $check_name"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        if [ -n "$message" ]; then
            echo -e "  ${YELLOW}→${NC} $message"
        fi
    fi
}

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is not installed${NC}"
    echo "Install curl to run health checks"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 1: API Health Endpoint
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[1] API Health Check${NC}"

if curl -sf "$API_HEALTH_ENDPOINT" > /dev/null 2>&1; then
    RESPONSE=$(curl -sf "$API_HEALTH_ENDPOINT")
    check_status "API endpoint reachable" "PASS" "$API_HEALTH_ENDPOINT"
    
    # Check response contains expected fields
    if echo "$RESPONSE" | grep -q "status"; then
        check_status "API returns valid health response" "PASS"
    else
        check_status "API returns valid health response" "FAIL" "Response: $RESPONSE"
    fi
else
    check_status "API endpoint reachable" "FAIL" "Cannot reach $API_HEALTH_ENDPOINT"
    check_status "API returns valid health response" "FAIL" "API not responding"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 2: WebSocket Connectivity
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[2] WebSocket Connectivity${NC}"

# Try to connect to WebSocket using curl with upgrade headers
WS_CHECK=$(curl -sf -I -N \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "http://localhost:8080/ws" 2>&1 || echo "FAILED")

if echo "$WS_CHECK" | grep -q "101"; then
    check_status "WebSocket upgrade available" "PASS" "Switching Protocols (101)"
elif echo "$WS_CHECK" | grep -q "FAILED"; then
    check_status "WebSocket upgrade available" "FAIL" "Connection failed"
else
    check_status "WebSocket upgrade available" "FAIL" "No upgrade response"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 3: Port Availability
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[3] Port Availability${NC}"

check_port() {
    local port=$1
    local name=$2
    
    if nc -z localhost "$port" 2>/dev/null || (exec 3<>/dev/tcp/localhost/"$port") 2>/dev/null; then
        check_status "$name (port $port)" "PASS" "Port is open and listening"
        if [ -n "${3:-}" ]; then
            exec 3<&-
            exec 3>&-
        fi
        return 0
    else
        check_status "$name (port $port)" "FAIL" "Port not accessible"
        return 1
    fi
}

check_port 8080 "Main API/Dashboard"
check_port 7000 "Mesh P2P (first port)" || true
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 4: Docker Services (if applicable)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[4] Docker Services (if running)${NC}"

if command -v docker &> /dev/null && docker ps > /dev/null 2>&1; then
    RUNNING_CONTAINERS=$(docker ps --filter "name=aethercore" --format "{{.Names}}" | wc -l)
    
    if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
        check_status "Docker containers running" "PASS" "$RUNNING_CONTAINERS container(s) found"
        
        # List running containers
        echo -e "${CYAN}  Running containers:${NC}"
        docker ps --filter "name=aethercore" --format "  - {{.Names}} ({{.Status}})"
    else
        check_status "Docker containers running" "FAIL" "No AetherCore containers found"
        echo -e "${YELLOW}  Hint: Start with 'docker-compose up' or use local deployment${NC}"
    fi
else
    echo -e "${YELLOW}  ℹ${NC} Docker not available or not running (this is OK for local deployment)"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 5: File System Checks
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[5] File System Checks${NC}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_file_exists() {
    local file="$1"
    local name="$2"
    
    if [ -f "$file" ]; then
        check_status "$name exists" "PASS" "$file"
    elif [ -d "$file" ]; then
        check_status "$name exists" "PASS" "$file (directory)"
    else
        check_status "$name exists" "FAIL" "Not found: $file"
    fi
}

check_file_exists "${REPO_ROOT}/config/testing.yaml" "Testing configuration"
check_file_exists "${REPO_ROOT}/Cargo.toml" "Rust workspace"
check_file_exists "${REPO_ROOT}/packages/dashboard/package.json" "Dashboard package"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 6: Environment Variables
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[6] Environment Configuration${NC}"

check_env_var() {
    local var_name="$1"
    local expected="${2:-}"
    
    if [ -n "${!var_name:-}" ]; then
        if [ -n "$expected" ] && [ "${!var_name}" = "$expected" ]; then
            check_status "$var_name set correctly" "PASS" "${!var_name}"
        elif [ -n "$expected" ]; then
            check_status "$var_name set correctly" "FAIL" "Expected: $expected, Got: ${!var_name}"
        else
            check_status "$var_name is set" "PASS" "${!var_name}"
        fi
    else
        check_status "$var_name is set" "FAIL" "Variable not set"
    fi
}

check_env_var "AETHERCORE_DEV_MODE" "true" || true
check_env_var "RUST_LOG" || true
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 7: Build Artifacts
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[7] Build Artifacts${NC}"

if [ -d "${REPO_ROOT}/target/debug" ]; then
    check_status "Rust build artifacts present" "PASS" "target/debug/ exists"
else
    check_status "Rust build artifacts present" "FAIL" "Run 'cargo build' first"
fi

if [ -d "${REPO_ROOT}/packages/dashboard/dist" ]; then
    check_status "Dashboard build artifacts present" "PASS" "dist/ exists"
elif [ -d "${REPO_ROOT}/packages/dashboard/src" ]; then
    check_status "Dashboard build artifacts present" "FAIL" "Run 'pnpm build' or use 'pnpm tauri dev'"
else
    check_status "Dashboard source code present" "FAIL" "Dashboard source not found"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Check 8: Database
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[8] Database${NC}"

if [ -n "${DATABASE_URL:-}" ]; then
    check_status "DATABASE_URL configured" "PASS" "$DATABASE_URL"
    
    # Check if SQLite database exists
    if echo "$DATABASE_URL" | grep -q "sqlite"; then
        DB_PATH=$(echo "$DATABASE_URL" | sed 's/sqlite:\/\///')
        if [ -f "$DB_PATH" ]; then
            check_status "SQLite database file exists" "PASS" "$DB_PATH"
        else
            check_status "SQLite database file exists" "FAIL" "Will be created on first run"
        fi
    fi
else
    check_status "DATABASE_URL configured" "FAIL" "Not set"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                     Health Check Summary                  ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo "  Total Checks:  $TOTAL_CHECKS"
echo -e "  ${GREEN}Passed:        $PASSED_CHECKS${NC}"

if [ $FAILED_CHECKS -gt 0 ]; then
    echo -e "  ${RED}Failed:        $FAILED_CHECKS${NC}"
else
    echo -e "  ${GREEN}Failed:        $FAILED_CHECKS${NC}"
fi

echo ""

# Final status
if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo -e "${CYAN}Your testing deployment is healthy and ready to use.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Open browser to http://localhost:8080"
    echo "  2. Follow test scenarios in TESTING_DEPLOYMENT.md"
    echo "  3. Run integration tests: cargo test"
    echo ""
    exit 0
else
    echo -e "${YELLOW}⚠ Some checks failed${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "  1. Check if services are running: docker-compose ps"
    echo "  2. View logs: docker-compose logs"
    echo "  3. Review TESTING_DEPLOYMENT.md troubleshooting section"
    echo "  4. Ensure all prerequisites are installed"
    echo ""
    exit 1
fi
