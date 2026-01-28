#!/bin/bash
###############################################################################
# CodeRalphie Installation Script - "The Infection"
# 
# Deploys CodeRalphie agent on Raspberry Pi via SSH injection.
# Establishes hardware-rooted trust for edge node operations.
# 
# Philosophy: Zero-Touch, Hardware-Rooted, Fail-Visible
###############################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         CODERALPHIE INSTALLATION - THE INFECTION               ║"
echo "║         Hardware-Rooted Trust Deployment                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}ERROR: This script must be run as root (use sudo)${NC}"
  exit 1
fi

# Configuration
BINARY_NAME="coderalphie-linux-arm64"
INSTALL_DIR="/usr/local/bin"
INSTALL_PATH="${INSTALL_DIR}/coderalphie"
KEYS_DIR="/etc/coderalphie/keys"
CONFIG_DIR="/etc/coderalphie"
SERVICE_NAME="coderalphie.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
USER_NAME="ralphie"
USER_HOME="/opt/coderalphie"

echo "[Install] Step 1/7: Checking for existing CodeRalphie installation..."
if [ -f "${INSTALL_PATH}" ]; then
  echo -e "${YELLOW}[Install] Existing installation found. Stopping service...${NC}"
  systemctl stop ${SERVICE_NAME} 2>/dev/null || true
fi

echo "[Install] Step 2/7: Creating ralphie user (non-root)..."
if ! id -u ${USER_NAME} >/dev/null 2>&1; then
  useradd --system --home ${USER_HOME} --shell /usr/sbin/nologin --comment "CodeRalphie Agent" ${USER_NAME}
  echo -e "${GREEN}[Install] User '${USER_NAME}' created${NC}"
else
  echo "[Install] User '${USER_NAME}' already exists"
fi

# Ensure home directory exists
mkdir -p ${USER_HOME}
chown ${USER_NAME}:${USER_NAME} ${USER_HOME}
chmod 750 ${USER_HOME}

echo "[Install] Step 3/7: Installing CodeRalphie binary..."
# Check if binary exists in current directory
if [ ! -f "./${BINARY_NAME}" ]; then
  echo -e "${RED}ERROR: Binary '${BINARY_NAME}' not found in current directory${NC}"
  exit 1
fi

# Copy binary to system path
cp "./${BINARY_NAME}" "${INSTALL_PATH}"
chmod 755 "${INSTALL_PATH}"
chown root:root "${INSTALL_PATH}"
echo -e "${GREEN}[Install] Binary installed to ${INSTALL_PATH}${NC}"

echo "[Install] Step 4/7: Creating configuration directories..."
mkdir -p ${CONFIG_DIR}
mkdir -p ${KEYS_DIR}
chown root:root ${CONFIG_DIR}
chmod 755 ${CONFIG_DIR}

# Keys directory must be owned by ralphie user with strict permissions
chown ${USER_NAME}:${USER_NAME} ${KEYS_DIR}
chmod 700 ${KEYS_DIR}
echo -e "${GREEN}[Install] Keys directory: ${KEYS_DIR} (chmod 700, owner: ${USER_NAME})${NC}"

echo "[Install] Step 5/7: Creating systemd service..."
cat > ${SERVICE_PATH} << 'EOF'
[Unit]
Description=CodeRalphie Edge Node Agent
Documentation=https://github.com/FourMIK/AetherCore
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=500
StartLimitBurst=5

[Service]
Type=simple
User=ralphie
Group=ralphie
Restart=on-failure
RestartSec=5s

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/coderalphie
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true

# Environment
Environment="NODE_ENV=production"
Environment="AETHERCORE_PRODUCTION=1"

# Execution
ExecStart=/usr/local/bin/coderalphie
WorkingDirectory=/opt/coderalphie

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=coderalphie

[Install]
WantedBy=multi-user.target
EOF

chmod 644 ${SERVICE_PATH}
echo -e "${GREEN}[Install] Service file created: ${SERVICE_PATH}${NC}"

echo "[Install] Step 6/7: Generating identity (--genesis mode)..."
# Run genesis mode as ralphie user to generate keys
echo "[Install] Executing: sudo -u ${USER_NAME} ${INSTALL_PATH} --genesis"

# Capture output including IdentityBlock JSON
GENESIS_OUTPUT=$(sudo -u ${USER_NAME} ${INSTALL_PATH} --genesis 2>&1)
echo "${GENESIS_OUTPUT}"

# Extract IdentityBlock JSON and output to stdout
IDENTITY_JSON=$(echo "${GENESIS_OUTPUT}" | sed -n '/=== IDENTITY_BLOCK_START ===/,/=== IDENTITY_BLOCK_END ===/p' | grep -v "=== IDENTITY_BLOCK")

if [ -z "${IDENTITY_JSON}" ]; then
  echo -e "${RED}[Install] ERROR: Failed to capture IdentityBlock JSON${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}[Install] ✓ Identity generated successfully${NC}"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "         IDENTITY BLOCK - CAPTURE FOR DASHBOARD"
echo "════════════════════════════════════════════════════════════════"
echo "${IDENTITY_JSON}"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Verify key permissions
IDENTITY_FILE="${KEYS_DIR}/identity.json"
if [ -f "${IDENTITY_FILE}" ]; then
  PERMS=$(stat -c "%a" "${IDENTITY_FILE}")
  OWNER=$(stat -c "%U" "${IDENTITY_FILE}")
  
  if [ "${PERMS}" != "600" ]; then
    echo -e "${RED}[Install] ERROR: Identity file has incorrect permissions: ${PERMS}${NC}"
    exit 1
  fi
  
  if [ "${OWNER}" != "${USER_NAME}" ]; then
    echo -e "${RED}[Install] ERROR: Identity file has incorrect owner: ${OWNER}${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}[Install] ✓ Key permissions verified (600, owner: ${USER_NAME})${NC}"
else
  echo -e "${RED}[Install] ERROR: Identity file not found: ${IDENTITY_FILE}${NC}"
  exit 1
fi

echo "[Install] Step 7/7: Enabling and starting service..."
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}

# Check service status
sleep 2
if systemctl is-active --quiet ${SERVICE_NAME}; then
  echo -e "${GREEN}[Install] ✓ Service started successfully${NC}"
else
  echo -e "${RED}[Install] ERROR: Service failed to start${NC}"
  echo "[Install] Service status:"
  systemctl status ${SERVICE_NAME} --no-pager || true
  exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              CODERALPHIE INSTALLATION COMPLETE                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Installation Summary:"
echo "  • Binary: ${INSTALL_PATH}"
echo "  • Service: ${SERVICE_NAME}"
echo "  • User: ${USER_NAME} (non-root)"
echo "  • Keys: ${KEYS_DIR} (chmod 700)"
echo "  • Status: $(systemctl is-active ${SERVICE_NAME})"
echo ""
echo "Service Commands:"
echo "  • Status:  systemctl status ${SERVICE_NAME}"
echo "  • Stop:    systemctl stop ${SERVICE_NAME}"
echo "  • Restart: systemctl restart ${SERVICE_NAME}"
echo "  • Logs:    journalctl -u ${SERVICE_NAME} -f"
echo ""
echo -e "${GREEN}CodeRalphie is now operational and hardware-rooted.${NC}"
echo ""
