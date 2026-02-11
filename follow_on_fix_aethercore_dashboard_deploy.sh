#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="us-east-1"
export ECR_URI_BASE="565919382365.dkr.ecr.us-east-1.amazonaws.com"
ACCOUNT_ID="565919382365"
REPOSITORY="aether-c2"
IMAGE_URI="${ECR_URI_BASE}/${REPOSITORY}:latest"
CLUSTER="AetherCore"
SERVICE="aethercore-dashboard"
TASK_DEFINITION="aether-c2-task:1"
ALB_DNS="aethercore-alb-246985666.us-east-1.elb.amazonaws.com"
TARGET_GROUP_ARN="arn:aws:elasticloadbalancing:us-east-1:565919382365:targetgroup/aethercore-tg-dashboard-8080/fe50aa71ae4860c0"
REPO_URL_PUBLIC="https://github.com/FourMIK/AetherCore.git"
REPO_DIR="AetherCore"

log() {
  printf "\n[%s] %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

fail() {
  printf "\n[ERROR] %s\n" "$*" >&2
  exit 1
}

diagnostics_ecs() {
  log "ECS diagnostics: recent service events"
  aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query "services[0].events[0:10].[createdAt,message]" \
    --output table || true

  log "ECS diagnostics: stopped tasks"
  STOPPED_TASKS=$(aws ecs list-tasks \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --service-name "$SERVICE" \
    --desired-status STOPPED \
    --query 'taskArns' \
    --output text || true)

  if [[ -n "${STOPPED_TASKS:-}" && "$STOPPED_TASKS" != "None" ]]; then
    aws ecs describe-tasks \
      --region "$AWS_REGION" \
      --cluster "$CLUSTER" \
      --tasks $STOPPED_TASKS \
      --query "tasks[].{taskArn:taskArn,lastStatus:lastStatus,stoppedReason:stoppedReason,containerReasons:containers[].reason}" \
      --output table || true
  else
    log "No STOPPED tasks found for service ${SERVICE}"
  fi
}

build_and_push_image() {
  log "Preparing source repository in ./${REPO_DIR}"

  if [[ -d "${REPO_DIR}/.git" ]]; then
    log "Repo already exists, refreshing origin"
    git -C "$REPO_DIR" fetch --depth 1 origin || true
    git -C "$REPO_DIR" reset --hard origin/HEAD || true
  else
    set +e
    git clone --depth 1 "$REPO_URL_PUBLIC" "$REPO_DIR"
    CLONE_RC=$?
    set -e

    if [[ $CLONE_RC -ne 0 ]]; then
      if [[ -z "${GH_PAT:-}" ]]; then
        fail "Failed to clone ${REPO_URL_PUBLIC}. GitHub authentication appears required. Set GH_PAT to a GitHub Personal Access Token with private repo read access, then rerun. Expected usage: export GH_PAT='<token>'"
      fi

      log "Retrying clone with GH_PAT"
      git clone --depth 1 "https://${GH_PAT}@github.com/FourMIK/AetherCore.git" "$REPO_DIR" || \
        fail "Clone with GH_PAT failed. Ensure GH_PAT has repo read access to FourMIK/AetherCore."
    fi
  fi

  [[ -f "${REPO_DIR}/docker/Dockerfile.dashboard" ]] || fail "Missing docker/Dockerfile.dashboard in ${REPO_DIR}"

  log "Building dashboard image ${IMAGE_URI}"
  (
    cd "$REPO_DIR"
    docker build -t "$IMAGE_URI" -f docker/Dockerfile.dashboard .
  )

  log "Pushing image ${IMAGE_URI}"
  docker push "$IMAGE_URI"
}

log "Preflight: verify AWS identity"
aws sts get-caller-identity --region "$AWS_REGION" >/dev/null

log "Ensure ECR repository exists: ${REPOSITORY}"
if ! aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository --region "$AWS_REGION" --repository-name "$REPOSITORY" >/dev/null
  log "Created ECR repository ${REPOSITORY}"
else
  log "ECR repository ${REPOSITORY} already exists"
fi

log "ECR login"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_URI_BASE"

NEEDS_BUILD_PUSH="false"

log "Check whether ${IMAGE_URI} exists in ECR"
if aws ecr describe-images \
  --region "$AWS_REGION" \
  --repository-name "$REPOSITORY" \
  --query "imageDetails[?contains(imageTags,'latest')].[imageDigest]" \
  --output text | grep -q .; then
  log "Tag latest exists in ECR. Testing pullability"
  set +e
  docker pull "$IMAGE_URI"
  PULL_RC=$?
  set -e

  if [[ $PULL_RC -ne 0 ]]; then
    log "latest exists but pull failed; will build and push a fresh image"
    NEEDS_BUILD_PUSH="true"
  else
    log "latest is pullable"
  fi
else
  log "latest tag missing; will build and push"
  NEEDS_BUILD_PUSH="true"
fi

if [[ "$NEEDS_BUILD_PUSH" == "true" ]]; then
  build_and_push_image
fi

log "Force ECS new deployment (cluster=${CLUSTER}, service=${SERVICE})"
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment >/dev/null

log "Polling ECS service for up to 10 minutes until desired=1 running=1 pending=0"
MAX_ITERS=60
SLEEP_SECONDS=10
ECS_OK="false"

for ((i=1; i<=MAX_ITERS; i++)); do
  STATUS=$(aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query "services[0].[desiredCount,runningCount,pendingCount,events[0].message]" \
    --output text)

  DESIRED=$(awk '{print $1}' <<<"$STATUS")
  RUNNING=$(awk '{print $2}' <<<"$STATUS")
  PENDING=$(awk '{print $3}' <<<"$STATUS")
  EVENT_MSG=$(cut -f4- <<<"$STATUS")

  log "Poll ${i}/${MAX_ITERS}: desired=${DESIRED} running=${RUNNING} pending=${PENDING} event=${EVENT_MSG}"

  if [[ "$DESIRED" == "1" && "$RUNNING" == "1" && "$PENDING" == "0" ]]; then
    ECS_OK="true"
    break
  fi

  sleep "$SLEEP_SECONDS"
done

if [[ "$ECS_OK" != "true" ]]; then
  diagnostics_ecs
  fail "ECS service failed to reach steady state in time"
fi

log "Verify ECR latest exists"
aws ecr describe-images \
  --region "$AWS_REGION" \
  --repository-name "$REPOSITORY" \
  --query "imageDetails[?contains(imageTags,'latest')].[imagePushedAt,imageDigest]" \
  --output table

log "Verify ECS service steady"
aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query "services[0].[desiredCount,runningCount,pendingCount,events[0].message]" \
  --output table

log "Verify target group health"
TG_HEALTH_OUTPUT=$(aws elbv2 describe-target-health \
  --region "$AWS_REGION" \
  --target-group-arn "$TARGET_GROUP_ARN" \
  --output table)
printf '%s\n' "$TG_HEALTH_OUTPUT"

echo "$TG_HEALTH_OUTPUT" | grep -qi healthy || {
  diagnostics_ecs
  fail "No healthy targets found in dashboard target group"
}

log "Verify ALB serves non-503 response"
ALB_RESPONSE=$(curl -sS -i "http://${ALB_DNS}/" | head -n 20)
printf '%s\n' "$ALB_RESPONSE"

echo "$ALB_RESPONSE" | grep -Eq '^HTTP/.* 503' && fail "ALB returned HTTP 503"

echo "$ALB_RESPONSE" | grep -Eqi '^HTTP/.* (200|301|302|304)|<html|<!doctype html' || \
  fail "ALB did not return expected success/HTML response"

log "SUCCESS: dashboard image is available and ECS/ALB checks passed"
