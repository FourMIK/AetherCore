#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="us-east-1"
ACCOUNT_ID="565919382365"
VPC_ID="vpc-02effbb1b59fda5e5"
CLUSTER="AetherCore"
ALB_DNS="aethercore-alb-246985666.us-east-1.elb.amazonaws.com"
SERVICE="aethercore-dashboard"
TASK_DEFINITION="aether-c2-task:1"
CONTAINER_NAME="aether-c2-task"
CONTAINER_PORT="8080"
REPOSITORY="aether-c2"
IMAGE_URI="565919382365.dkr.ecr.us-east-1.amazonaws.com/aether-c2:latest"
TARGET_GROUP_ARN="arn:aws:elasticloadbalancing:us-east-1:565919382365:targetgroup/aethercore-tg-dashboard-8080/fe50aa71ae4860c0"

# Runtime state for final summary
LATEST_CREATED="false"
ECR_LATEST_OK="false"
ECS_RUNNING_OK="false"
TG_HEALTH_OK="false"
ALB_OK="false"

log() {
  printf '\n[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

err() {
  printf '\n[ERROR] %s\n' "$*" >&2
}

diagnose_ecs() {
  log "Running ECS diagnostics"
  aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query "services[0].events[0:10].[createdAt,message]" \
    --output table || true

  STOPPED_TASKS=$(aws ecs list-tasks \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --service-name "$SERVICE" \
    --desired-status STOPPED \
    --query 'taskArns' \
    --output text || true)

  if [[ -n "${STOPPED_TASKS:-}" && "${STOPPED_TASKS}" != "None" ]]; then
    aws ecs describe-tasks \
      --region "$AWS_REGION" \
      --cluster "$CLUSTER" \
      --tasks $STOPPED_TASKS \
      --query "tasks[].{taskArn:taskArn,stop:stoppedReason,reason:containers[].reason,lastStatus:lastStatus}" \
      --output table || true
  fi
}

run_or_die() {
  local desc="$1"
  shift
  log "$desc"
  if ! "$@"; then
    err "$desc failed"
    return 1
  fi
}

print_summary() {
  printf '\n==================== SUMMARY ====================\n'
  printf 'Repository: %s\n' "$REPOSITORY"
  printf 'Image URI: %s\n' "$IMAGE_URI"
  printf 'Cluster/Service: %s / %s\n' "$CLUSTER" "$SERVICE"
  printf 'Task Definition (expected): %s\n' "$TASK_DEFINITION"
  printf 'Container (%s): %s\n' "$CONTAINER_NAME" "$CONTAINER_PORT"
  printf 'VPC: %s\n' "$VPC_ID"
  printf 'latest tag created now: %s\n' "$LATEST_CREATED"
  printf 'latest tag exists: %s\n' "$ECR_LATEST_OK"
  printf 'ECS runningCount steady (1): %s\n' "$ECS_RUNNING_OK"
  printf 'Target group healthy: %s\n' "$TG_HEALTH_OK"
  printf 'ALB served non-503 content: %s\n' "$ALB_OK"
  printf '=================================================\n\n'
}

trap 'print_summary' EXIT

log "Starting AetherCore dashboard deployment recovery"
log "Using region=${AWS_REGION}, account=${ACCOUNT_ID}, vpc=${VPC_ID}"

# A) Validate repository exists
run_or_die "A) Validate ECR repository exists" \
  aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$REPOSITORY"

# B) List existing image tags
run_or_die "B) List existing ECR image tags and pushed timestamps" \
  aws ecr describe-images \
    --region "$AWS_REGION" \
    --repository-name "$REPOSITORY" \
    --query "imageDetails[].[imageTags,imagePushedAt,imageDigest]" \
    --output table

# C) Ensure latest exists; retag if missing
log "C) Check whether tag 'latest' exists"
LATEST_DIGEST=$(aws ecr describe-images \
  --region "$AWS_REGION" \
  --repository-name "$REPOSITORY" \
  --query "imageDetails[?contains(imageTags, 'latest')].imageDigest | [0]" \
  --output text)

if [[ -z "${LATEST_DIGEST:-}" || "$LATEST_DIGEST" == "None" ]]; then
  log "Tag 'latest' missing. Retagging most recent image digest to latest without pull/push"

  DIGEST=$(aws ecr describe-images \
    --region "$AWS_REGION" \
    --repository-name "$REPOSITORY" \
    --query "sort_by(imageDetails,& imagePushedAt)[-1].imageDigest" \
    --output text)

  if [[ -z "${DIGEST:-}" || "$DIGEST" == "None" ]]; then
    err "No images found in repository ${REPOSITORY}; cannot create latest"
    exit 1
  fi

  log "Most recent digest: ${DIGEST}"

  MANIFEST=$(aws ecr batch-get-image \
    --region "$AWS_REGION" \
    --repository-name "$REPOSITORY" \
    --image-ids imageDigest="$DIGEST" \
    --query 'images[0].imageManifest' \
    --output text)

  if [[ -z "${MANIFEST:-}" || "$MANIFEST" == "None" ]]; then
    err "Failed to fetch image manifest for digest ${DIGEST}"
    exit 1
  fi

  run_or_die "C3) Put image with tag latest" \
    aws ecr put-image \
      --region "$AWS_REGION" \
      --repository-name "$REPOSITORY" \
      --image-tag latest \
      --image-manifest "$MANIFEST"

  LATEST_CREATED="true"
else
  log "Tag 'latest' already exists at digest ${LATEST_DIGEST}; no retag needed"
fi

# D) Verify latest exists
log "D) Verify latest exists"
ALL_TAGS_JSON=$(aws ecr describe-images \
  --region "$AWS_REGION" \
  --repository-name "$REPOSITORY" \
  --query "imageDetails[].imageTags" \
  --output json)
printf '%s\n' "$ALL_TAGS_JSON"

if printf '%s' "$ALL_TAGS_JSON" | rg -q '"latest"'; then
  ECR_LATEST_OK="true"
else
  err "Tag latest still not found in ECR after retag attempt"
  exit 1
fi

# E) Force ECS new deployment
run_or_die "E) Force ECS deployment for dashboard service" \
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --force-new-deployment

# F) Poll ECS service status for steady state
log "F) Poll ECS service status until desired=1 running=1 pending=0"
for i in {1..30}; do
  STATUS_ROW=$(aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query "services[0].[desiredCount,runningCount,pendingCount,events[0].message]" \
    --output text)

  DESIRED=$(awk '{print $1}' <<<"$STATUS_ROW")
  RUNNING=$(awk '{print $2}' <<<"$STATUS_ROW")
  PENDING=$(awk '{print $3}' <<<"$STATUS_ROW")

  log "Attempt $i/30 -> desired=${DESIRED} running=${RUNNING} pending=${PENDING}"

  aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query "services[0].[desiredCount,runningCount,pendingCount,events[0].message]" \
    --output table || true

  if [[ "$DESIRED" == "1" && "$RUNNING" == "1" && "$PENDING" == "0" ]]; then
    ECS_RUNNING_OK="true"
    break
  fi

  sleep 10
done

if [[ "$ECS_RUNNING_OK" != "true" ]]; then
  err "Service did not reach desired=1 running=1 pending=0 in time"
  diagnose_ecs
  exit 1
fi

# G) Check target health
log "G) Check ALB target group health"
TG_OUTPUT=$(aws elbv2 describe-target-health \
  --region "$AWS_REGION" \
  --target-group-arn "$TARGET_GROUP_ARN" \
  --output table)
printf '%s\n' "$TG_OUTPUT"

if printf '%s' "$TG_OUTPUT" | rg -q 'healthy'; then
  TG_HEALTH_OK="true"
else
  err "No healthy targets detected in target group"
  diagnose_ecs
  exit 1
fi

# H) Curl ALB
log "H) Curl ALB root and ensure non-503"
CURL_OUTPUT=$(curl -sS -i "http://${ALB_DNS}/" | head -n 20)
printf '%s\n' "$CURL_OUTPUT"

if printf '%s' "$CURL_OUTPUT" | rg -q '^HTTP/.* 503'; then
  err "ALB returned HTTP 503"
  exit 1
fi

if printf '%s' "$CURL_OUTPUT" | rg -q '^HTTP/.* 200|<html|<!doctype html'; then
  ALB_OK="true"
else
  err "ALB response did not clearly indicate success (no HTTP 200 or HTML marker in first lines)"
  exit 1
fi

log "All checks passed. Dashboard deployment is healthy."
exit 0
