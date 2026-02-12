#!/bin/bash
# AetherCore Testing Release Package Creator
# Purpose: Bundle all necessary files for testing team
# Classification: TEST & EVALUATION

set -euo pipefail

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║    AetherCore Testing Release Package Creator             ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Configuration
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-0.1.0-alpha}"
PACKAGE_NAME="aethercore-testing-${VERSION}"
PACKAGE_DIR="${REPO_ROOT}/dist/${PACKAGE_NAME}"
ARCHIVE_FILE="${REPO_ROOT}/dist/${PACKAGE_NAME}.tar.gz"

cd "$REPO_ROOT"

echo -e "${BLUE}Creating testing package: ${PACKAGE_NAME}${NC}"
echo ""

# Clean and create package directory
rm -rf "$PACKAGE_DIR" "$ARCHIVE_FILE"
mkdir -p "$PACKAGE_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Copy essential files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[1/7] Copying documentation...${NC}"

# Core documentation
cp README.md "$PACKAGE_DIR/"
cp LICENSE "$PACKAGE_DIR/"
cp ARCHITECTURE.md "$PACKAGE_DIR/"
cp SECURITY.md "$PACKAGE_DIR/"
cp INSTALLATION.md "$PACKAGE_DIR/"

# Testing-specific docs
cp TESTING_DEPLOYMENT.md "$PACKAGE_DIR/"
cp QUICKSTART_TESTING.md "$PACKAGE_DIR/"
cp DEPLOYMENT_PRODUCTION.md "$PACKAGE_DIR/" # For reference

echo -e "${GREEN}  ✓${NC} Documentation copied"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Copy configuration files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[2/7] Copying configuration files...${NC}"

