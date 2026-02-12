#!/bin/bash
# AetherCore Test Identity Generator
# Purpose: Generate Ed25519 test identities for testing team
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
echo "║       AetherCore Test Identity Generator                  ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${REPO_ROOT}/deployments/testing/identities"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Get parameters
OPERATOR_ID="${1:-test-operator-$(date +%s)}"
SQUAD_ID="${2:-test-squad-alpha}"
OUTPUT_FILE="${OUTPUT_DIR}/${OPERATOR_ID}.json"

echo -e "${BLUE}Generating test identity...${NC}"
echo ""
echo "  Operator ID: $OPERATOR_ID"
echo "  Squad ID:    $SQUAD_ID"
echo "  Output:      $OUTPUT_FILE"
echo ""

# Generate identity using Node.js crypto
cat > /tmp/generate-identity.js << 'EOFJS'
const crypto = require('crypto');
const fs = require('fs');

// Get parameters from args
const operatorId = process.argv[2];
const squadId = process.argv[3];
const outputFile = process.argv[4];

// Generate Ed25519 key pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
        type: 'spki',
        format: 'der'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'der'
    }
});

// Convert to base64 for storage
const publicKeyB64 = publicKey.toString('base64');
const privateKeyB64 = privateKey.toString('base64');

// Extract raw 32-byte keys for Ed25519
const publicKeyRaw = publicKey.slice(-32).toString('hex');
const privateKeyRaw = privateKey.slice(-32).toString('hex');

// Create identity object
const identity = {
    version: "1.0",
    type: "test-identity",
    created_at: new Date().toISOString(),
    operator_id: operatorId,
    squad_id: squadId,
    keypair: {
        public_key: publicKeyRaw,
        private_key: privateKeyRaw,
        algorithm: "Ed25519"
    },
    metadata: {
        environment: "testing",
        dev_mode: true,
        tpm_backed: false
    }
};

// Write to file
fs.writeFileSync(outputFile, JSON.stringify(identity, null, 2));

console.log('Identity generated successfully!');
console.log('');
console.log('Public Key (hex):');
console.log(publicKeyRaw);
console.log('');
console.log('⚠️  SECURITY WARNING:');
console.log('This is a TEST identity only. Never use in production!');
EOFJS

# Run the generator
node /tmp/generate-identity.js "$OPERATOR_ID" "$SQUAD_ID" "$OUTPUT_FILE"

# Display result
echo ""
echo -e "${GREEN}✓ Identity generated successfully!${NC}"
echo ""
echo -e "${CYAN}Identity Details:${NC}"
cat "$OUTPUT_FILE" | head -20
echo ""

# Create a quick reference file
cat > "${OUTPUT_DIR}/README.md" << EOF
# Test Identities

This directory contains generated test identities for AetherCore testing.

## Generated Identities

- **${OPERATOR_ID}**: ${OUTPUT_FILE}

## Usage

### In Configuration File

\`\`\`yaml
identity:
  operator_id: "${OPERATOR_ID}"
  squad_id: "${SQUAD_ID}"
  keypair_path: "${OUTPUT_FILE}"
\`\`\`

### As Environment Variable

\`\`\`bash
export AETHERCORE_IDENTITY_FILE="${OUTPUT_FILE}"
\`\`\`

### Programmatically

\`\`\`rust
let identity = std::fs::read_to_string("${OUTPUT_FILE}")?;
let identity: TestIdentity = serde_json::from_str(&identity)?;
\`\`\`

## Security Notes

⚠️ **WARNING:** These are TEST identities only!

- Private keys are stored in plaintext
- Not backed by TPM hardware
- Not suitable for production use
- Generated for testing and development only

## Cleanup

To remove all test identities:

\`\`\`bash
rm -rf ${OUTPUT_DIR}
\`\`\`
EOF

echo -e "${CYAN}Next Steps:${NC}"
echo "  1. Use identity in testing configuration"
echo "  2. Set environment variable: export AETHERCORE_IDENTITY_FILE=$OUTPUT_FILE"
echo "  3. See ${OUTPUT_DIR}/README.md for usage examples"
echo ""

echo -e "${YELLOW}⚠️  Security Reminder:${NC}"
echo "  This is a TEST identity with keys stored in plaintext."
echo "  Never use test identities in production environments!"
echo ""

# Cleanup temp file
rm -f /tmp/generate-identity.js

exit 0
