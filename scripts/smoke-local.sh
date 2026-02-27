#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd curl

cleanup() {
  docker rm -f ac-dashboard ac-gateway ac-auth ac-collaboration ac-h2-ingest >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_http_200() {
  local name="$1"
  local url="$2"
  local attempts="${3:-30}"

  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${url}" >/dev/null; then
      echo "PASS: ${name} -> ${url}"
      return 0
    fi
    sleep 1
  done

  echo "FAIL: ${name} did not become healthy at ${url}" >&2
  docker logs "${name}" || true
  return 1
}

cleanup

echo "==> Starting dashboard"
docker run -d --name ac-dashboard -p 18080:8080 \
  -e REACT_APP_API_URL=/api \
  -e REACT_APP_WS_URL=/ws \
  -e REACT_APP_TPM_ENABLED=true \
  aethercore-dashboard:latest >/dev/null
wait_for_http_200 ac-dashboard http://127.0.0.1:18080/

echo "==> Starting gateway"
docker run -d --name ac-gateway -p 13000:3000 \
  -e PORT=3000 \
  -e TPM_ENABLED=false \
  aethercore-gateway:latest >/dev/null
wait_for_http_200 ac-gateway http://127.0.0.1:13000/health

echo "==> Starting auth"
docker run -d --name ac-auth -p 13001:3001 \
  -e PORT=3001 \
  -e AUTH_JWT_SECRET=local-smoke-secret \
  aethercore-auth:latest >/dev/null
wait_for_http_200 ac-auth http://127.0.0.1:13001/health

echo "==> Starting collaboration"
docker run -d --name ac-collaboration -p 18081:8080 \
  -e PORT=8080 \
  -e IDENTITY_REGISTRY_ADDRESS=localhost:50051 \
  aethercore-collaboration:latest >/dev/null
wait_for_http_200 ac-collaboration http://127.0.0.1:18081/health

echo "==> Starting h2-ingest"
docker run -d --name ac-h2-ingest -p 18090:8090 \
  -e PORT=8090 \
  -e REDIS_URL=redis://localhost:6379 \
  -e KMS_KEY_ARN=arn:aws:kms:us-east-1:565919382365:key/local-smoke \
  -e MERKLE_BUCKET=aethercore-local-smoke \
  -e BUFFER_SIZE=65536 \
  -e AWS_EC2_METADATA_DISABLED=true \
  -e AWS_ACCESS_KEY_ID=dummy \
  -e AWS_SECRET_ACCESS_KEY=dummy \
  -e AWS_REGION=us-east-1 \
  aethercore-h2-ingest:latest >/dev/null
wait_for_http_200 ac-h2-ingest http://127.0.0.1:18090/health

echo "All local container smoke checks passed."
