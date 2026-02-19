#!/usr/bin/env bash
# AetherCore AWS testbed targeted destroy helper.
#
# Destroys high-cost `aws-testbed` resources by default and supports custom
# Terraform targets via repeated --target flags.
#
# Usage examples:
#   ./infra/scripts/destroy-aws-testbed.sh
#   ./infra/scripts/destroy-aws-testbed.sh --target aws_ecs_service.gateway --target aws_ecs_service.auth
#   TF_VAR_db_password=... TF_VAR_jwt_secret=... ./infra/scripts/destroy-aws-testbed.sh --auto-approve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform/environments/aws-testbed"
AUTO_APPROVE="false"
CUSTOM_TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --target requires a Terraform resource address"
        exit 1
      fi
      CUSTOM_TARGETS+=("$2")
      shift 2
      ;;
    --auto-approve)
      AUTO_APPROVE="true"
      shift
      ;;
    -h|--help)
      sed -n '1,24p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      exit 1
      ;;
  esac
done

if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform is required but was not found in PATH"
  exit 1
fi

if [[ ! -d "${TF_DIR}" ]]; then
  echo "ERROR: Terraform directory not found: ${TF_DIR}"
  exit 1
fi

if [[ -z "${TF_VAR_db_password:-}" ]] || [[ -z "${TF_VAR_jwt_secret:-}" ]]; then
  echo "ERROR: TF_VAR_db_password and TF_VAR_jwt_secret must be set for Terraform evaluation."
  exit 1
fi

DEFAULT_TARGETS=(
  "aws_ecs_cluster.main"
  "aws_ecs_service.gateway"
  "aws_ecs_service.auth"
  "aws_ecs_service.collaboration"
  "aws_ecs_service.h2_ingest"
  "aws_ecs_service.prometheus"
  "aws_ecs_service.grafana"
  "aws_db_instance.main"
  "aws_elasticache_replication_group.redis"
  "aws_cloudfront_distribution.dashboard"
  "aws_lb.main"
  "aws_efs_file_system.prometheus"
)

if [[ ${#CUSTOM_TARGETS[@]} -gt 0 ]]; then
  TARGETS=("${CUSTOM_TARGETS[@]}")
else
  TARGETS=("${DEFAULT_TARGETS[@]}")
fi

TARGET_ARGS=()
for target in "${TARGETS[@]}"; do
  TARGET_ARGS+=("-target=${target}")
done

pushd "${TF_DIR}" >/dev/null

echo "Initializing Terraform in ${TF_DIR}"
terraform init -backend-config=backend.hcl

DESTROY_CMD=(terraform destroy "${TARGET_ARGS[@]}")
if [[ "${AUTO_APPROVE}" == "true" ]]; then
  DESTROY_CMD+=("-auto-approve")
fi

echo "Executing targeted destroy for ${#TARGETS[@]} resource target(s)."
printf '  - %s\n' "${TARGETS[@]}"
"${DESTROY_CMD[@]}"

popd >/dev/null
