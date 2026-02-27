#!/usr/bin/env bash
set -euo pipefail

echo "Stopping Heltech bridge processes..."
pkill -f "bridge-heltech-presence.sh" || true
pkill -f "bridge-heltech-meshtastic.py" || true
pkill -f "connect-heltech-v4.sh --foreground" || true

echo "Active bridge-related processes:"
pgrep -fl "heltech|bridge-heltech-presence|bridge-heltech-meshtastic" || true

echo "DONE"
