#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail=0

echo "Checking for disallowed lockfiles..."
while IFS= read -r file; do
  case "$file" in
    _codeql_detected_source_root*) continue ;;
  esac
  if [[ "$file" == *"package-lock.json" || "$file" == *"yarn.lock" ]]; then
    echo "❌ Disallowed lockfile detected: $file"
    fail=1
  fi
done < <(git ls-files)

echo "Checking for disallowed npm/yarn install commands in tracked automation/docs..."
if rg -n "\\bnpm\\s+(ci|install)\\b|\\byarn\\s+(install|add)\\b|package-lock\\.json|yarn\\.lock" \
  --glob '!node_modules/**' \
  --glob '!.git/**' \
  --glob '!_codeql_detected_source_root/**' \
  --glob '!.pnpm-store/**' \
  --glob '!pnpm-lock.yaml' \
  --glob '!scripts/enforce-pnpm-policy.sh' \
  .github Dockerfile docker infra docs scripts README.md CONTRIBUTING.md DEPLOYMENT*.md ARCHITECTURE.md PROVENANCE.md RUNNING_ON_WINDOWS.md RELEASE*.md tests agent packages services; then
  echo "❌ Found disallowed package-manager usage. Use pnpm + pnpm-lock.yaml workflow only."
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "✅ pnpm policy checks passed."
