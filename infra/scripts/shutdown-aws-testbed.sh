#!/bin/bash
# Shutdown AWS Testbed Services for Cost Savings
# This script scales ECS services to 0 without deleting infrastructure
# Run startup-aws-testbed.sh to restore services

set -euo pipefail

CLUSTER="aethercore-aws-testbed-cluster"
REGION="us-east-1"
SERVICES=(
  "aethercore-aws-testbed-dashboard"
  "aethercore-aws-testbed-gateway"
  "aethercore-aws-testbed-auth"
  "aethercore-aws-testbed-h2-ingest"
  "aethercore-aws-testbed-collaboration"
)

echo "=================================================="
echo "🌙 AetherCore Testbed Nighttime Shutdown"
echo "=================================================="
echo "Cluster: ${CLUSTER}"
echo "Region: ${REGION}"
echo ""

# Save current service states
STATE_FILE="/tmp/aethercore-testbed-state.json"
echo "💾 Saving current service states to ${STATE_FILE}..."
echo "{" > "${STATE_FILE}"

for SERVICE in "${SERVICES[@]}"; do
  echo "  Checking ${SERVICE}..."

  # Get current desired count
  DESIRED_COUNT=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services "${SERVICE}" \
    --region "${REGION}" \
    --query 'services[0].desiredCount' \
    --output text 2>/dev/null || echo "0")

  # Save to state file
  echo "  \"${SERVICE}\": ${DESIRED_COUNT}," >> "${STATE_FILE}"

  if [ "${DESIRED_COUNT}" -eq 0 ]; then
    echo "  ✓ Already stopped (desired: 0)"
  else
    echo "  📊 Current desired: ${DESIRED_COUNT}"
  fi
done

# Close JSON (remove trailing comma and add closing brace)
sed -i '$ s/,$//' "${STATE_FILE}"
echo "}" >> "${STATE_FILE}"

echo ""
echo "🛑 Scaling all services to 0..."
echo ""

# Stop services in parallel for speed
for SERVICE in "${SERVICES[@]}"; do
  (
    echo "  Stopping ${SERVICE}..."
    aws ecs update-service \
      --cluster "${CLUSTER}" \
      --service "${SERVICE}" \
      --desired-count 0 \
      --region "${REGION}" \
      --output json > /dev/null 2>&1 && \
    echo "  ✓ ${SERVICE} scaled to 0" || \
    echo "  ⚠️  ${SERVICE} may not exist or already stopped"
  ) &
done

# Wait for all background jobs
wait

echo ""
echo "⏳ Waiting 30 seconds for services to drain..."
sleep 30

echo ""
echo "📊 Final service status:"
echo ""

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

  if [ "${RUNNING}" = "0" ] && [ "${DESIRED}" = "0" ]; then
    echo "  ✓ ${SERVICE}: Stopped (running: 0, desired: 0)"
  else
    echo "  ⏳ ${SERVICE}: Draining (running: ${RUNNING}, desired: ${DESIRED})"
  fi
done

echo ""
echo "=================================================="
echo "💤 Shutdown Complete!"
echo "=================================================="
echo ""
echo "💰 Estimated Cost Savings:"
echo "  - ECS Fargate: ~\$0.50-\$1.00 per hour saved"
echo "  - Daily savings (12 hours): ~\$6-\$12"
echo "  - Monthly savings (weeknights only): ~\$90-\$180"
echo ""
echo "⚠️  Note: RDS and ElastiCache continue running"
echo "   - To stop RDS (manual restart required):"
echo "     aws rds stop-db-instance --db-instance-identifier aethercore-aws-testbed-postgres --region us-east-1"
echo ""
echo "🔄 To restart services:"
echo "   ./infra/scripts/startup-aws-testbed.sh"
echo ""
echo "📄 Service state saved to: ${STATE_FILE}"
echo "=================================================="
