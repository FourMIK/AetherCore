#!/usr/bin/env bash
set -euo pipefail

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-565919382365}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
GIT_SHA="${GIT_SHA:-$(git rev-parse --short=8 HEAD)}"

SERVICES=(
  "aethercore-dashboard|infra/docker/ecs/dashboard/Dockerfile|."
  "aethercore-gateway|infra/docker/ecs/gateway/Dockerfile|."
  "aethercore-auth|infra/docker/ecs/auth/Dockerfile|."
  "aethercore-collaboration|infra/docker/ecs/collaboration/Dockerfile|."
  "aethercore-h2-ingest|infra/docker/ecs/h2-ingest/Dockerfile|."
)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd git

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r repo_name dockerfile build_context <<<"${entry}"

  local_latest="${repo_name}:latest"
  local_sha="${repo_name}:${GIT_SHA}"
  remote_latest="${ECR_REGISTRY}/${repo_name}:latest"
  remote_sha="${ECR_REGISTRY}/${repo_name}:${GIT_SHA}"

  echo "==> Building ${repo_name}"
  docker build -f "${dockerfile}" -t "${local_latest}" "${build_context}"

  echo "==> Tagging ${repo_name}"
  docker tag "${local_latest}" "${local_sha}"
  docker tag "${local_latest}" "${remote_latest}"
  docker tag "${local_sha}" "${remote_sha}"
done

echo "Build and tag completed for git SHA ${GIT_SHA}."
