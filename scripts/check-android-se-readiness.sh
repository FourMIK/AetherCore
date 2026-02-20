#!/usr/bin/env bash
set -euo pipefail

# One-command Android Secure Element / StrongBox readiness probe.
# Output is key=value to be machine-readable in CI while still operator friendly.

REQUIRE_STRONGBOX="${REQUIRE_STRONGBOX:-0}"

emit() {
  printf '%s=%s\n' "$1" "$2"
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 2
}

if ! command -v adb >/dev/null 2>&1; then
  emit status "NOT_READY"
  emit reason "adb_missing"
  fail "Android platform-tools (adb) is not installed or not in PATH"
fi

state="$(adb get-state 2>/dev/null || true)"
if [[ "$state" != "device" ]]; then
  emit status "NOT_READY"
  emit reason "device_not_connected"
  emit adb_state "${state:-unknown}"
  fail "No Android device in 'device' state"
fi

sdk="$(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
release="$(adb shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
brand="$(adb shell getprop ro.product.brand 2>/dev/null | tr -d '\r')"
model="$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r')"

features="$(adb shell pm list features 2>/dev/null | tr -d '\r')"

strongbox_feature="false"
if grep -q 'android.hardware.strongbox_keystore' <<<"$features"; then
  strongbox_feature="true"
fi

tee_feature="false"
if grep -q 'android.hardware.keystore' <<<"$features" || grep -q 'android.hardware.hardware_keystore' <<<"$features"; then
  tee_feature="true"
fi

keymint_version="$(adb shell getprop ro.hardware.keystore 2>/dev/null | tr -d '\r')"
verified_boot_state="$(adb shell getprop ro.boot.verifiedbootstate 2>/dev/null | tr -d '\r')"
device_locked="$(adb shell getprop ro.boot.flash.locked 2>/dev/null | tr -d '\r')"
patch_level="$(adb shell getprop ro.build.version.security_patch 2>/dev/null | tr -d '\r')"

emit device_brand "$brand"
emit device_model "$model"
emit android_release "$release"
emit android_sdk "$sdk"
emit verified_boot_state "${verified_boot_state:-unknown}"
emit bootloader_locked "${device_locked:-unknown}"
emit security_patch "${patch_level:-unknown}"
emit keystore_hw_feature "$tee_feature"
emit strongbox_feature "$strongbox_feature"
emit keystore_impl "${keymint_version:-unknown}"

if [[ "$strongbox_feature" == "true" ]]; then
  emit status "READY_STRONGBOX"
  emit recommendation "enable_android_se_required_for_selected_profiles"
  exit 0
fi

if [[ "$tee_feature" == "true" ]]; then
  if [[ "$REQUIRE_STRONGBOX" == "1" ]]; then
    emit status "NOT_READY"
    emit reason "strongbox_required_but_unavailable"
    fail "Device has hardware keystore but no StrongBox while REQUIRE_STRONGBOX=1"
  fi

  emit status "READY_TEE_FALLBACK"
  emit recommendation "allow_optional_mode_collect_telemetry"
  warn "StrongBox unavailable; running in trusted-environment fallback mode"
  exit 0
fi

emit status "NOT_READY"
emit reason "no_hardware_keystore_feature"
fail "Device does not advertise hardware-backed keystore features"
