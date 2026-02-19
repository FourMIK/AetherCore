#!/bin/bash
# AetherCore AWS Testbed bootstrap wrapper
#
# Usage: ./bootstrap-aws-testbed.sh [aws-region]
#
# This wraps bootstrap-aws.sh with testbed-specific naming so Terraform
# remote state and locking resources are isolated from other environments.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_REGION="${1:-us-east-1}"
TESTBED_PROJECT_NAME="aethercore-aws-testbed"

"${SCRIPT_DIR}/bootstrap-aws.sh" "${AWS_REGION}" "${TESTBED_PROJECT_NAME}"
