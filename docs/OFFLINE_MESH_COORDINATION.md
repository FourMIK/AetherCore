# Offline Mesh Coordination - Implementation Guide

## Autonomous Operations Without Central C2 Authority

##

## Classification: OPERATIONAL

## Purpose: Enable CodeRalphie swarms to coordinate independently

## Doctrine: "Distributed Trust, Autonomous Consensus"

---

## Overview

When C2 link is unavailable (RF degradation, backhaul failure), the mesh must continue operating autonomously. This document describes the offline coordination protocol that enables:

1. **Local Authority Delegation** - Squad leaders make decisions within trust bounds
2. **Quorum Consensus** - Units reach group decisions without voting
3. **Peer-to-Peer Synchronization** - Merkle Vine chains sync via gossip
4. **Trust Chain Maintenance** - Cryptographic verification continues locally

---

## Offline Activation Triggers

The system automatically transitions to offline/autonomous mode when:

```yaml
# In degraded-rf-resilience.yaml:
c2_connection:
  state_machine:
    degraded_mode_threshold_seconds: 60 # After 60s, enter DEGRADED
    autonomous_mode_threshold_seconds: 300 # After 5min, enter AUTONOMOUS
```

### Mode Progression

```
CONNECTED (normal operation)
    ↓ [C2 timeout 60s]
DEGRADED (buffering decisions)
    ↓ [C2 timeout 300s total]
AUTONOMOUS (distributed consensus)
    ↓ [C2 restored]
CONNECTED (resume normal)
```

### Key Difference: DEGRADED vs AUTONOMOUS

| Aspect           | DEGRADED          | AUTONOMOUS      |
| ---------------- | ----------------- | --------------- |
| C2 Authority     | Attempted, queued | Disregarded     |
| Quorum Required  | No                | Yes (N-1)       |
| Local Delegation | Limited           | Full            |
| Consensus        | N/A               | Required        |
| Merkle Vine      | C2-synced         | Local-only      |
| Risk Assessment  | Conservative      | Mission-focused |

---

## Authority Delegation Model

In autonomous mode, units rely on **local delegation** - pre-configured trust limits for commanders:

```yaml
# Authority delegation in degraded-rf-resilience.yaml:
offline_mesh:
  authority_delegation:
    enabled: true
    movement_authorization_radius_meters: 500
    fire_support_max_range_km: 10
```

### Squad Leader Authority Levels

```
┌─────────────────────────────────────────────┐
│ C2 (OPERATOR)                               │
│ - Unrestricted authority                    │
│ - Signs all commands with operator_id       │
│ - Requires confirmation from units          │
└─────────────────────────────────────────────┘
         ↓ (when C2 unavailable)
┌─────────────────────────────────────────────┐
│ FSO-01 (Squad Leader / Fire Support)        │
│ - Can authorize movements within 500m       │
│ - Can authorize fire support 0-10km range   │
│ - Can pull triggers for assigned assets     │
│ - CANNOT authorize strategic moves > 500m   │
└─────────────────────────────────────────────┘
         ↓ (if FSO-01 also unreachable)
┌─────────────────────────────────────────────┐
│ Unit Consensus (N-1 Quorum)                 │
│ - Units reach their own decisions           │
│ - Requires consensus (75% agreement)        │
│ - Safe default: HOLD_POSITION (no hazard)   │
│ - Risky default: Reject (don't assume)      │
└─────────────────────────────────────────────┘
```

---

## Quorum Consensus Algorithm

When neither C2 nor squad leader can authorize, units form quorum:

```
Scenario: 6 units (ISR-01, ISR-02, FSO-01, MULE-1, MULE-2, C2)
FSO-01 proposes: "MULE-1 move to waypoint X (500m away)"

Quorum Formation:
1. FSO-01 (proposer) + ISR-01, ISR-02, MULE-1, MULE-2 (5 units, missing C2)
2. Number of units in quorum: 5
3. Threshold votes needed: ceil(5 * 0.75) = 4 units must agree

Voting (60-second timeout):
  ISR-01: "Movement feasible, agree" ✓
  ISR-02: "Threat detected nearby, disagree" ✗
  MULE-1: "I concur, ready to move" ✓
  MULE-2: "Movement authorized, agree" ✓
  [60s timeout, C2 still absent]

Final tally:
  For:     3 units (ISR-01, MULE-1, MULE-2)
  Against: 1 unit (ISR-02)
  Missing: C2

Consensus: 3/5 = 60% < 75% required
Result: REJECTED - insufficient quorum

Safe default behavior: HOLD_POSITION (no risky moves without consensus)
```

