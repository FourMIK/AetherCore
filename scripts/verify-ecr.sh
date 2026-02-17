#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="us-east-1"
GIT_SHA="$(git rev-parse --short=8 HEAD)"

REPOS=(
  "aethercore-dashboard"
  "aethercore-gateway"
  "aethercore-auth"
  "aethercore-collaboration"
  "aethercore-h2-ingest"
)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found" >&2
    exit 1
  fi
}

require_cmd aws
require_cmd git

for repo in "${REPOS[@]}"; do
  echo "==> Verifying ${repo}:latest"
  aws ecr describe-images \
    --region "${AWS_REGION}" \
    --repository-name "${repo}" \
    --image-ids imageTag=latest \
    --query 'imageDetails[0].imageTags' \
    --output text >/dev/null

  echo "==> Verifying ${repo}:${GIT_SHA}"
  aws ecr describe-images \
    --region "${AWS_REGION}" \
    --repository-name "${repo}" \
    --image-ids imageTag="${GIT_SHA}" \
    --query 'imageDetails[0].imageTags' \
    --output text >/dev/null

done

echo "Verified: latest and ${GIT_SHA} tags exist in ECR for all repositories."
