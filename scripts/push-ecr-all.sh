#!/usr/bin/env bash
set -euo pipefail

AWS_ACCOUNT_ID="565919382365"
AWS_REGION="us-east-1"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
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
require_cmd docker
require_cmd git

aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

for repo in "${REPOS[@]}"; do
  full_repo="${ECR_REGISTRY}/${repo}"

  echo "==> Ensuring ECR repository exists: ${repo}"
  aws ecr describe-repositories --region "${AWS_REGION}" --repository-names "${repo}" >/dev/null 2>&1 || \
    aws ecr create-repository --region "${AWS_REGION}" --repository-name "${repo}" >/dev/null

  echo "==> Pushing ${full_repo}:latest"
  docker push "${full_repo}:latest"

  echo "==> Pushing ${full_repo}:${GIT_SHA}"
  docker push "${full_repo}:${GIT_SHA}"
done

echo "Push completed for git SHA ${GIT_SHA}."
