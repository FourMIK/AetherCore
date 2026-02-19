#!/bin/bash
# Startup AWS Testbed Services
# This script restores ECS services to their previous desired counts
# Run after shutdown-aws-testbed.sh to resume operations

set -euo pipefail

CLUSTER="aethercore-aws-testbed-cluster"
REGION="us-east-1"
STATE_FILE="/tmp/aethercore-testbed-state.json"
DEFAULT_DESIRED_COUNT=1

echo "=================================================="
echo "☀️  AetherCore Testbed Morning Startup"
echo "=================================================="
echo "Cluster: ${CLUSTER}"
echo "Region: ${REGION}"
echo ""

# Check if state file exists
if [ ! -f "${STATE_FILE}" ]; then
  echo "⚠️  No state file found at ${STATE_FILE}"
  echo "   Using default desired count: ${DEFAULT_DESIRED_COUNT}"
  echo ""
else
  echo "📄 Found state file: ${STATE_FILE}"
  echo ""
fi

# Define services array
SERVICES=(
  "aethercore-aws-testbed-dashboard"
  "aethercore-aws-testbed-gateway"
  "aethercore-aws-testbed-auth"
  "aethercore-aws-testbed-h2-ingest"
  "aethercore-aws-testbed-collaboration"
)

echo "🚀 Starting all services..."
echo ""

# Start services in parallel for speed
for SERVICE in "${SERVICES[@]}"; do
  (
    # Try to read desired count from state file, fallback to default
    if [ -f "${STATE_FILE}" ]; then
      DESIRED_COUNT=$(grep "\"${SERVICE}\"" "${STATE_FILE}" | awk -F': ' '{print $2}' | tr -d ',' || echo "${DEFAULT_DESIRED_COUNT}")
      # If the saved count was 0, use default instead
      if [ "${DESIRED_COUNT}" -eq 0 ]; then
        DESIRED_COUNT=${DEFAULT_DESIRED_COUNT}
      fi
    else
      DESIRED_COUNT=${DEFAULT_DESIRED_COUNT}
    fi

    echo "  Starting ${SERVICE} (desired: ${DESIRED_COUNT})..."
    aws ecs update-service \
      --cluster "${CLUSTER}" \
      --service "${SERVICE}" \
      --desired-count "${DESIRED_COUNT}" \
      --force-new-deployment \
      --region "${REGION}" \
      --output json > /dev/null 2>&1 && \
    echo "  ✓ ${SERVICE} started with desired count: ${DESIRED_COUNT}" || \
    echo "  ⚠️  ${SERVICE} may not exist or failed to start"
  ) &
done

# Wait for all background jobs
wait

echo ""
echo "⏳ Waiting 60 seconds for services to stabilize..."
sleep 60

echo ""
echo "📊 Service status:"
echo ""

ALL_HEALTHY=true
for SERVICE in "${SERVICES[@]}"; do
  RUNNING=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services "${SERVICE}" \
    --region "${REGION}" \
    --query 'services[0].runningCount' \
    --output text 2>/dev/null || echo "N/A")

  DESIRED=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services "${SERVICE}" \
    --region "${REGION}" \
    --query 'services[0].desiredCount' \
    --output text 2>/dev/null || echo "N/A")

  if [ "${RUNNING}" = "${DESIRED}" ] && [ "${RUNNING}" != "0" ] && [ "${RUNNING}" != "N/A" ]; then
    echo "  ✓ ${SERVICE}: Healthy (running: ${RUNNING}, desired: ${DESIRED})"
  elif [ "${DESIRED}" = "0" ]; then
    echo "  ⏸️  ${SERVICE}: Not configured to run (desired: 0)"
  else
    echo "  ⏳ ${SERVICE}: Starting (running: ${RUNNING}, desired: ${DESIRED})"
    ALL_HEALTHY=false
  fi
done

echo ""
echo "=================================================="
if [ "${ALL_HEALTHY}" = true ]; then
  echo "✅ Startup Complete - All Services Healthy!"
else
  echo "⏳ Startup In Progress - Services Still Stabilizing"
  echo ""
  echo "   Some services are still starting up. This can take 2-3 minutes."
  echo "   Check status with:"
  echo "   aws ecs describe-services --cluster ${CLUSTER} --services aethercore-aws-testbed-gateway --region ${REGION}"
fi
echo "=================================================="
echo ""
echo "🌐 Access Points:"
echo "  - Dashboard: https://aether.authynticdefense.com"
echo "  - ALB: http://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com"
echo ""
echo "📊 Monitor services:"
echo "   watch -n 5 'aws ecs list-services --cluster ${CLUSTER} --region ${REGION} | xargs -I {} aws ecs describe-services --cluster ${CLUSTER} --services {} --region ${REGION} --query \"services[*].[serviceName,runningCount,desiredCount]\" --output table'"
echo ""
echo "=================================================="
