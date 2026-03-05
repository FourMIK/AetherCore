# ATAK-Civ Integration Audit (2026-03-04)

## Scope
- `plugins/atak-trust-overlay` plugin packaging
- Trust CoT ingestion and marker rendering behavior
- Operator-facing telemetry/runtime behavior

## Baseline compared
- Official ATAK-CIV plugin template from `TAK-Product-Center/atak-civ`:
  - `plugin-examples/plugintemplate/app/src/civ/AndroidManifest.xml`
  - `plugin-examples/plugintemplate/app/src/main/assets/plugin.xml`
  - `plugin-examples/plugintemplate/app/build.gradle`

## Findings addressed
1. **Plugin descriptor/entrypoint drift from ATAK template**
   - Added ATAK `IPlugin` entrypoint wrapper (`TrustOverlayPlugin`) and updated `assets/plugin.xml` extension type to `gov.tak.api.plugin.IPlugin`.
   - Added ATAK component-discovery activity (`TrustOverlayPluginComponentActivity`) with `com.atakmap.app.component` intent filter.
   - Added legacy-compatible plugin metadata fields in `AndroidManifest.xml`.

2. **Manifest gaps affecting runtime**
   - Added missing network permissions (`INTERNET`, `ACCESS_NETWORK_STATE`).
   - Added missing `TelemetryService` declaration.

3. **Operator-impacting telemetry reliability issues**
   - Fixed telemetry loop startup race (service now schedules heartbeat reliably on start).
   - Replaced non-unique `Build.FINGERPRINT.take(32)` node id with stable hashed node id persisted in preferences.
   - Removed hardcoded gateway usage from telemetry/monitor logic in favor of configurable gateway base URL (`BuildConfig.AETHERCORE_GATEWAY_URL` + preferences override).
   - Added overlay ingress header (`X-AetherCore-Overlay: android`) and live network state reporting.

4. **Trust CoT parsing fidelity issues**
   - Added fallback parsing for embedded `<detail>` XML payloads (common ATAK CoT shape).
   - Added parsing/validation for signature verification metadata (`trust.signature_verified`).
   - Tightened defaults to reject unknown trust sources unless explicitly allowed.

5. **Operator visualization mismatch**
   - Corrected marker severity logic so unsigned-but-valid trust events are no longer forced red.
   - Kept red for stale, low/unknown trust, and signed-unverified events.

6. **Map performance under sustained feed load**
   - Added stale-state sweep throttling in `TrustOverlayMapComponent` to avoid full stale-marker redraw on every event.

## Remaining external dependency
- ATAK-Civ distribution/signing constraints still apply for production plugin loading path. Packaging now aligns with template expectations for future certification/integration workflows.

## Validation status in this environment
- Gateway integration tests: **passed**.
- ATAK plugin Gradle tests: **not runnable in this environment** (Gradle wrapper JAR missing; no global Gradle installed).

## Required manual validation artifact for dev merge
- Store validation evidence in `plugins/atak-trust-overlay/validation/ATAK_CIV_MANUAL_VALIDATION_2026-03-04.md`.
- Checklist (must be completed by operator/release engineer):
  - Build plugin in ATAK-Civ-compatible environment (Gradle + signing path available).
  - Verify plugin load/discovery in ATAK-Civ and component registration.
  - Verify trust CoT ingestion and marker rendering parity under live feed.
  - Verify telemetry loop behavior and configurable gateway routing on device.
  - Attach install/runtime screenshots and signer/build fingerprint metadata.
- CI remains non-blocking for ATAK plugin checks in this pass; this artifact is the merge gate evidence.

## References
- https://github.com/TAK-Product-Center/atak-civ/blob/main/plugin-examples/plugintemplate/app/src/main/AndroidManifest.xml
- https://github.com/TAK-Product-Center/atak-civ/blob/main/plugin-examples/plugintemplate/app/src/main/assets/plugin.xml
- https://github.com/TAK-Product-Center/atak-civ/blob/main/plugin-examples/plugintemplate/app/build.gradle
