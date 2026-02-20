#!/usr/bin/env bash
set -euo pipefail

SRC_JAR="${1:-atak/ATAK/app/build/libs/main.jar}"
DEST_JAR="${2:-artifacts/main.jar}"
EXPECTED_SHA="6a7a774df859fbd8ee5181a7858c7bf9f58aaca8943e39e5cb73c6276515bfd3"

if [[ ! -f "$SRC_JAR" ]]; then
  echo "ERROR: source artifact not found: $SRC_JAR" >&2
  exit 1
fi

ACTUAL_SHA="$(sha256sum "$SRC_JAR" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR: checksum mismatch for $SRC_JAR" >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  actual:   $ACTUAL_SHA" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_JAR")"
cp "$SRC_JAR" "$DEST_JAR"
echo "Copied $SRC_JAR -> $DEST_JAR"
