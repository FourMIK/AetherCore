#!/bin/sh
set -eu

cat > /usr/share/nginx/html/env.js <<EOC
window.__ENV__ = {
  REACT_APP_API_URL: "${REACT_APP_API_URL:-/api}",
  REACT_APP_WS_URL: "${REACT_APP_WS_URL:-/ws}",
  REACT_APP_TPM_ENABLED: "${REACT_APP_TPM_ENABLED:-false}"
};
EOC

exec nginx -g 'daemon off;'