---

## State Synchronization (Gossip Protocol)

In autonomous mode, units maintain shared state via **gossip**:

```yaml
mesh:
  gossip:
    enabled: true
    gossip_interval_ms: 5000 # Share every 5 seconds
    max_fanout: 3 # Send to 3 neighbors
    push_pull_ratio: 0.6 # 60% push, 40% pull
```

### Gossip Message Content

Each unit periodically shares:

```json
{
  "gossip_round": 12345,
  "source_unit": "ISR-01",
  "timestamp_ms": 1707882345000,

  "merkle_vine_leaf": {
    "track_id": "uuid-1234",
    "latest_position": {...},
    "latest_hash": "aaaa...",
    "ancestor_chain": [...],
    "signature": "..."
  },

  "decisions_log": [
    {
      "decision_id": "uuid-5678",
      "intent": "MOVE waypoint",
      "consensus_votes": 4,
      "threshold": 4,
      "status": "APPROVED"
    }
  ],

  "revocation_updates": {
    "newly_revoked": ["UNIT-X"],
    "timestamp": 1707882345000
  },

  "gossip_signature": "..."
}
```

### Gossip Reliability

Gossip is **not guaranteed delivery** (UDP-like). To ensure critical updates:

1. **Push**: Source actively sends to 3 random peers
2. **Pull**: Peers occasionally request state from neighbors
3. **Anti-entropy**: Periodic full sync with one peer per round

Result: High probability of state convergence within a few rounds, even with 25% packet loss.

---

## Merkle Vine Chain During Offline Operation

In offline mode, each unit maintains its own chain leaf:

```
Local Merkle Vine State (ISR-01):

Block 100 (pre-offline):
  Hash: aaaa...
  Data: position@38.53,-120.12
  Ancestor: previously synced from C2
  Signature: ISR-01's TPM-backed key

Block 101 (first offline):
  Hash: bbbb...
  Data: position@38.533,-120.121
  Ancestor: aaaa...
  Signature: ISR-01's TPM-backed key
  Origin: LOCAL (not synced from C2)

Block 102 (still offline, 30s):
  Hash: cccc...
  Data: intent HOLD_POSITION (quorum approved)
  Ancestor: bbbb...
  Signature: Quorum consensus signature
  Approvals: ISR-02, MULE-1, MULE-2 (3/5)
```

### Key Properties During Offline

- **Immutable**: Blocks cannot be changed (hash chain)
- **Attributable**: Each block signed by source unit or quorum
- **Ordered**: Clear ancestry through hashes
- **Verifiable**: Peer nodes can reconstruct and validate chains

When C2 reconnects, all offline blocks are:

1. **Transmitted** in batch to C2 (sorted by ancestry)
2. **Verified** by C2 (signatures + Merkle chain)
3. **Accepted** into central ledger (after audit)
4. **Logged** in "The Great Gospel" (for historian purposes)

---

## Conflict Resolution

If two units **disagree** about a fact (e.g., position of target), offline mode handles it:

```
Scenario: ISR-01 vs ISR-02 report same target at different locations

ISR-01 reports:  Target-123 @ 38.530, -120.120 (confidence 94%)
ISR-02 reports:  Target-123 @ 38.540, -120.130 (confidence 91%)
Distance apart:  ~1.5 km (impossible if same target)

Resolution:
1. FSO-01 notices conflict (distance > kinematic tolerance)
2. FSO-01 cannot definitively resolve without additional data
3. Action: Mark both reports UNVERIFIED, note conflicting sources
4. Strategy: Accept BOTH hypotheses, plan differently:
   - If ISR-01 correct → approach from north
   - If ISR-02 correct → approach from east
5. Human decision: Trust ISR-01's source (higher confidence)
6. Use ISR-01's position as "most likely truth"
```

### Byzantine Unit Handling

If ISR-01 has low trust score (< 50%), its report is **de-prioritized**:

```
Trust scores from gossip:
  ISR-01: 45% (low, maybe Byzantine)
  ISR-02: 92% (high, trusted)

Consensus: Use ISR-02's position if ISR-01 is below trust threshold

Request: Re-attest ISR-01 (prove key hasn't been compromised)
```

---

## Offline Termination & C2 Reconnection

When C2 link is restored:

