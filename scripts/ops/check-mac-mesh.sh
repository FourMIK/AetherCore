#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CFG1="$HOME/Library/Application Support/com.aethercore.commander/runtime-config.json"
CFG2="$HOME/Library/Application Support/com.aethercore.commander.dev/runtime-config.json"
WS_MODULE="$ROOT_DIR/services/gateway/node_modules/ws"
PROBE_SECONDS="${PROBE_SECONDS:-45}"

echo "== Mac listeners =="
lsof -nP -iTCP:3000 -sTCP:LISTEN || true
lsof -nP -iTCP:8080 -sTCP:LISTEN || true

echo
echo "== Mac processes =="
pgrep -fl "tactical-glass-desktop|services/gateway/dist/index.js|services/collaboration/dist/index.js" || true

echo
echo "== Runtime config =="
if command -v jq >/dev/null 2>&1; then
  for f in "$CFG1" "$CFG2"; do
    if [[ -f "$f" ]]; then
      echo "-- $f"
      jq '.profile,.features,.connection,.ports' "$f"
    else
      echo "SKIP: $f (not found)"
    fi
  done
else
  echo "SKIP: jq not installed"
fi

echo
echo "== Gateway presence endpoint check (:3000 /ralphie/presence) =="
presence_status="$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3000/ralphie/presence -H 'Content-Type: application/json' -d '{}' || true)"
echo "POST /ralphie/presence -> HTTP ${presence_status:-unknown}"
if [[ "${presence_status}" == "404" ]]; then
  echo "WARN: gateway on :3000 does not expose /ralphie/presence (stale or wrong service)"
fi

echo
echo "== Gateway websocket probe (:3000) =="
if [[ -f "$WS_MODULE/index.js" || -d "$WS_MODULE" ]]; then
  if ! WS_MODULE="$WS_MODULE" PROBE_SECONDS="$PROBE_SECONDS" node - <<'NODE'
const WebSocket = require(process.env.WS_MODULE);
const ws = new WebSocket("ws://127.0.0.1:3000");
const done = setTimeout(() => {
  console.log("probe_timeout_no_more_messages");
  ws.close();
  process.exit(0);
}, Number(process.env.PROBE_SECONDS) * 1000);
ws.on("open", () => console.log("probe_open"));
ws.on("message", (m) => console.log(String(m)));
ws.on("error", (e) => {
  console.error("probe_error", e.message);
  clearTimeout(done);
  process.exit(1);
});
NODE
  then
    echo "WARN: websocket probe failed"
  fi
else
  echo "SKIP: ws module not found at $WS_MODULE"
fi

echo
echo "DONE: mac mesh checks complete"