mkdir -p "$PACKAGE_DIR/config"
cp -r config/* "$PACKAGE_DIR/config/"

# Create sample .env file
cat > "$PACKAGE_DIR/.env.example" << 'EOF'
# AetherCore Testing Environment Configuration
# Copy this file to .env and customize as needed

# Environment
AETHERCORE_ENV=testing
AETHERCORE_DEV_MODE=true

# Logging
RUST_LOG=debug
RUST_BACKTRACE=1

# Database
DATABASE_URL=sqlite://data/testing.db

# Ports
AETHERCORE_PORT=8080
AETHERCORE_WS_PORT=8080

# Test Identity (optional)
# AETHERCORE_OPERATOR_ID=test-operator-001
# AETHERCORE_SQUAD_ID=test-squad-alpha
EOF

echo -e "${GREEN}  ✓${NC} Configuration files copied"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Copy scripts
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[3/7] Copying deployment scripts...${NC}"

mkdir -p "$PACKAGE_DIR/scripts"

# Essential testing scripts
cp scripts/deploy-testing.sh "$PACKAGE_DIR/scripts/"
cp scripts/test-deployment-health.sh "$PACKAGE_DIR/scripts/"
cp scripts/generate-test-identity.sh "$PACKAGE_DIR/scripts/"

# Make scripts executable
chmod +x "$PACKAGE_DIR/scripts/"*.sh

echo -e "${GREEN}  ✓${NC} Scripts copied and made executable"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Copy Docker files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[4/7] Copying Docker configuration...${NC}"

mkdir -p "$PACKAGE_DIR/docker"
cp -r docker/* "$PACKAGE_DIR/docker/"
cp Dockerfile "$PACKAGE_DIR/" 2>/dev/null || true

# Create simple docker-compose for testing
cat > "$PACKAGE_DIR/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  dashboard:
    build:
      context: .
      dockerfile: docker/Dockerfile.dashboard
    ports:
      - "8080:8080"
    environment:
      - REACT_APP_API_URL=http://localhost:8080/api
      - REACT_APP_WS_URL=ws://localhost:8080/ws
      - REACT_APP_TPM_ENABLED=false
    volumes:
      - ./logs:/var/log/aethercore
      - ./data:/var/lib/aethercore
    restart: unless-stopped

networks:
  default:
    name: aethercore-test
EOF

echo -e "${GREEN}  ✓${NC} Docker configuration copied"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Copy source code (for local builds)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[5/7] Copying source code...${NC}"

# Cargo workspace
cp Cargo.toml "$PACKAGE_DIR/"
cp Cargo.lock "$PACKAGE_DIR/"

# Rust crates
mkdir -p "$PACKAGE_DIR/crates"
cp -r crates/* "$PACKAGE_DIR/crates/"

# Services
mkdir -p "$PACKAGE_DIR/services"
cp -r services/* "$PACKAGE_DIR/services/"

# Dashboard
mkdir -p "$PACKAGE_DIR/packages"
cp -r packages/dashboard "$PACKAGE_DIR/packages/"

# Node.js workspace files
cp package.json "$PACKAGE_DIR/"
cp package-lock.json "$PACKAGE_DIR/" 2>/dev/null || true
cp pnpm-workspace.yaml "$PACKAGE_DIR/" 2>/dev/null || true

echo -e "${GREEN}  ✓${NC} Source code copied"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Create README for the package
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[6/7] Creating package README...${NC}"

cat > "$PACKAGE_DIR/START_HERE.md" << EOF
# AetherCore Testing Package

**Version:** ${VERSION}  
**Package Date:** $(date +%Y-%m-%d)  
**Purpose:** Complete testing deployment package

---

## 🎯 Quick Start

1. **Read First:** [QUICKSTART_TESTING.md](QUICKSTART_TESTING.md)
2. **Deploy:** Run \`./scripts/deploy-testing.sh\`
3. **Verify:** Run \`./scripts/test-deployment-health.sh\`
4. **Test:** Follow scenarios in [TESTING_DEPLOYMENT.md](TESTING_DEPLOYMENT.md)

---

## 📦 Package Contents

### Documentation
- **START_HERE.md** - This file
- **QUICKSTART_TESTING.md** - 5-minute quick start guide
- **TESTING_DEPLOYMENT.md** - Complete testing guide
- **README.md** - Project overview
- **ARCHITECTURE.md** - System architecture
- **SECURITY.md** - Security guidelines
- **INSTALLATION.md** - Installation procedures
- **DEPLOYMENT_PRODUCTION.md** - Production deployment reference

### Scripts
- **scripts/deploy-testing.sh** - Automated deployment
- **scripts/test-deployment-health.sh** - Health checks
- **scripts/generate-test-identity.sh** - Identity generator

### Configuration
- **config/** - Configuration files
- **.env.example** - Environment variable template
- **docker-compose.yml** - Docker deployment

### Source Code
- **crates/** - Rust crates
- **services/** - Backend services
- **packages/dashboard/** - Tactical Glass UI
- **Cargo.toml** - Rust workspace
- **package.json** - Node.js workspace

---

## 🚀 Two Ways to Deploy

### Option A: Docker (Recommended)
\`\`\`bash
docker-compose up -d
./scripts/test-deployment-health.sh
\`\`\`

### Option B: Local Build
\`\`\`bash
./scripts/deploy-testing.sh
# Follow interactive prompts
\`\`\`

---

## 📋 Prerequisites

- Docker 24.0+ and Docker Compose 2.20+
- OR: Rust 1.75+, Node.js 20+, pnpm
- 8GB RAM minimum
- Port 8080 available

---

## ✅ Verify Installation

\`\`\`bash
# Run health checks
./scripts/test-deployment-health.sh

# Access dashboard
open http://localhost:8080

# Check API
curl http://localhost:8080/api/health
\`\`\`

---

## 📝 Testing Workflow

1. Deploy using either Docker or local build
2. Run health checks to verify deployment
3. Access dashboard at http://localhost:8080
4. Generate test identity: \`./scripts/generate-test-identity.sh\`
5. Follow test scenarios in TESTING_DEPLOYMENT.md
6. Report issues on GitHub

---

## 🔐 Security Notes

This is a **TESTING** package with DEV MODE enabled:
- TPM validation disabled
- HTTP/WS instead of HTTPS/WSS
- Test identities with plaintext keys
- SQLite instead of PostgreSQL

⚠️ **Do NOT use in production!**

---

## 📞 Support

- **Documentation:** See included .md files
- **Issues:** https://github.com/FourMIK/AetherCore/issues
- **Email:** testing@example.com

---

## 🧹 Cleanup

\`\`\`bash
# Stop services
docker-compose down

# Remove data
rm -rf data/ logs/ deployments/
\`\`\`

---

**Ready to start? Open [QUICKSTART_TESTING.md](QUICKSTART_TESTING.md)**
EOF

echo -e "${GREEN}  ✓${NC} Package README created"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Create archive
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo -e "${BLUE}[7/7] Creating archive...${NC}"

cd "${REPO_ROOT}/dist"
tar czf "$ARCHIVE_FILE" "$PACKAGE_NAME"

ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)

echo -e "${GREEN}  ✓${NC} Archive created: $ARCHIVE_FILE"
echo -e "  ${CYAN}Size:${NC} $ARCHIVE_SIZE"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Generate checksums
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${BLUE}Generating checksums...${NC}"

SHA256SUM=$(sha256sum "$ARCHIVE_FILE" | cut -d' ' -f1)

cat > "${REPO_ROOT}/dist/${PACKAGE_NAME}.sha256" << EOF
${SHA256SUM}  ${PACKAGE_NAME}.tar.gz
EOF

echo -e "${GREEN}  ✓${NC} SHA256: $SHA256SUM"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Create release notes
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
cat > "${REPO_ROOT}/dist/${PACKAGE_NAME}-RELEASE_NOTES.md" << EOF
# AetherCore Testing Release ${VERSION}

**Release Date:** $(date +%Y-%m-%d)  
**Package Type:** Testing & Evaluation  
**Classification:** Alpha Release

---

## 📦 Package Information

- **File:** ${PACKAGE_NAME}.tar.gz
- **Size:** ${ARCHIVE_SIZE}
- **SHA256:** ${SHA256SUM}

---

## 🎯 What's Included

This testing package contains everything needed to deploy and test AetherCore:

### Complete Documentation
- Quick start guide (5-minute setup)
- Full testing deployment guide
- Architecture overview
- Security guidelines
- Troubleshooting guides

### Deployment Tools
- Automated deployment script
- Health check validation script
- Test identity generator
- Docker configuration
- Environment templates

### Source Code
- All Rust crates and services
- Tactical Glass dashboard
- Integration tests
- Configuration files

---

## 🚀 Quick Start

\`\`\`bash
# Extract package
tar xzf ${PACKAGE_NAME}.tar.gz
cd ${PACKAGE_NAME}

# Read the quick start
cat QUICKSTART_TESTING.md

# Deploy
./scripts/deploy-testing.sh
\`\`\`

---

## 📋 System Requirements

**Minimum:**
- 4-core CPU @ 2.5 GHz
- 8GB RAM
- 50GB storage
- Ubuntu 20.04+, macOS 11+, or Windows 10+

**Software:**
- Docker 24.0+ with Docker Compose 2.20+
- OR: Rust 1.75+, Node.js 20+, pnpm

---

## ✨ Key Features Being Tested

1. **Hardware-Rooted Identity** - Ed25519 signatures (dev mode)
2. **Merkle Vine Integrity** - Historical data anchoring
3. **Aetheric Sweep** - Byzantine node detection
4. **Tactical Glass** - GPU-accelerated dashboard
5. **Fail-Visible Mode** - Unverified data flagging

---

## 🔐 Security Configuration

**Testing Mode Enabled:**
- TPM validation disabled for compatibility
- Dev mode keys (not hardware-backed)
- HTTP/WS transport (not HTTPS/WSS)
- SQLite database (not PostgreSQL)

⚠️ **This configuration is for testing only!**

See DEPLOYMENT_PRODUCTION.md for production guidelines.

---

## ✅ Test Scenarios Included

1. Basic node connection
2. Identity & signature verification
3. Merkle Vine integrity validation
4. Byzantine node detection
5. Fail-visible mode verification

Full test procedures in TESTING_DEPLOYMENT.md.

---

## 🐛 Known Issues

- Dashboard may show "DEV MODE" banner (expected)
- TPM attestation skipped in testing mode (expected)
- First build takes 10-15 minutes (Rust compilation)

---

## 📞 Support & Feedback

- **GitHub Issues:** https://github.com/FourMIK/AetherCore/issues
- **Documentation:** See included .md files
- **Email:** testing@example.com

---

## 📊 Testing Checklist

- [ ] Extract and verify package
- [ ] Review QUICKSTART_TESTING.md
- [ ] Run deployment script
- [ ] Execute health checks
- [ ] Access dashboard at http://localhost:8080
- [ ] Generate test identity
- [ ] Complete test scenarios
- [ ] Document findings
- [ ] Report issues

---

## 🔄 Version History

### 0.1.0-alpha (Current)
- Initial testing release
- Complete deployment automation
- 5 test scenarios included
- Docker and local build support

---

## 📝 Next Steps

1. **Extract** the package
2. **Read** START_HERE.md
3. **Deploy** using provided scripts
4. **Test** following the guide
5. **Report** your findings

---

**Package verified and ready for distribution.**

For detailed information, see documentation files in the package.
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${GREEN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║         Testing Package Created Successfully!             ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

echo -e "${CYAN}Package Details:${NC}"
echo "  Name:     ${PACKAGE_NAME}"
echo "  Location: ${REPO_ROOT}/dist/"
echo "  Size:     ${ARCHIVE_SIZE}"
echo ""

echo -e "${CYAN}Files Created:${NC}"
echo "  📦 ${PACKAGE_NAME}.tar.gz"
echo "  🔐 ${PACKAGE_NAME}.sha256"
echo "  📝 ${PACKAGE_NAME}-RELEASE_NOTES.md"
echo ""

echo -e "${CYAN}Package Contents:${NC}"
echo "  ✓ Complete documentation"
echo "  ✓ Deployment scripts"
echo "  ✓ Source code"
echo "  ✓ Configuration files"
echo "  ✓ Docker setup"
echo "  ✓ Test utilities"
echo ""

echo -e "${CYAN}Distribution:${NC}"
echo "  1. Send ${PACKAGE_NAME}.tar.gz to testing team"
echo "  2. Include ${PACKAGE_NAME}.sha256 for verification"
echo "  3. Share ${PACKAGE_NAME}-RELEASE_NOTES.md"
echo ""

echo -e "${CYAN}Verification Command:${NC}"
echo "  sha256sum -c ${PACKAGE_NAME}.sha256"
echo ""

echo -e "${GREEN}Ready to distribute to testing team! 🚀${NC}"
echo ""