```
Timeline:

12:47:23 [AUTONOMOUS MODE ACTIVATED] (C2 timeout 5+ minutes)
  Consensus decisions: 3 major moves, 1 targeting approval
  Offline duration: 5 minutes, 47 seconds

12:52:15 [C2 LINK RESTORED] Gateway detected reconnection

12:52:16 [SYNC INITIATED]
  Transmitting offline ledger...
  Size: 148 events
  Checksum: aaaa1111bbbb2222cccc3333dddd4444

12:52:18 [SYNC PROGRESS] 47 events acknowledged

12:52:19 [SYNC PROGRESS] 94 events acknowledged

12:52:20 [SYNC COMPLETE] All 148 events accepted

12:52:21 [STATE RECONCILIATION]
  C2 analysis: "3 offline moves approved by FSO-01, consensus valid"
  Action: APPROVE all offline decisions (audit trail logged)

12:52:22 [TRANSITION TO CONNECTED]
  Authority: C2 resumes control
  Unit status: All units report ready
  Gossip: Disabled (reverting to centralized C2 coordination)

12:52:23 [OPERATIONAL]
  "LINK ESTABLISHED" shown in dashboard
```

---

## Safety Guardrails in Offline Mode

The system implements several safety limits:

### 1. **Movement Authorization Radius**

```yaml
movement_authorization_radius_meters: 500 # FSO can only authorize 500m moves
```

Beyond 500m, requires quorum consensus.

### 2. **Fire Support Range**

```yaml
fire_support_max_range_km: 10 # FSO authorized fire up to 10km
```

Beyond 10km, requires human (C2) approval.

### 3. **Decision Timeout**

```yaml
decision_timeout_seconds: 30 # Quorum must decide within 30 seconds
```

If timeout → default to HOLD_POSITION (safe).

### 4. **Trust Decay**

```yaml
trust_decay_enabled: true
trust_decay_rate_percent_per_minute: 5 # Lose 5% trust per minute offline
```

After 20 minutes offline, units drop to 0% trust (full re-attestation required).

### 5. **Broadcast Minimization**

```yaml
gossip_interval_ms: 5000 # Only share every 5 seconds
max_fanout: 3 # Only to 3 neighbors (not all)
push_pull_ratio: 0.6 # Prefer push (lower bandwidth)
```

---

## Example: Offline Coordination Scenario

```
SCENARIO: FSO-01 and 2 Mules (MULE-1, MULE-2) in RF-denied area

Initial State (pre-offline):
  - C2 connected, all units healthy
  - ISR-01, ISR-02 forward (observing)
  - MULE-1, MULE-2 in support (ready for maneuver)
  - FSO-01 coordinating

T=0: C2 Link Lost
  [DEGRADED MODE] FSO-01 receives last command: "STANDBY"
  All units buffer any pending updates

T=60s: Still no C2
  [AUTONOMOUS MODE ACTIVATED]
  FSO-01 switches to local authority
  Gossip protocol begins (5s intervals)

T=90s: Threat Detected
  ISR-01 reports: "Hostile vehicle, 2km south, moving north"
  Report propagates via gossip to FSO-01, MULE-1, MULE-2

  Trust check: ISR-01 @ 94% trust (high confidence)

T=120s: FSO-01 Issues Command (LOCAL AUTHORITY)
  "MULE-1: Move to ambush position (350m away, within 500m limit)"
  Signature: FSO-01's TPM key
  "This exceeds my remote authorization but within local delegation."

  MULE-1 receives, verifies:
    - FSO-01 trusted (98% trust score)
    - Distance within local limit (350m < 500m) ✓
    - Kinematics feasible ✓
    - No conflicting orders in cache ✓

  MULE-1: ACCEPTED, begins move

  MULE-2 sees MULE-1 moving (via gossip)
  MULE-2: "I should support MULE-1"

  But MULE-2 does NOT have direct order from FSO-01

T=150s: MULE-2 Needs Quorum Decision
  MULE-2 proposes: "Move to support MULE-1 (300m away)"
  Quorum: MULE-2, ISR-01, ISR-02, MULE-1 (4 units, C2 absent, FSO-01 not answering)
  Threshold: ceil(4 * 0.75) = 3 votes needed to approve

  Voting (30s window):
    ISR-01: "Threat updates support move" ✓
    ISR-02: "Agree, move provides better coverage" ✓
    MULE-1: "Move into position to support me" ✓
    MULE-2: (proposer, self-vote counts) ✓

  Result: 4/4 unanimous, APPROVED
  MULE-2 moves to support position

T=180s: Engagement Authorized
  FSO-01 observes: "MULE-1 in ambush, target approaching"
  FSO-01 issues: "Fire when ready" (local authority, within 10km range)

  MULE-1 verifies: ✓ FSO-01 authorized, ✓ target confirmed, ✓ ready
  MULE-1: Engages (weapon control enabled offline)

  Offline Merkle Vine block created:
    - Block type: ENGAGEMENT
    - Authorized by: FSO-01 (TPM signature)
    - Timestamp: 1707882180000
    - Status: EXECUTED
    - Ancestor: previous block hash

T=240s: Target Eliminated, Withdrawal
  FSO-01: "Successful engagement. MULE-1, MULE-2, return to rally point"
  Both mules acknowledge, begin withdrawal
  ISR units maintain overwatch

T=300s (5 minutes): C2 LINK RESTORED!
  [SYNCING to C2]

  FSO-01 ledger sent to C2:
    - 148 total offline events
    - 1 FSO-authorized movement
    - 1 quorum-approved support move
    - 1 engagement execution
    - 3 ISR updates with threat data

  C2 audit result: "All actions within authority bounds, approved"

  Offline events logged in "Great Gospel" ledger:
    Date: 2026-02-13
    Duration: 5m 28s
    Units: MULE-1, MULE-2, ISR-01, ISR-02, FSO-01
    Summary: "Engagement under RF-denial, success"

T=305s: Resumption
  [CONNECTED MODE RESUMED]
  C2 retakes authority
  Units revert to centralized coordination
  Next mission: "EXFIL from AO"
```

