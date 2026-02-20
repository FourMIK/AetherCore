# ATAK Trust CoT Schema

This document defines the AetherCore trust-event schema for Cursor-on-Target (CoT) payloads consumed by ATAK trust overlays.

## 1. CoT event type

Trust events **must** use the custom CoT `type` value:

- `a-f-AETHERCORE-TRUST`

Any other `type` value should be ignored by trust-specific subscribers.

## 2. Required `<detail>` keys

Inside `<event><detail>...</detail></event>`, include a `<trust>` element containing the following required attributes:

- `trust_score` (number): normalized trust score in the closed interval `[0.0, 1.0]`.
- `last_updated` (RFC 3339 UTC timestamp): source-of-truth update timestamp from the trust engine.
- Trust level handling:
  - Either provide `trust_level` explicitly (`healthy`, `suspect`, `quarantined`), **or**
  - Omit `trust_level` and derive it from `trust_score` using:
    - `healthy` for `trust_score >= 0.80`
    - `suspect` for `0.40 <= trust_score < 0.80`
    - `quarantined` for `trust_score < 0.40`

Recommended structure:

```xml
<detail>
  <trust
    trust_score="0.91"
    last_updated="2026-01-14T10:15:00Z"
    trust_level="healthy"/>
</detail>
```

## 3. Optional integrity metrics

The same `<trust>` element may include optional integrity metrics. When present, values should be numeric and constrained to these bounds:

- `integrity_packet_loss` in `[0.0, 1.0]`
- `integrity_clock_skew_ms` in `[0, 600000]`
- `integrity_signature_fail_rate` in `[0.0, 1.0]`
- `integrity_replay_events` in `[0, 10000]`
- `integrity_attestation_age_s` in `[0, 86400]`

Receivers should treat out-of-range values as malformed integrity metadata and either clamp or discard those keys without crashing the entire event pipeline.

## 4. Timestamp and staleness semantics

CoT root-level timestamps govern freshness:

- `time`: event creation timestamp (RFC 3339 UTC).
- `start`: observation/start timestamp (normally equal to `time` for trust snapshots).
- `stale`: expiry timestamp after which the trust event is no longer valid.

### TTL default

If a producer does not specify an explicit policy, compute staleness as:

- `stale = time + 300 seconds`

(`300s` is the default trust-event TTL.)

### Freshness handling rules

- If current time `<= stale`, event is fresh and may be rendered.
- If current time `> stale`, event is stale and should be visually downgraded or dropped.
- If `last_updated > stale`, treat payload as malformed.
- If `time` is missing, unparsable, or not UTC-normalized, treat payload as malformed.

## 5. Minimal valid trust-event skeleton

```xml
<event version="2.0"
       uid="trust-node-001"
       type="a-f-AETHERCORE-TRUST"
       how="m-g"
       time="2026-01-14T10:15:00Z"
       start="2026-01-14T10:15:00Z"
       stale="2026-01-14T10:20:00Z">
  <point lat="34.123456" lon="-117.123456" hae="0.0" ce="20.0" le="20.0"/>
  <detail>
    <trust trust_score="0.91"
           last_updated="2026-01-14T10:15:00Z"
           trust_level="healthy"/>
  </detail>
</event>
```
