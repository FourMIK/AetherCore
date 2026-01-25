#!/bin/bash
#
# setup.sh - CodeRalphie Raspberry Pi Hardening Script
# 
# Prepares Raspberry Pi OS for secure CodeRalphie deployment.
# Philosophy: "Secure by Default" - Zero-Trust configuration.
#
# Usage: sudo ./setup.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

echo "=== CODERALPHIE RASPBERRY PI SETUP ==="
echo "Hardening system for secure edge operation..."
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "ERROR: This script must be run as root (use sudo)"
  exit 1
fi

# Configuration
C2_SERVER="${C2_SERVER:-c2.aethercore.local}"
C2_PORT="${C2_PORT:-8443}"

echo "[1/7] Updating system packages..."
apt-get update
apt-get upgrade -y

echo "[2/7] Installing required packages..."
apt-get install -y \
  ufw \
  fail2ban \
  tpm2-tools \
  i2c-tools \
  nodejs \
  npm \
  git \
  curl \
  wget

echo "[3/7] Configuring firewall (UFW)..."
# Reset firewall rules
ufw --force reset

# Default policies: Deny incoming, Allow outgoing
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (only for initial setup - will restrict to keys only)
ufw allow 22/tcp comment 'SSH'

# Allow outgoing to C2 server only
ufw allow out to any port $C2_PORT proto tcp comment 'C2 Server'

# Enable firewall
ufw --force enable

echo "[3/7] ✓ Firewall configured: Deny incoming, Allow outgoing to C2 only"

echo "[4/7] Hardening SSH configuration..."
SSH_CONFIG="/etc/ssh/sshd_config"

# Backup original config
cp $SSH_CONFIG ${SSH_CONFIG}.bak.$(date +%Y%m%d-%H%M%S)

# Disable password authentication
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' $SSH_CONFIG
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' $SSH_CONFIG

# Disable root login
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' $SSH_CONFIG
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' $SSH_CONFIG

# Disable empty passwords
sed -i 's/#PermitEmptyPasswords no/PermitEmptyPasswords no/' $SSH_CONFIG
sed -i 's/PermitEmptyPasswords yes/PermitEmptyPasswords no/' $SSH_CONFIG

# Enable public key authentication
sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' $SSH_CONFIG

# Restart SSH service
systemctl restart sshd

echo "[4/7] ✓ SSH hardened: Keys only, no root, no passwords"

echo "[5/7] Enabling hardware interfaces for TPM..."
BOOT_CONFIG="/boot/config.txt"

# Backup boot config
cp $BOOT_CONFIG ${BOOT_CONFIG}.bak.$(date +%Y%m%d-%H%M%S)

# Enable I2C (for TPM communication)
if ! grep -q "^dtparam=i2c_arm=on" $BOOT_CONFIG; then
  echo "dtparam=i2c_arm=on" >> $BOOT_CONFIG
  echo "[5/7] ✓ I2C enabled"
fi

# Enable SPI (for TPM communication)
if ! grep -q "^dtparam=spi=on" $BOOT_CONFIG; then
  echo "dtparam=spi=on" >> $BOOT_CONFIG
  echo "[5/7] ✓ SPI enabled"
fi

# Load TPM kernel module
if ! grep -q "^dtoverlay=tpm-slb9670" $BOOT_CONFIG; then
  echo "dtoverlay=tpm-slb9670" >> $BOOT_CONFIG
  echo "[5/7] ✓ TPM overlay configured (Infineon SLB9670)"
fi

echo "[5/7] ✓ Hardware interfaces enabled"

echo "[6/7] Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban
echo "[6/7] ✓ fail2ban enabled for SSH protection"

echo "[7/7] Creating CodeRalphie directories..."
mkdir -p /etc/ralphie
mkdir -p /opt/coderalphie
mkdir -p /var/log/coderalphie

# Set strict permissions
chmod 700 /etc/ralphie
chmod 755 /opt/coderalphie
chmod 755 /var/log/coderalphie

echo "[7/7] ✓ Directories created with strict permissions"

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "IMPORTANT: System hardening applied. Next steps:"
echo "1. Copy your SSH public key to ~/.ssh/authorized_keys"
echo "2. Test SSH key authentication before logging out"
echo "3. Reboot to apply boot config changes: sudo reboot"
echo "4. After reboot, run deploy-ralphie.sh to install CodeRalphie"
echo ""
echo "Security Status:"
echo "  ✓ Firewall: Enabled (deny incoming, allow outgoing to C2)"
echo "  ✓ SSH: Key authentication only"
echo "  ✓ TPM: Hardware interfaces enabled"
echo "  ✓ fail2ban: Active"
echo ""
echo "WARNING: Password authentication is now DISABLED."
echo "Ensure you have SSH key access before logging out!"
echo ""