---

## Performance Considerations

### Bandwidth

Gossip protocol minimizes bandwidth:

- **Push**: 1 KB per gossip message (headers + data)
- **Fanout 3**: 3 messages × 1 KB = 3 KB per round
- **Frequency**: Every 5 seconds
- **Total**: 3 KB / 5s = 0.6 KB/s = ~5 Kbps per unit

For 6-unit squad: 30 Kbps total (very lightweight)

### Latency

Decision latency during offline operation:

- **Local authority (FSO)**: < 100ms (local processing)
- **Quorum decision**: 30s timeout (wait for consensus votes)
- **Gossip propagation**: ~15 seconds (3 hops × 5s)

Trade-off: Accept higher latency (30s) for safety (consensus required).

### Failure Handling

If persistent network partitions occur:

```
Scenario: 6-unit mesh fragments into 2 groups (3 units each)

Group A (ISR-01, MULE-1, MULE-2):
  - Form quorum independently
  - Decisions require consensus (all 3 must agree)
  - Assumption: ISR-01 is "ground truth"

Group B (ISR-02, FSO-01, C2_STUB):
  - Act independently
  - FSO-01 has authority over this group
  - Assumption: FSO-01's decisions override

On reconnection (network heals):
  - C2 resolves conflicts (whose decisions take precedence?)
  - Audit both ledgers (which group's version is "truth"?)
  - Manual reconciliation may be required

Philosophy: "Fail-Visible" - operators know both groups acted
  independently, can decide which was correct after the fact.
```

---

## Testing Offline Capability

To validate offline mesh in your field test:

```bash
#!/bin/bash
# Test offline mesh coordination

echo "=== OFFLINE MESH COORDINATION TEST ==="

# 1. Establish baseline (connected)
echo "[1/5] Baseline - all units on C2"
systemctl status aethercore-gateway
sleep 5

# 2. Block C2 traffic
echo "[2/5] Simulating C2 disconnection..."
iptables -I OUTPUT 1 -d 192.168.1.100 -p tcp --dport 8443 -j DROP

# 3. Wait for autonomous mode activation
echo "[3/5] Waiting for autonomous mode (60s)..."
sleep 65

# 4. Issue command via FSO (local authority)
echo "[4/5] FSO-01 issuing local movement command..."
ssh pi@192.168.1.20 "coderalphie move-command --unit MULE-1 --waypoint 38.530,-120.123"
sleep 5

# 5. Verify quorum consensus
echo "[5/5] Checking quorum response..."
journalctl -u coderalphie | grep "CONSENSUS_APPROVED"

# 6. Restore C2 and verify sync
echo "[6/6] Restoring C2 link..."
iptables -D OUTPUT 1
sleep 10

echo "=== TEST COMPLETE ==="
echo "Check /var/log/coderalphie/audit.log for offline events"
```

---

## Conclusion

Offline mesh coordination enables 4MIK to function as a **standalone trust fabric** - no cloud, no backhaul, no persistent broadcast. Units preserve security and integrity while maintaining autonomous operations under contested RF and C2 unavailability.

The key is **distributed trust with safety guardrails**: Local leaders make fast decisions within bounds, units reach consensus when needed, and every action is logged for post-test audit.

This is the essence of "Truth as a Weapon" - the mesh itself becomes the source of truth, cryptographically immutable and fully attributable.
