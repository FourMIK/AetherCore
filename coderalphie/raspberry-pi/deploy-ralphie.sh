#!/bin/bash
#
# deploy-ralphie.sh - CodeRalphie Service Deployment
# 
# Deploys CodeRalphie as a systemd service with auto-restart.
# Philosophy: "Resilient by Design" - Always operational.
#
# Usage: sudo ./deploy-ralphie.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

echo "=== CODERALPHIE DEPLOYMENT ==="
echo "Installing CodeRalphie edge node service..."
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "ERROR: This script must be run as root (use sudo)"
  exit 1
fi

# Configuration
INSTALL_DIR="/opt/coderalphie"
SERVICE_USER="${SERVICE_USER:-ralphie}"
ENROLLMENT_URL="${ENROLLMENT_URL:-https://c2.aethercore.local:3000/api/enrollment}"
AETHERCORE_PRODUCTION="${AETHERCORE_PRODUCTION:-0}"

echo "[1/5] Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/false -d $INSTALL_DIR -M $SERVICE_USER
  echo "[1/5] ✓ User '$SERVICE_USER' created"
else
  echo "[1/5] ✓ User '$SERVICE_USER' already exists"
fi

echo "[2/5] Installing CodeRalphie application..."
# In production, this would copy the built application
# For now, create placeholder structure
mkdir -p $INSTALL_DIR/bin
mkdir -p $INSTALL_DIR/config
mkdir -p $INSTALL_DIR/node_modules

# Copy application files (assumes they're in current directory)
if [ -f "./coderalphie" ]; then
  cp ./coderalphie $INSTALL_DIR/bin/
  chmod +x $INSTALL_DIR/bin/coderalphie
  echo "[2/5] ✓ CodeRalphie binary installed"
elif [ -d "../dist" ]; then
  cp -r ../dist/* $INSTALL_DIR/
  echo "[2/5] ✓ CodeRalphie application files copied"
else
  echo "[2/5] ⚠ No build artifacts found. Service will need manual installation."
fi

# Set ownership
chown -R $SERVICE_USER:$SERVICE_USER $INSTALL_DIR

echo "[3/5] Creating systemd service unit..."

cat > /etc/systemd/system/coderalphie.service <<EOF
[Unit]
Description=CodeRalphie Edge Node
Documentation=https://github.com/FourMIK/AetherCore
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR

# Environment variables
Environment="NODE_ENV=production"
Environment="ENROLLMENT_URL=$ENROLLMENT_URL"
Environment="AETHERCORE_PRODUCTION=$AETHERCORE_PRODUCTION"

# Execution
ExecStart=/usr/bin/node $INSTALL_DIR/index.js
ExecReload=/bin/kill -HUP \$MAINPID

# Restart policy - Always restart on failure
Restart=always
RestartSec=5s
StartLimitInterval=0

# Process limits
LimitNOFILE=65535
LimitNPROC=4096

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/ralphie /var/log/coderalphie

# TPM device access
DeviceAllow=/dev/tpm0 rw
DeviceAllow=/dev/tpmrm0 rw

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=coderalphie

[Install]
WantedBy=multi-user.target
EOF

echo "[3/5] ✓ Systemd service unit created"

echo "[4/5] Enabling and starting service..."
systemctl daemon-reload
systemctl enable coderalphie.service
systemctl start coderalphie.service

echo "[4/5] ✓ Service enabled and started"

echo "[5/5] Verifying service status..."
sleep 2
if systemctl is-active --quiet coderalphie.service; then
  echo "[5/5] ✓ Service is running"
else
  echo "[5/5] ⚠ Service failed to start. Check logs with: journalctl -u coderalphie -f"
fi

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo ""
echo "Service Information:"
echo "  Name: coderalphie.service"
echo "  User: $SERVICE_USER"
echo "  Install Dir: $INSTALL_DIR"
echo "  Restart Policy: Always (5s delay)"
echo ""
echo "Commands:"
echo "  Status:  systemctl status coderalphie"
echo "  Logs:    journalctl -u coderalphie -f"
echo "  Stop:    sudo systemctl stop coderalphie"
echo "  Start:   sudo systemctl start coderalphie"
echo "  Restart: sudo systemctl restart coderalphie"
echo ""
echo "Environment:"
echo "  ENROLLMENT_URL: $ENROLLMENT_URL"
echo "  AETHERCORE_PRODUCTION: $AETHERCORE_PRODUCTION"
echo ""
echo "The service will automatically:"
echo "  ✓ Start on boot"
echo "  ✓ Restart on failure (5s delay)"
echo "  ✓ Log to systemd journal"
echo ""
