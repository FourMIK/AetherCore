# AetherCore Trust Overlay - Operator Quickstart

## Mission use
1. Install ATAK-Civ and `atak-trust-overlay` APK on the same device.
2. Launch **AetherCore Trust Monitor** once after install.
3. Confirm:
   - `Backend Connected` is green.
   - `Telemetry Service Active` is green.
   - ATAK-Civ install detection is `✓`.
4. Open ATAK and validate trust markers appear for CoT type `a-f-AETHERCORE-TRUST`.

## What marker colors mean
- `Green`: high-trust, fresh state.
- `Amber`: suspect/medium trust.
- `Red`: quarantined/low trust, stale state, or signed-but-unverified state.

## Field checks
1. Tap a trust marker.
2. Verify panel values:
   - `Trust Score`
   - `Trust Level`
   - `Freshness`
   - `Signature Status`
   - `Source`
3. If `Signature Status` is `UNVERIFIED`, treat as suspect until validated by command policy.

## Gateway endpoint override
- Default endpoint comes from `BuildConfig.AETHERCORE_GATEWAY_URL`.
- Runtime override key in private preferences:
  - file: `atak_trust_overlay`
  - key: `gateway.base.url`

## Troubleshooting
- No markers:
  - Confirm incoming CoT type is `a-f-AETHERCORE-TRUST`.
  - Check logs for `trust_event_rejected`.
- Backend red:
  - Verify gateway `/health` is reachable from device network.
- Plugin not discovered:
  - Confirm installation source/signing path for your ATAK-Civ distribution policy.
