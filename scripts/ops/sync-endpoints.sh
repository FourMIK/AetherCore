#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 1
fi

CFG1="$HOME/Library/Application Support/com.aethercore.commander/runtime-config.json"
CFG2="$HOME/Library/Application Support/com.aethercore.commander.dev/runtime-config.json"

API_ENDPOINT="${API_ENDPOINT:-http://localhost:3000}"
MESH_ENDPOINT="${MESH_ENDPOINT:-ws://localhost:3000}"
API_PORT="${API_PORT:-3000}"
MESH_PORT="${MESH_PORT:-3000}"

update_cfg() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "SKIP: $f (not found)"
    return
  fi

  local tmp
  tmp="$(mktemp)"
  jq \
    --arg api "$API_ENDPOINT" \
    --arg ws "$MESH_ENDPOINT" \
    --argjson api_port "$API_PORT" \
    --argjson mesh_port "$MESH_PORT" \
    '.profile="commander-local"
    | .connection.api_endpoint=$api
    | .connection.mesh_endpoint=$ws
    | .ports.api=$api_port
    | .ports.mesh=$mesh_port
    | .features.allow_insecure_localhost=true
    | .features.bootstrap_on_startup=true' \
    "$f" >"$tmp"
  mv "$tmp" "$f"

  echo "UPDATED: $f"
  jq '.connection,.ports' "$f"
}

update_cfg "$CFG1"
update_cfg "$CFG2"

echo "DONE: local runtime endpoints synced"
