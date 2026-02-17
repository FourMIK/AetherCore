#!/usr/bin/env bash
set -euo pipefail

AWS_ACCOUNT_ID="565919382365"
AWS_REGION="us-east-1"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
GIT_SHA="$(git rev-parse --short HEAD)"

SERVICES=(
  "dashboard|aethercore-dashboard|packages/dashboard/docker/Dockerfile.dashboard"
  "gateway|aethercore-gateway|services/gateway/Dockerfile"
  "auth|aethercore-auth|services/auth/Dockerfile"
  "collaboration|aethercore-collaboration|services/collaboration/Dockerfile"
  "h2-ingest|aethercore-h2-ingest|services/h2-ingest/Dockerfile"
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

aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_REGISTRY}"

for service_entry in "${SERVICES[@]}"; do
  IFS='|' read -r service_name repo_name dockerfile_path <<<"${service_entry}"
  full_repo="${ECR_REGISTRY}/${repo_name}"

  echo "==> Ensuring ECR repository exists: ${repo_name}"
  aws ecr describe-repositories \
    --region "${AWS_REGION}" \
    --repository-names "${repo_name}" >/dev/null 2>&1 || \
    aws ecr create-repository --region "${AWS_REGION}" --repository-name "${repo_name}" >/dev/null

  echo "==> Building ${service_name} from ${dockerfile_path}"
  docker build \
    -f "${dockerfile_path}" \
    -t "${full_repo}:latest" \
    -t "${full_repo}:${GIT_SHA}" \
    .

  echo "==> Pushing ${full_repo}:latest"
  docker push "${full_repo}:latest"

  echo "==> Pushing ${full_repo}:${GIT_SHA}"
  docker push "${full_repo}:${GIT_SHA}"

done

echo "All images built and pushed successfully."
