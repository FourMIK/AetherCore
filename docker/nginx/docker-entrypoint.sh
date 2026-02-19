#!/bin/sh
set -eu

: "${REACT_APP_API_URL:=http://localhost:8080/api}"
: "${REACT_APP_WS_URL:=ws://localhost:8080/ws}"
: "${REACT_APP_TPM_ENABLED:=true}"

TEMPLATE_PATH="/usr/share/nginx/html/env.js.template"
OUTPUT_PATH="/usr/share/nginx/html/env.js"

if command -v envsubst >/dev/null 2>&1; then
  envsubst '${REACT_APP_API_URL} ${REACT_APP_WS_URL} ${REACT_APP_TPM_ENABLED}' < "$TEMPLATE_PATH" > "$OUTPUT_PATH"
else
  # Fallback substitution if envsubst is unavailable.
  sed \
    -e "s|\${REACT_APP_API_URL}|${REACT_APP_API_URL}|g" \
    -e "s|\${REACT_APP_WS_URL}|${REACT_APP_WS_URL}|g" \
    -e "s|\${REACT_APP_TPM_ENABLED}|${REACT_APP_TPM_ENABLED}|g" \
    "$TEMPLATE_PATH" > "$OUTPUT_PATH"
fi

exec "$@"
