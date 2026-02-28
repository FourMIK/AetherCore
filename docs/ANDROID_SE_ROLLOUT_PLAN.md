# Android Secure Element Rollout Plan

This rollout introduces Android hardware-backed attestation with StrongBox preference and deterministic fallback.

## Phased rollout

### Phase 0 — Optional (observe only)

- Deploy verification logic in **optional mode** (do not block enrollment/traffic yet).
- Run `scripts/check-android-se-readiness.sh` against representative device fleets.
- Record telemetry dimensions:
  - `strongbox_feature` (true/false)
  - `keystore_hw_feature` (true/false)
  - `verified_boot_state`
  - `bootloader_locked`
  - `security_patch`
  - resulting `policy_tier`

**Operator goal:** establish baseline fleet support and identify unsupported SKUs.

### Phase 1 — Guard-railed enablement

- Keep global policy optional, but enforce StrongBox-required posture on selected high-assurance profiles only.
- Profiles that cannot satisfy StrongBox remain in fallback (`trusted_environment`) path with explicit labeling.
- Alert on drift:
  - devices regressing from `READY_STRONGBOX` to `READY_TEE_FALLBACK`
  - devices reporting `NOT_READY`

**Operator goal:** confine mandatory enforcement to selected profiles while reducing outage risk.

### Phase 2 — Required enforcement for selected profiles

- Mark Android SE attestation as required for selected mission profiles.
- Reject enrollments when probe status is `NOT_READY` for those profiles.
- Maintain fallback allowance for non-selected profiles until fleet readiness reaches target threshold.

**Operator goal:** harden high-assurance paths first, then expand based on telemetry confidence.

## Probe command and expected outputs

Run:

```bash
./scripts/check-android-se-readiness.sh
```

### Expected: StrongBox-capable

- `status=READY_STRONGBOX`
- `strongbox_feature=true`
- `keystore_hw_feature=true`

**Operator action:** eligible for required StrongBox profile.

### Expected: Fallback without StrongBox

- `status=READY_TEE_FALLBACK`
- `strongbox_feature=false`
- `keystore_hw_feature=true`

**Operator action:** allow only in optional/fallback profile; track remediation/refresh plan.

### Expected: Not ready

- `status=NOT_READY`
- reason in `reason=...` (`adb_missing`, `device_not_connected`, `no_hardware_keystore_feature`, `strongbox_required_but_unavailable`)

**Operator action:** block high-assurance rollout for affected units; remediate tooling/connectivity/SKU selection.

## CI/manual usage notes

- For CI gate on StrongBox-only fleets:

```bash
REQUIRE_STRONGBOX=1 ./scripts/check-android-se-readiness.sh
```

- Exit behavior:
  - `0` for `READY_STRONGBOX` or `READY_TEE_FALLBACK` (unless StrongBox is required)
  - non-zero for `NOT_READY`
