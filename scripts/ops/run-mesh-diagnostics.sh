#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_SSH="${1:-duskone@192.168.1.125}"
MAC_IP="${2:-192.168.1.51}"

echo "== Step 1/3: Sync local runtime endpoints =="
"$ROOT_DIR/scripts/ops/sync-endpoints.sh"

echo
echo "== Step 2/3: Mac mesh checks =="
"$ROOT_DIR/scripts/ops/check-mac-mesh.sh"

echo
echo "== Step 3/3: Pi mesh checks =="
"$ROOT_DIR/scripts/ops/check-pi-mesh.sh" "$PI_SSH" "$MAC_IP"

echo
echo "DONE: diagnostics complete"

