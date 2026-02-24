#!/bin/bash
# Smoke checks for AWS testbed Terraform deployment.
#
# Validates:
# - ALB health endpoints
# - Dashboard CloudFront availability
# - Service-specific health routes exposed through ALB

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform/environments/aws-testbed"

if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform is required but was not found in PATH"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required but was not found in PATH"
  exit 1
fi

if [[ ! -d "${TF_DIR}" ]]; then
  echo "ERROR: terraform directory not found: ${TF_DIR}"
  exit 1
fi

read_output() {
  local key="$1"
  local value
  if value=$(terraform -chdir="${TF_DIR}" output -raw "${key}" 2>/dev/null); then
    printf '%s' "${value}"
  else
    printf ''
  fi
}

ALB_DNS_NAME="$(read_output alb_dns_name)"
CLOUDFRONT_DOMAIN_NAME="$(read_output cloudfront_domain_name)"

if [[ -z "${ALB_DNS_NAME}" ]]; then
  echo "ERROR: missing Terraform output 'alb_dns_name' in ${TF_DIR}"
  exit 1
fi

if [[ -z "${CLOUDFRONT_DOMAIN_NAME}" ]]; then
  echo "ERROR: missing Terraform output 'cloudfront_domain_name' in ${TF_DIR}"
  exit 1
fi

checks_passed=0
checks_failed=0

pass_checks=()
fail_checks=()

check_url() {
  local name="$1"
  local url="$2"
  local allowed_codes_csv="$3"

  local http_code
  local curl_status=0
  http_code=$(curl --silent --show-error --location --max-time 15 --output /dev/null --write-out '%{http_code}' --insecure "${url}") || curl_status=$?

  if [[ ${curl_status} -ne 0 ]]; then
    fail_checks+=("${name} -> CURL_ERR_${curl_status} (${url})")
    checks_failed=$((checks_failed + 1))
    return
  fi

  IFS=',' read -r -a allowed_codes <<< "${allowed_codes_csv}"
  for code in "${allowed_codes[@]}"; do
    if [[ "${http_code}" == "${code}" ]]; then
      pass_checks+=("${name} -> ${http_code}")
      checks_passed=$((checks_passed + 1))
      return
    fi
  done

  fail_checks+=("${name} -> ${http_code} (${url})")
  checks_failed=$((checks_failed + 1))
}

# ALB/service health endpoints exposed via listener rules.
check_url "ALB gateway health" "https://${ALB_DNS_NAME}/api/health" "200"
check_url "ALB auth health" "https://${ALB_DNS_NAME}/auth/health" "200"
check_url "ALB collaboration health" "https://${ALB_DNS_NAME}/ws/health" "200"
check_url "ALB h2-ingest health" "https://${ALB_DNS_NAME}/ingest/health" "200"
check_url "ALB prometheus health" "https://${ALB_DNS_NAME}/prometheus/-/healthy" "200"
check_url "ALB grafana health" "https://${ALB_DNS_NAME}/grafana/api/health" "200"

# Dashboard CloudFront distribution availability.
check_url "Dashboard CloudFront" "https://${CLOUDFRONT_DOMAIN_NAME}/" "200,301,302,307,308"

total_checks=$((checks_passed + checks_failed))

echo "Smoke test summary: ${checks_passed}/${total_checks} passed, ${checks_failed} failed"

if [[ ${checks_passed} -gt 0 ]]; then
  echo "Passed checks:"
  for item in "${pass_checks[@]}"; do
    echo "  + ${item}"
  done
fi

if [[ ${checks_failed} -gt 0 ]]; then
  echo "Failed checks:"
  for item in "${fail_checks[@]}"; do
    echo "  - ${item}"
  done
  exit 1
fi

exit 0
