#!/bin/bash

set -e

echo "=========================================="
echo "AetherCore Development Setup"
echo "=========================================="
echo ""

# Build verification
echo "✓ Checking builds..."
echo ""

echo "  TypeScript Build:"
npm run build --silent > /dev/null && echo "    ✓ npm build successful"

echo ""
echo "  Rust Build:"
cargo build --workspace --quiet 2>/dev/null && echo "    ✓ cargo build successful"

echo ""
echo "=========================================="
echo "AetherCore is ready to run!"
echo "=========================================="
echo ""

echo "Quick Start Options:"
echo ""
echo "1. Start microservices:"
echo "   docker-compose -f infra/docker/docker-compose.yml up -d"
echo ""
echo "2. Start h2-ingest Rust service:"
echo "   cargo run -p h2-ingest"
echo ""
echo "3. Start Node.js services individually:"
echo "   npm run start --workspace @aethercore/gateway"
echo "   npm run start --workspace @aethercore/auth"
echo ""
echo "4. Run tests:"
echo "   npm run test --workspaces"
echo "   cargo test --workspace"
echo ""
echo "5. View logs:"
echo "   docker-compose -f infra/docker/docker-compose.yml logs -f"
echo ""
