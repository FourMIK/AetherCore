#!/bin/sh
set -eu

: "${REACT_APP_API_URL:=https://mesh.example.com/api}"
: "${REACT_APP_WS_URL:=wss://mesh.example.com/ws}"

envsubst '${REACT_APP_API_URL} ${REACT_APP_WS_URL}' \
  < /usr/share/nginx/html/env.js.template \
  > /usr/share/nginx/html/env.js

exec "$@"
