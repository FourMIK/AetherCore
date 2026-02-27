#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_ID="com.aethercore.commander"

pick_profile() {
  local explicit_path="${1:-}"
  if [[ -n "$explicit_path" ]]; then
    if [[ -f "$explicit_path" ]]; then
      echo "$explicit_path"
      return 0
    fi

    # If caller passed a basename that exists in standard profile dirs with a
    # different extension, try resolving it.
    local explicit_base
    explicit_base="$(basename "$explicit_path")"
    local probe
    for probe in \
      "$HOME/Downloads/$explicit_base" \
      "$HOME/Downloads/$explicit_base.provisionprofile" \
      "$HOME/Downloads/$explicit_base.mobileprovision" \
      "$HOME/Library/MobileDevice/Provisioning Profiles/$explicit_base" \
      "$HOME/Library/MobileDevice/Provisioning Profiles/$explicit_base.provisionprofile" \
      "$HOME/Library/MobileDevice/Provisioning Profiles/$explicit_base.mobileprovision"
    do
      if [[ -f "$probe" ]]; then
        echo "$probe"
        return 0
      fi
    done

    return 1
  fi

  shopt -s nullglob
  local candidates=(
    "$HOME/Downloads"/*.provisionprofile
    "$HOME/Downloads"/*.mobileprovision
    "$HOME/Library/MobileDevice/Provisioning Profiles"/*.provisionprofile
    "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision
  )
  shopt -u nullglob

  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi

  ls -t "${candidates[@]}" 2>/dev/null | head -n 1
}

PROFILE_PATH="$(pick_profile "${1:-}")" || {
  echo "ERROR: no .provisionprofile found. Pass a profile path explicitly." >&2
  exit 1
}

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "ERROR: provisioning profile not found: $PROFILE_PATH" >&2
  exit 1
fi

PLIST_PATH="$(mktemp /tmp/aethercore-profile.XXXXXX.plist)"
trap 'rm -f "$PLIST_PATH"' EXIT

security cms -D -i "$PROFILE_PATH" >"$PLIST_PATH"

plist_get() {
  local key_path="$1"
  /usr/libexec/PlistBuddy -c "Print $key_path" "$PLIST_PATH" 2>/dev/null || true
}

PROFILE_NAME="$(plist_get :Name)"
TEAM_ID="$(plist_get :TeamIdentifier:0)"
APP_ID="$(plist_get :Entitlements:com.apple.application-identifier)"
EXPIRY="$(plist_get :ExpirationDate)"
PROVISIONED_DEVICES="$(plist_get :ProvisionedDevices)"
HOST_UDID="$(system_profiler SPHardwareDataType | awk -F': ' '/Provisioning UDID/{print $2}')"

ENTITLEMENTS_PATH="$ROOT_DIR/packages/dashboard/src-tauri/entitlements.plist"
ENT_TEAM_ID=""
ENT_APP_ID=""
if [[ -f "$ENTITLEMENTS_PATH" ]]; then
  ENT_TEAM_ID="$(/usr/libexec/PlistBuddy -c "Print :com.apple.developer.team-identifier" "$ENTITLEMENTS_PATH" 2>/dev/null || true)"
  ENT_APP_ID="$(/usr/libexec/PlistBuddy -c "Print :com.apple.application-identifier" "$ENTITLEMENTS_PATH" 2>/dev/null || true)"
fi

IDENTITY_LINES="$(security find-identity -v -p codesigning 2>/dev/null | grep "Apple Development:" || true)"
FIRST_IDENTITY_NAME=""
FIRST_IDENTITY_TEAM_ID=""
FIRST_IDENTITY_HASH=""
MATCHING_IDENTITY_NAME=""
MATCHING_IDENTITY_TEAM_ID=""
MATCHING_IDENTITY_HASH=""

team_from_identity_name() {
  local identity_name="$1"
  local cert_subject
  cert_subject="$(security find-certificate -a -c "$identity_name" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | head -n 1 || true)"
  echo "$cert_subject" | sed -nE 's/.*OU=([A-Z0-9]{10}).*/\1/p'
}

if [[ -n "$IDENTITY_LINES" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    hash="$(echo "$line" | sed -nE 's/^[[:space:]]*[0-9]+\) ([A-F0-9]{40}) .*/\1/p' || true)"
    name="$(echo "$line" | sed -E 's/.*"([^"]+)".*/\1/' || true)"
    team="$(team_from_identity_name "$name")"
    if [[ -z "$team" ]]; then
      # Fallback only; many Apple Development cert display names include a token
      # in parentheses that is not always the Team ID.
      team="$(echo "$name" | sed -nE 's/.*\(([A-Z0-9]{10})\).*/\1/p' || true)"
    fi
    if [[ -z "$FIRST_IDENTITY_NAME" ]]; then
      FIRST_IDENTITY_NAME="$name"
      FIRST_IDENTITY_TEAM_ID="$team"
      FIRST_IDENTITY_HASH="$hash"
    fi
    if [[ -n "$TEAM_ID" && "$team" == "$TEAM_ID" && -z "$MATCHING_IDENTITY_NAME" ]]; then
      MATCHING_IDENTITY_NAME="$name"
      MATCHING_IDENTITY_TEAM_ID="$team"
      MATCHING_IDENTITY_HASH="$hash"
    fi
  done <<< "$IDENTITY_LINES"
fi

IDENTITY_NAME="$FIRST_IDENTITY_NAME"
IDENTITY_TEAM_ID="$FIRST_IDENTITY_TEAM_ID"

EXPECTED_APP_ID=""
if [[ -n "$TEAM_ID" ]]; then
  EXPECTED_APP_ID="${TEAM_ID}.${BUNDLE_ID}"
fi

has_device="no"
if [[ -n "$HOST_UDID" ]] && [[ "$PROVISIONED_DEVICES" == *"$HOST_UDID"* ]]; then
  has_device="yes"
fi

echo "== Profile =="
echo "Path: $PROFILE_PATH"
echo "Name: ${PROFILE_NAME:-<missing>}"
echo "Team ID: ${TEAM_ID:-<missing>}"
echo "App ID: ${APP_ID:-<missing>}"
echo "Expires: ${EXPIRY:-<missing>}"
echo "Expected App ID: ${EXPECTED_APP_ID:-<unknown>}"
echo
echo "== Device =="
echo "Mac Provisioning UDID: ${HOST_UDID:-<missing>}"
echo "Profile contains this UDID: $has_device"
echo
echo "== Local Signing Identity =="
echo "Identity: ${IDENTITY_NAME:-<missing>}"
echo "Identity Team ID (cert OU): ${IDENTITY_TEAM_ID:-<missing>}"
echo "Team-matching Identity: ${MATCHING_IDENTITY_NAME:-<missing>}"
echo "Team-matching Identity SHA1: ${MATCHING_IDENTITY_HASH:-<missing>}"
echo
echo "== Repo Entitlements =="
echo "File: $ENTITLEMENTS_PATH"
echo "Entitlements Team ID: ${ENT_TEAM_ID:-<missing>}"
echo "Entitlements App ID: ${ENT_APP_ID:-<missing>}"
echo

failures=0

if [[ -z "$TEAM_ID" ]]; then
  echo "FAIL: profile Team ID missing"
  failures=$((failures + 1))
fi

if [[ -z "$APP_ID" || -z "$EXPECTED_APP_ID" || "$APP_ID" != "$EXPECTED_APP_ID" ]]; then
  echo "FAIL: profile App ID mismatch (expected $EXPECTED_APP_ID)"
  failures=$((failures + 1))
else
  echo "PASS: profile App ID matches expected bundle identifier"
fi

if [[ "$has_device" != "yes" ]]; then
  echo "FAIL: profile does not include this Mac's Provisioning UDID"
  failures=$((failures + 1))
else
  echo "PASS: profile includes this Mac device"
fi

if [[ -z "$IDENTITY_NAME" || -z "$IDENTITY_TEAM_ID" ]]; then
  echo "FAIL: no usable Apple Development signing identity found in keychain"
  failures=$((failures + 1))
elif [[ -z "$MATCHING_IDENTITY_NAME" ]]; then
  echo "FAIL: no local Apple Development identity matches profile team ($TEAM_ID)"
  failures=$((failures + 1))
else
  echo "PASS: signing identity team matches profile team"
fi

if [[ -n "$TEAM_ID" && "$ENT_TEAM_ID" == "$TEAM_ID" && "$ENT_APP_ID" == "$EXPECTED_APP_ID" ]]; then
  echo "PASS: repo entitlements already match selected team"
else
  echo "WARN: repo entitlements do not match selected team yet (will auto-sync during build when env vars are set)"
fi

echo
echo "== Next Commands =="
if [[ -n "$TEAM_ID" && -n "$MATCHING_IDENTITY_NAME" ]]; then
  sign_value="$MATCHING_IDENTITY_NAME"
  if [[ -n "$MATCHING_IDENTITY_HASH" ]]; then
    sign_value="$MATCHING_IDENTITY_HASH"
  fi
  cat <<EOF
export APPLE_TEAM_ID="$TEAM_ID"
export APPLE_SIGNING_IDENTITY="$sign_value"
cd "$ROOT_DIR"
pnpm --dir packages/dashboard tauri build --bundles app --ignore-version-mismatches
AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP=0 AETHERCORE_SEP_ALLOW_EPHEMERAL=1 scripts/ops/launch-se-attestation.sh
EOF
else
  cat <<EOF
# Resolve team mismatch first:
# 1) Create/import an Apple Development cert for team $TEAM_ID, OR
# 2) Generate a provisioning profile in the same team as your existing cert ($IDENTITY_TEAM_ID)
# Then rerun this check.
cd "$ROOT_DIR"
scripts/ops/check-macos-se-readiness.sh "$PROFILE_PATH"
EOF
fi

if [[ "$failures" -ne 0 ]]; then
  exit 2
fi
