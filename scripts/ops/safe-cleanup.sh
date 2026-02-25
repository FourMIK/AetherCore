#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

APPLY=0
DEEP=0
KEEP_RELEASE_APP=1

usage() {
  cat <<'EOF'
Safe cleanup for AetherCore workspace.

Default behavior is DRY RUN (no deletions).

Usage:
  scripts/ops/safe-cleanup.sh [--apply] [--deep] [--drop-release-app] [--help]

Options:
  --apply             Actually delete files (otherwise dry-run only).
  --deep              Remove additional large build outputs.
  --drop-release-app  Allow deleting the release app bundle in deep mode.
  --help              Show this help.

Examples:
  # Show what would be deleted (safe, no changes)
  scripts/ops/safe-cleanup.sh

  # Reclaim most space while keeping latest release app bundle
  scripts/ops/safe-cleanup.sh --deep --apply
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --deep)
      DEEP=1
      shift
      ;;
    --drop-release-app)
      KEEP_RELEASE_APP=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

declare -a PATHS=(
  "$ROOT_DIR/target/debug"
  "$ROOT_DIR/target/aarch64-apple-darwin"
  "$ROOT_DIR/packages/dashboard/dist"
)

if [[ "$DEEP" -eq 1 ]]; then
  PATHS+=(
    "$ROOT_DIR/target/release/deps"
    "$ROOT_DIR/target/release/build"
    "$ROOT_DIR/target/release/incremental"
    "$ROOT_DIR/target/release/resources"
    "$ROOT_DIR/packages/dashboard/src-tauri/resources/macos/local-control-plane/pnpm-store"
    "$ROOT_DIR/packages/dashboard/src-tauri/resources/macos/local-control-plane/packages/shared/node_modules"
    "$ROOT_DIR/packages/dashboard/src-tauri/resources/macos/local-control-plane/services/gateway/node_modules"
    "$ROOT_DIR/packages/dashboard/src-tauri/resources/macos/local-control-plane/services/collaboration/node_modules"
  )
  if [[ "$KEEP_RELEASE_APP" -eq 0 ]]; then
    PATHS+=("$ROOT_DIR/target/release/bundle/macos/AetherCore Commander.app")
  fi
fi

size_kb() {
  local p="$1"
  if [[ -e "$p" ]]; then
    du -sk "$p" 2>/dev/null | awk '{print $1}'
  else
    echo 0
  fi
}

human_mb() {
  local kb="$1"
  awk -v kb="$kb" 'BEGIN { printf "%.1f MB", kb / 1024 }'
}

is_safe_path() {
  local p="$1"
  [[ "$p" == "$ROOT_DIR/"* ]]
}

echo "Workspace: $ROOT_DIR"
echo "Mode: $([[ "$APPLY" -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo "Depth: $([[ "$DEEP" -eq 1 ]] && echo DEEP || echo STANDARD)"
echo

total_kb=0
for p in "${PATHS[@]}"; do
  kb="$(size_kb "$p")"
  total_kb=$((total_kb + kb))
  if [[ -e "$p" ]]; then
    echo " - $p ($(human_mb "$kb"))"
  else
    echo " - $p (missing)"
  fi
done

echo
echo "Estimated reclaimable: $(human_mb "$total_kb")"

if [[ "$APPLY" -ne 1 ]]; then
  echo
  echo "Dry-run complete. Re-run with --apply to delete."
  exit 0
fi

echo
echo "Deleting selected paths..."
for p in "${PATHS[@]}"; do
  if [[ ! -e "$p" ]]; then
    continue
  fi
  if ! is_safe_path "$p"; then
    echo "SKIP (unsafe path): $p" >&2
    continue
  fi
  rm -rf "$p"
  echo "Deleted: $p"
done

echo
echo "Cleanup complete."
