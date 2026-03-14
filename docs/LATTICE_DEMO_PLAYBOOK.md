# AetherCore x Lattice Demo Playbook (Stealth Read-Only)

## Scope

- Integration mode: `stealth_readonly`
- Protocol: `rest`
- Input mode: `synthetic`
- Scenario: `sf_bay_maritime_incursion_v1`
- Synthetic ingest cadence: `LATTICE_SYNTHETIC_INGEST_INTERVAL_MS` (default `2000` for demo acceleration)
- Target duration: 12 to 15 minutes

This playbook is operator-paced and uses manual phase controls from System Admin.

## Boot and Preflight

1. Run `pnpm run demo:lattice:boot` from repo root.
2. Confirm preflight is healthy:
   - `GET /api/lattice/status`
   - `GET /api/lattice/scenario/preflight`
3. Open Dashboard System Admin:
   - Verify profile is `Stealth + Synthetic`
   - Verify scenario state is `READY`
   - Confirm outbound Lattice writes are disabled (read-only banner present)

## 12 to 15 Minute Operator Sequence

1. Minute 0 to 2: Phase 0 Baseline
   - Keep phase at `phase_0_baseline`
   - Brief source badges and verification posture chips
   - Show snapshot + live event continuity on tactical map/list

2. Minute 2 to 5: Phase 1 Contact
   - `Advance` to `phase_1_contact`
   - Highlight first anomalous maritime contact and trust/freshness drift

3. Minute 5 to 8: Phase 2 Incursion
   - `Advance` to `phase_2_incursion`
   - Show adversary picture expansion, read-only task inbox growth, and evidence links

4. Minute 8 to 10: Fault Injection
   - Inject `spoof_burst`
   - Confirm trust posture changes become fail-visible (`SPOOFED` / degraded cues)
   - Optional: inject `stale_feed` to demonstrate freshness alarms

5. Minute 10 to 12: Phase 3 Response
   - `Advance` to `phase_3_response`
   - Clear faults individually or `Clear All Faults`
   - Show confidence recovery path and auditable scenario control trail

6. Minute 12 to 15: Phase 4 Resolution
   - `Advance` to `phase_4_resolution`
   - Reconfirm read-only safeguards:
     - no outbound overlay publish
     - no object upload/register
     - no task execution dispatch

## Fail-Visible Assertions During Demo

- Invalid events increment invalid-event counters in `/api/lattice/status`
- Preflight must show explicit pass/fail checklist entries
- Any unauthorized scenario/profile mutation fails closed with explicit error code
- Any write-path attempt returns `403` (`STEALTH_READ_ONLY`)
