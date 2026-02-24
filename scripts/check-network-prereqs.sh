#!/usr/bin/env bash
set -euo pipefail

HOSTS=(
  github.com
  api.github.com
  api.githubcopilot.com
  azure.archive.ubuntu.com
  esm.ubuntu.com
  motd.ubuntu.com
  packages.microsoft.com
  registry.npmjs.org
  index.crates.io
)

echo "🔎 Running network prerequisite checks for CI runner..."

FAILURES=0
for host in "${HOSTS[@]}"; do
  if getent ahosts "$host" >/dev/null 2>&1; then
    echo "✅ DNS resolution ok: $host"
  else
    echo "❌ DNS resolution failed: $host"
    FAILURES=$((FAILURES + 1))
  fi
done

if [ "$FAILURES" -gt 0 ]; then
  cat <<'MSG'

One or more required hosts could not be resolved.
This environment is missing required outbound DNS/network access for CI.

Recommended remediation:
  1. Allow DNS + HTTPS access to the failed hosts above.
  2. For GitHub Copilot coding-agent jobs, include api.githubcopilot.com.
  3. If using GitHub Actions firewall policies, configure setup steps and host allowlists:
     - https://gh.io/copilot/actions-setup-steps
     - https://gh.io/copilot/firewall-config

Failing early to avoid long retry loops and opaque timeout/circuit-breaker errors.
MSG
  exit 1
fi

echo "✅ Network prerequisite check passed."
