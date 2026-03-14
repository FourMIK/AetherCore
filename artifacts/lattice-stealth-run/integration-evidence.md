# Lattice Stealth Read-Only Integration Run Evidence

Generated: 2026-03-14T15:43:09.8422275-04:00

## Runtime
- Mock Lattice REST: http://127.0.0.1:4010
- Gateway: http://127.0.0.1:3100
- Lattice Bridge: http://127.0.0.1:3110

## Health Summary
- Bridge integration mode: stealth_readonly
- Bridge protocol mode: rest
- Bridge healthy: True
- Gateway status: ok
- Gateway tasks cached: 1
- Gateway overlays cached: 1

## Stealth Enforcement Check
- Overlay write status code: 403
- Overlay write code: STEALTH_READ_ONLY
- Overlay write message: Stealth read-only mode is active. Outbound Lattice overlay publish is disabled.

## Screenshots
1. Bridge status JSON: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\screenshots\01-bridge-status.png
2. Gateway status JSON: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\screenshots\02-gateway-status.png
3. Gateway read-only task inbox JSON: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\screenshots\03-gateway-tasks.png

## Raw JSON Artifacts
- Bridge status: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\bridge-status.json
- Gateway status: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\gateway-status.json
- Gateway tasks: C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\gateway-tasks.json
- Blocked overlay write (403 expected): C:\Users\Owner\StudioProjects\AetherCore\artifacts\lattice-stealth-run\blocked-overlay-write.json
