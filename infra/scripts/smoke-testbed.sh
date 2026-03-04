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

required_passed=0
required_failed=0
informational_passed=0
informational_failed=0

required_pass_checks=()
required_fail_checks=()
informational_pass_checks=()
informational_fail_checks=()

check_url() {
  local name="$1"
  local url="$2"
  local allowed_codes_csv="$3"
  local severity="${4:-required}"

  local http_code
  local curl_status=0
  http_code=$(curl --silent --show-error --location --max-time 15 --output /dev/null --write-out '%{http_code}' --insecure "${url}") || curl_status=$?

  local -n pass_bucket=required_pass_checks
  local -n fail_bucket=required_fail_checks
  local -n pass_counter=required_passed
  local -n fail_counter=required_failed

  if [[ "${severity}" == "informational" ]]; then
    pass_bucket=informational_pass_checks
    fail_bucket=informational_fail_checks
    pass_counter=informational_passed
    fail_counter=informational_failed
  fi

  if [[ ${curl_status} -ne 0 ]]; then
    fail_bucket+=("${name} -> CURL_ERR_${curl_status} (${url})")
    fail_counter=$((fail_counter + 1))
    return
  fi

  IFS=',' read -r -a allowed_codes <<< "${allowed_codes_csv}"
  for code in "${allowed_codes[@]}"; do
    if [[ "${http_code}" == "${code}" ]]; then
      pass_bucket+=("${name} -> ${http_code}")
      pass_counter=$((pass_counter + 1))
      return
    fi
  done

  fail_bucket+=("${name} -> ${http_code} (${url})")
  fail_counter=$((fail_counter + 1))
}

# External readiness gate (required): only 443-facing availability checks.
check_url "ALB gateway health" "https://${ALB_DNS_NAME}/api/health" "200" "required"
check_url "Dashboard CloudFront" "https://${CLOUDFRONT_DOMAIN_NAME}/" "200,301,302,307,308" "required"

# Informational checks (non-blocking): internal path dependencies behind the same ALB.
check_url "ALB auth health" "https://${ALB_DNS_NAME}/auth/health" "200" "informational"
check_url "ALB collaboration health" "https://${ALB_DNS_NAME}/ws/health" "200" "informational"
check_url "ALB h2-ingest health" "https://${ALB_DNS_NAME}/ingest/health" "200" "informational"
check_url "ALB prometheus health" "https://${ALB_DNS_NAME}/prometheus/-/healthy" "200" "informational"
check_url "ALB grafana health" "https://${ALB_DNS_NAME}/grafana/api/health" "200" "informational"

required_total=$((required_passed + required_failed))
informational_total=$((informational_passed + informational_failed))

echo "Smoke test summary (required): ${required_passed}/${required_total} passed, ${required_failed} failed"
echo "Smoke test summary (informational): ${informational_passed}/${informational_total} passed, ${informational_failed} failed"

if [[ ${required_passed} -gt 0 ]]; then
  echo "Required checks passed:"
  for item in "${required_pass_checks[@]}"; do
    echo "  + ${item}"
  done
fi

if [[ ${required_failed} -gt 0 ]]; then
  echo "Required checks failed:"
  for item in "${required_fail_checks[@]}"; do
    echo "  - ${item}"
  done
  exit 1
fi

if [[ ${informational_passed} -gt 0 ]]; then
  echo "Informational checks passed:"
  for item in "${informational_pass_checks[@]}"; do
    echo "  + ${item}"
  done
fi

if [[ ${informational_failed} -gt 0 ]]; then
  echo "Informational checks failed (non-blocking under 443-only readiness policy):"
  for item in "${informational_fail_checks[@]}"; do
    echo "  - ${item}"
  done
fi

exit 0
