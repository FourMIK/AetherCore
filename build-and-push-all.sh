#!/usr/bin/env bash
set -euo pipefail

AWS_ACCOUNT_ID="565919382365"
AWS_REGION="us-east-1"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD)}"

SERVICES=(
  "dashboard:infra/docker/ecs/dashboard/Dockerfile:8080:/"
  "gateway:infra/docker/ecs/gateway/Dockerfile:3000:/health"
  "auth:infra/docker/ecs/auth/Dockerfile:3001:/health"
  "collaboration:infra/docker/ecs/collaboration/Dockerfile:8080:/health"
  "h2-ingest:infra/docker/ecs/h2-ingest/Dockerfile:8090:/health"
  "operator:infra/docker/ecs/operator/Dockerfile:4001:/health"
)

echo "Logging in to ECR ${ECR_REGISTRY}"
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

for entry in "${SERVICES[@]}"; do
  IFS=':' read -r service dockerfile port health <<<"${entry}"
  repo="${ECR_REGISTRY}/aethercore-${service}"

  echo "\n=== Building ${service} (${dockerfile}) ==="
  docker build -f "${dockerfile}" -t "${service}:latest" -t "${service}:${GIT_SHA}" .

  docker tag "${service}:latest" "${repo}:latest"
  docker tag "${service}:${GIT_SHA}" "${repo}:${GIT_SHA}"

  echo "Pushing ${repo}:latest"
  docker push "${repo}:latest"
  echo "Pushing ${repo}:${GIT_SHA}"
  docker push "${repo}:${GIT_SHA}"

  echo "Verifying ${service} tags in ECR"
  aws ecr describe-images \
    --region "${AWS_REGION}" \
    --repository-name "aethercore-${service}" \
    --image-ids "imageTag=latest" "imageTag=${GIT_SHA}" \
    --query 'imageDetails[].imageTags' \
    --output table

done

echo "All images built and pushed successfully."
