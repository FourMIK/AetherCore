#!/bin/bash
# AetherCore Tactical Glass TLS Certificate Generator
# Generates self-signed certificates for bunker mode deployment
#
# Security Note: This generates self-signed certificates for air-gapped environments.
# For production with external PKI, replace with your CA-signed certificates.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="${1:-/mnt/nvme/aethercore/certs}"
DAYS_VALID="${2:-3650}"  # 10 years default

echo "=========================================="
echo "AetherCore Tactical Glass TLS Generator"
echo "=========================================="
echo "Certificate directory: ${CERT_DIR}"
echo "Validity period:       ${DAYS_VALID} days"
echo "=========================================="
echo ""

# Create certificate directory if it doesn't exist
mkdir -p "${CERT_DIR}"

# Check for existing certificates
if [ -f "${CERT_DIR}/tactical-glass.crt" ] && [ -f "${CERT_DIR}/tactical-glass.key" ]; then
    echo "WARNING: Certificates already exist in ${CERT_DIR}"
    echo ""
    echo "Existing certificates:"
    ls -lh "${CERT_DIR}/tactical-glass."*
    echo ""
    read -p "Overwrite existing certificates? (yes/NO): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Keeping existing certificates. Exiting."
        exit 0
    fi
    echo ""
fi

# Check for OpenSSL
if ! command -v openssl &> /dev/null; then
    echo "ERROR: OpenSSL not found. Install with:"
    echo "  apt-get install openssl"
    echo "  yum install openssl"
    exit 1
fi

echo "✓ OpenSSL found: $(openssl version)"
echo ""

# Generate certificate configuration
CONFIG_FILE="${CERT_DIR}/tactical-glass.cnf"
cat > "${CONFIG_FILE}" <<EOF
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = US
ST = CONUS
L = Tactical
O = AetherCore
OU = Mission Systems
CN = tactical-glass.local
emailAddress = ops@aethercore.local

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment, keyAgreement
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names
basicConstraints = critical, CA:FALSE

[alt_names]
DNS.1 = tactical-glass.local
DNS.2 = localhost
DNS.3 = *.tactical-glass.local
IP.1 = 127.0.0.1
IP.2 = 10.0.0.1
EOF

echo "Generating RSA 4096-bit private key..."
openssl genrsa -out "${CERT_DIR}/tactical-glass.key" 4096 2>/dev/null

echo "Generating self-signed certificate..."
openssl req \
    -new \
    -x509 \
    -key "${CERT_DIR}/tactical-glass.key" \
    -out "${CERT_DIR}/tactical-glass.crt" \
    -days "${DAYS_VALID}" \
    -config "${CONFIG_FILE}" \
    2>/dev/null

# Set restrictive permissions
chmod 600 "${CERT_DIR}/tactical-glass.key"
chmod 644 "${CERT_DIR}/tactical-glass.crt"

# Generate DH parameters for enhanced security (optional, takes time)
# Uncomment if you need stronger ephemeral key exchange
# echo "Generating DH parameters (2048-bit, this may take several minutes)..."
# openssl dhparam -out "${CERT_DIR}/dhparam.pem" 2048 2>/dev/null
# chmod 644 "${CERT_DIR}/dhparam.pem"

# Clean up config file
rm -f "${CONFIG_FILE}"

echo ""
echo "=========================================="
echo "✓ Certificate Generation Complete"
echo "=========================================="
echo ""
echo "Generated files:"
ls -lh "${CERT_DIR}/tactical-glass."*
echo ""

# Display certificate info
echo "Certificate details:"
openssl x509 -in "${CERT_DIR}/tactical-glass.crt" -noout -subject -issuer -dates
echo ""

echo "Subject Alternative Names (SANs):"
openssl x509 -in "${CERT_DIR}/tactical-glass.crt" -noout -text | grep -A1 "Subject Alternative Name"
echo ""

# Fingerprints for verification
echo "Certificate fingerprints:"
echo "  SHA-256: $(openssl x509 -in "${CERT_DIR}/tactical-glass.crt" -noout -fingerprint -sha256 | cut -d= -f2)"
echo "  SHA-1:   $(openssl x509 -in "${CERT_DIR}/tactical-glass.crt" -noout -fingerprint -sha1 | cut -d= -f2)"
echo ""

echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo "1. Verify the certificate details above match your environment"
echo "2. Deploy certificates to Nginx container volume"
echo "3. Configure operators to trust the self-signed CA"
echo "4. For trusted chain, replace with CA-signed certificates"
echo ""
echo "Installation:"
echo "  # Add to operator workstations:"
echo "  sudo cp ${CERT_DIR}/tactical-glass.crt /usr/local/share/ca-certificates/"
echo "  sudo update-ca-certificates"
echo ""
echo "  # Or for browsers, import tactical-glass.crt to Trusted Root CA store"
echo ""
echo "Security Note:"
echo "  Private key at ${CERT_DIR}/tactical-glass.key"
echo "  Ensure this directory has restricted permissions (0700)"
echo "  Backup this key to secure offline storage"
echo ""
