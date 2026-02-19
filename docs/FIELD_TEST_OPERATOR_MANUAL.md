# AetherCore MDCA Field Test Operator Manual

## 4MIK - Hardware-Rooted Trust Under Contested RF

##

## Version: 1.0

## Classification: OPERATIONAL

## Last Updated: 2026-02-13

##

## "Truth as a Weapon" - Fail-Visible Coordination at the Tactical Edge

---

# Table of Contents

1. [Executive Summary](#executive-summary)
2. [Pre-Test Checklist](#pre-test-checklist)
3. [Tactical Glass Dashboard (Operator Interface)](#tactical-glass-dashboard)
4. [Field Test Scenarios](#field-test-scenarios)
5. [Verification Procedures](#verification-procedures)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Post-Test Analysis](#post-test-analysis)
8. [Emergency Procedures](#emergency-procedures)

---

# Executive Summary

This manual guides field operators through the AetherCore MDCA field test. The test validates 4MIK as a foundational trust layer for multi-domain collaborative autonomy in denied environments.

## Key Concepts

### 4MIK (Four-pronged Multi-domain Integrity Kernel)

1. **Identity at the Source**: Every unit has hardware-rooted identity (TPM Ed25519)
2. **Peer Verification**: Authentication happens in closed trust fabric, not cloud
3. **Low-Signature Coordination**: Reduce broadcast dependency while sustaining coordination
4. **Comms-Agnostic Resilience**: Maintain trust across domain transitions and RF degradation

### Field Test Objectives

| Objective                    | Success Criterion                                     | Measurement                     |
| ---------------------------- | ----------------------------------------------------- | ------------------------------- |
| Spoof/Replay Rejection       | > 99.5% of spoofed messages rejected                  | Spoof detection event count     |
| Track Origin Validation      | > 95% position verification success under GNSS denial | Verification event rate         |
| Verified Intent Coordination | > 90% autonomous coordination without broadcast       | Coordination decision count     |
| Decision Latency             | Command latency < 2 seconds (p99)                     | Command latency percentiles     |
| Offline Operation            | > 30 minutes continuous operation without C2          | Offline duration / success rate |

---

# Pre-Test Checklist

## Equipment Verification (24 Hours Before Test)

- [ ] **CodeRalphie Edge Nodes**: All units boot successfully, service is running

  ```bash
  # On each node:
  systemctl status coderalphie
  journalctl -u coderalphie -n 5  # Should show recent activity
  ```

- [ ] **TPM Hardware Validation**: TPM is detected and operational on all nodes

  ```bash
  # On each node:
  tpm2_getcap properties-fixed
  ls -l /dev/tpm0
  ```

- [ ] **Network Connectivity**:
  - [ ] All nodes can reach C2 server (WSS)
  - [ ] Test latency: `ping c2.aethercore.local`
  - [ ] Verify no packet loss to C2

  ```bash
  # From field operations bunker:
  ping -c 100 192.168.1.10  # Replace with node IP
  # Check for packet loss < 5%
  ```

- [ ] **Tactical Glass Dashboard**:
  - [ ] Application launches without errors
  - [ ] C2 connection shows "LINK ESTABLISHED" (green)
  - [ ] Can see all expected nodes in mesh view
  - [ ] No red "LINK COMPROMISED" banners

- [ ] **Mesh Formation**:

  ```bash
  # In Tactical Glass, Dashboard tab should show:
  # - All expected nodes HEALTHY
  # - Trust scores visible for each node
  # - No nodes marked REVOKED or COMPROMISED
  ```

- [ ] **Test Configuration Deployed**:
  - [ ] MDCA field test configuration active on all nodes
  - [ ] Degraded RF resilience mode enabled
  - [ ] Offline mesh capability verified

## Operator Briefing (1 Hour Before Test)

- [ ] Operators understand field test objectives and success criteria
- [ ] Each operator knows their unit's role (ISR, FSO, C2, etc.)
- [ ] Emergency procedures reviewed (see Emergency Procedures section)
- [ ] Communication plan briefed:
  - Primary: Aethercore (WSS)
  - Secondary: RF backup (if available)
  - Tertiary: Voice combat net
- [ ] Safety procedures reviewed (especially if running hot weapons)

---

# Tactical Glass Dashboard

## Operator Interface for MDCA Coordination

### Dashboard Tabs

#### 1. **Status Tab** (Real-Time Mesh Health)

```
┌────────────────────────────────────────────────────────┐
│              AETHERCORE MESH STATUS                    │
├────────────────────────────────────────────────────────┤
│ LINK STATUS: ✅ LINK ESTABLISHED                       │
│ Nodes Connected: 6/6                                   │
│ Trust Mesh Health: 94%                                 │
│ Offline Operations: 0s                                 │
│                                                        │
│ Node List:                                             │
│ [ISR-01] ✅ 94% trust | Position: 38.5284, -120.1234 │
│ [ISR-02] ✅ 91% trust | Last update: 2s ago           │
│ [FSO-01] ✅ 98% trust | Connected                     │
│ [C2]     ✅ 100% trust | Authority                    │
│ [MULE-1] ✅ 92% trust | Position valid                │
│ [MULE-2] ⚠️  52% trust | Verification needed          │
└────────────────────────────────────────────────────────┘
```

**Key Indicators**:

- **Green "LINK ESTABLISHED"**: C2 connection verified and heartbeating
- **Yellow "LINK PENDING"**: Handshake in progress
- **Red "LINK SEVERED"**: Connection failed or TPM error - exit now
- **Node Trust Score**: 0-100%, green (> 75%), yellow (50-75%), red (< 50%)
- **Unverified Overlay**: Grayed-out nodes = data hasn't passed verification

#### 2. **Mesh View Tab** (Network Topology)

Shows real-time network topology with link quality visualization.

```
       [C2] ← Authority
        │
    ┌───┼───┐
    │   │   │
  [ISR-01] [FSO-01] [MULE-1]
   (94%)    (98%)    (92%)
    │        │        │
    └────┬───┴────┬───┘
         │        │
      [ISR-02] [MULE-2]
       (91%)    (52%) ⚠️
```

**Interaction**:

- Click node to see detailed telemetry stream
- Click link to see latency/packet loss
- Right-click node to view revocation status

#### 3. **Coordination Tab** (Intent & Decision Log)

Shows real-time intent acceptances and coordination decisions.

```
┌────────────────────────────────────────────────────────┐
│          VERIFIED INTENT COORDINATION                  │
├────────────────────────────────────────────────────────┤
│ [12:34:56] Command: MOVE ISR-01 to waypoint            │
│            Authority: C2 (operator-sig verified)        │
│            Acceptance: ISR-01 ✅ accepted (tpm signed) │
│            Status: EXECUTING                            │
│                                                         │
│ [12:33:21] Command: DEFEND forward position            │
│            Authority: FSO-01 (delegated)                │
│            Acceptance: MULE-1 ✅, MULE-2 ⚠️ pending   │
│            Status: PARTIAL_CONSENSUS                    │
│                                                         │
│ [12:32:10] Targeting: Report fire solution              │
│            Authority: FSO-01                            │
│            Information chain: 100% verified             │
│            Status: WEAPON_READY                         │
└────────────────────────────────────────────────────────┘
```

**Key Actions**:

- **Issue Command**: Right-click → "New Intent"
- **View Signatures**: Click event to see cryptographic chain
- **Check Verification**: Click to see which checks passed/failed
- **Abort Decision**: If compromised unit appears, immediately reject coordination

#### 4. **Verification Tab** (Spoof Detection Events)

Real-time log of security events.

```
┌────────────────────────────────────────────────────────┐
│              SPOOF & VERIFICATION EVENTS                │
├────────────────────────────────────────────────────────┤
│ [12:35:44] ❌ SPOOF DETECTED                            │
│            Source: 192.168.1.99 (unauthorized)         │
│            Reason: INVALID_SIGNATURE                    │
│            Data dropped, no action required             │
│                                                         │
│ [12:35:22] ✅ VERIFICATION SUCCESS                      │
│            Source: ISR-01                               │
│            Data: Position update                        │
│            Checks: Signature ✓, Freshness ✓, Trust ✓   │
│            Latency: 34ms                                │
│                                                         │
│ [12:33:15] ⚠️  VERIFICATION PENDING                     │
│            Source: MULE-2                               │
│            Reason: Low trust score (52%)                │
│            Action: Require re-attestation               │
│            TTL: 45s remaining                           │
└────────────────────────────────────────────────────────┘
```

**Operator Actions**:

- Monitor spoof rejection rate (should be 99.5%+)
- If particular unit fails multiple verifications → initiate Byzantine sweep
- Note any verification latency > 100ms for KPI assessment

#### 5. **Configuration Tab** (Field Test Settings)

Verify all field optimizations are active.

```
Network Resilience:
  ✓ Contested RF Mode: ENABLED
  ✓ Latency Tolerance: 500ms
  ✓ Packet Loss Tolerance: 30%
  ✓ Auto-Reconnect: ENABLED (max 20 attempts)
  ✓ Degraded Mode Threshold: 60s

Offline Operation:
  ✓ Autonomous Quorum: ENABLED
  ✓ Local Trust Fabric: ACTIVE
  ✓ Gossip Protocol: ENABLED (5s interval)
  ✓ Dead Reckoning: ENABLED (60s max)

Integrity Protection:
  ✓ Merkle Vine Verification: ENABLED
  ✓ Kinematic Validation: ENABLED
  ✓ Attestation Freshness: 1800s
  ✓ Replay Protection: ENABLED

Telemetry Collection:
  ✓ Field Metrics: ENABLED
  ✓ Spoof Detection Events: Logged
  ✓ Verification Events: Logged
  ✓ Coordination Decisions: Logged
```

---

# Field Test Scenarios

## Scenario 1: Initial Mesh Formation & Verification Under Contested RF

**Objective**: Establish mesh under simulated 25% packet loss, verify all nodes achieve > 90% trust score

**Duration**: 15 minutes

**Setup**:

1. All nodes powered on, already deployed at field positions
2. Simulate RF degradation (if test rig available):
   ```bash
   # On router or network emulator:
   tc qdisc add dev eth0 root netem loss 25%
   ```
3. Tactical Glass dashboard connects to C2 router

**Execution**:

1. **Minute 0-2**: Initial mesh formation
   - Watch Tactical Glass for node discovery
   - Expect all nodes to appear within 60 seconds
   - Verify C2 connection shows "LINK ESTABLISHED"

2. **Minute 2-5**: Position updates flowing
   - ISR nodes should stream position at ~ 1 Hz
   - Dashboard shows real-time track updates
   - No red "SPOOFED" indicators

3. **Minute 5-10**: Verify trust mesh
   - Each node should achieve > 90% trust score
   - If any node stuck below 80%, trigger re-attestation:
     ```
     Right-click node → "Request Re-attestation"
     ```
   - Watch verification latency (should be < 100ms despite 25% loss)

4. **Minute 10-15**: Verify spoof rejection
   - Inject spoofed position from rogue device (192.168.1.99):
     ```bash
     # From test rig:
     ./inject-spoofed-position.sh 192.168.1.99 38.53 -120.12
     ```
   - Verify rejection appears in Verification tab within 5 seconds
   - Check spoof detection event shows correct reason (INVALID_SIGNATURE, etc.)

**Success Criteria**:

- ✅ All expected nodes discovered within 60s
- ✅ All nodes achieved ≥ 90% trust score
- ✅ Position updates flowing at < 100ms latency despite 25% loss
- ✅ Spoofed position rejected within 5 seconds
- ✅ "Spoof/replay rejection rate" measured at 100% (1 attempt, 1 rejection)

**Log Location**: `/var/log/coderalphie/field-test/scenario-1-*.log`

---

## Scenario 2: Track Origin Validation Under GNSS Denial

**Objective**: Verify position authentication when GNSS is unavailable

**Duration**: 20 minutes

**Setup**:

1. All nodes still broadcasting positions
2. Simulate GNSS denial:

   ```bash
   # On each node:
   GNSS_AVAILABLE=false systemctl restart coderalphie
   ```

   OR kill GNSS receiver to get realistic signal loss

3. Set initial GNSS position before denial

**Execution**:

1. **Minute 0-5**: Establish baseline with GNSS available
   - Verify all nodes showing position
   - Note trust scores (should be > 95%)

2. **Minute 5-15**: GNSS denied, use dead reckoning
   - Nodes switch to INS/dead reckoning positioning
   - Position updates continue but with higher uncertainty
   - Dashboard shows `source: DEAD_RECKONING` in position data
   - Trust scores may drop to 80-90% (acceptable - less data sources)

3. **Minute 15-20**: Verify origin continues
   - Even with GNSS denied, positions should still verify (not spoofed)
   - Check ancestry hash chain - unbroken despite degraded source
   - Kinematic validation should pass (movements believable)

4. **Verify origin challenge**:
   - Operator commands: "ISR-01 move to [wrong location]"
   - If ISR-01 jumps 10km suddenly (impossible kinematics)
   - Should trigger SPOOFED detection (impossible track)

**Success Criteria**:

- ✅ Positions continue verifying despite GNSS denial
- ✅ Trust scores remain > 75% after GNSS loss
- ✅ Dead reckoning positions marked as such (not claimed as GNSS)
- ✅ Impossible kinematic movements detected as SPOOF
- ✅ Track origin validation rate > 95% (even without GNSS)

---

## Scenario 3: Verified Intent Coordination (No Broadcast)

**Objective**: Execute coordinated actions using intent-based coordination (minimal broadcast)

**Duration**: 20 minutes

**Setup**:

1. All nodes operational and verified
2. Disable broadcast messaging (test quorum coordination):
   ```yaml
   # In degraded-rf-resilience.yaml:
   gossip:
     enabled: false # Disable broadcast, force peer messaging
   ```

**Scenario Actions**:

### Action 1: Coordinated Movement (5 minutes)

1. Operator issues command via Tactical Glass:

   ```
   Command: MOVE [MULE-1, MULE-2] to waypoint 38.530, -120.125
   Authority: C2 (operator signature)
   ```

2. System execution:
   - C2 signs intent with operator-id and timestamp
   - Sends intent to MULE-1 (WSS)
   - MULE-1 verifies signature, accepts
   - MULE-1 gossips intent to MULE-2 (peer-to-peer)
   - MULE-2 verifies from MULE-1, accepts
   - Movement begins

3. Verify in Coordination tab:
   - Intent ID visible
   - Both units show ACCEPTED status (green)
   - NO broadcast messages sent (only 1 WSS message + 1 peer message)

### Action 2: Joint Fire Support (5 minutes)

1. ISR reports target:

   ```
   Target: 38.535, -120.130
   Type: DETECTED (need FSO verification)
   Confidence: 78%
   ```

2. FSO assigns targeting to MULE-1:

   ```
   Command: PROVIDE_SUPPORT [MULE-1] engage target-uuid-xxxx
   ```

3. Verify:
   - Information source chain is complete (ISR → FSO → MULE-1)
   - Each step cryptographically verified
   - MULE-1 accepts targeting solution
   - Weapon authorization captured (FSO signed)

### Action 3: Quorum Consensus (5 minutes)

1. C2 loses connection (simulate):

   ```bash
   # Kill C2 connection on one node:
   pkill -9 -f c2-client
   ```

2. ISR-01 detects threat, needs immediate fallback action
3. FSO-01 and MULE-1 form quorum (2 out of 3 units)
4. FSO-01 issues fallback command with reason:

   ```
   Intent: FALLBACK to secondary position
   Authority: FSO-01 (delegated)
   Reason: C2 unreachable, threat imminent
   Quorum consensus: 2/3 accept (MULE-1, ISR-02)
   ```

5. Verify:
   - Command executes via quorum (not C2 override)
   - Consensus threshold met (66% > 75% required... no wait, fail)
   - Actually, if consensus fails, command rejected (safe default)

**Success Criteria**:

- ✅ Coordinated movements executed without broadcast
- ✅ Intent acceptance chain verified end-to-end
- ✅ Fire support information chain 100% verified
- ✅ Quorum decisions respected (N-1 consensus)
- ✅ Broadcast message count < 5 per coordination event
- ✅ Average coordination latency < 2 seconds

---

## Scenario 4: Byzantine Node Detection & Aetheric Sweep

**Objective**: Detect compromised node, trigger isolation

**Duration**: 15 minutes

**Setup**:

1. All nodes healthy (green)
2. Designate one node as "Byzantine simulator" (will send bad signatures)

**Execution**:

1. Byzantine node starts sending unsigned/forged position updates
2. Trust mesh detects failures:
   - Signature verification fails
   - Merkle vine chain breaks
   - Attestation doesn't match position

3. Watch trust score for Byzantine node:

   ```
   Minute 0: 95% trust
   Minute 1: 90% trust (1 failure)
   Minute 2: 85% trust (2 failures)
   Minute 3: 75% trust (3 failures detected)
   Minute 4: 50% trust (5 failures)
   ```

4. After 5 failures, Aetheric Sweep triggered:

   ```
   [AETHERIC SWEEP INITIATED]
   Target: MULE-2 (52% trust, 5+ verification failures)
   Action: Isolation Begin
   Strategy: Gradual Exclusion
   ```

5. Node interaction protocol downgrade:
   - First: Mark MULE-2 data as UNVERIFIED (still process)
   - Then: Require human approval for MULE-2 commands
   - Finally: Stop accepting MULE-2 as source (if > 10 failures)

6. Verify in Verification tab:
   - Multiple SPOOF_DETECTION events for MULE-2
   - Trust score visibly dropped
   - Node marked with ⚠️ warning icon
   - Banner: "MULE-2 under Byzantine investigation"

**Success Criteria**:

- ✅ Byzantine failures detected within 5 minutes
- ✅ Trust score decreased appropriately
- ✅ Aetheric Sweep initiated at threshold (5 failures)
- ✅ Node isolation verified (commands require approval)
- ✅ Other nodes continue operating normally

---

## Scenario 5: Extended Offline Operation (30 minutes)

**Objective**: Verify mesh continues operating without C2 connection

**Duration**: 35 minutes (30 offline + 5 recovery)

**Setup**:

1. All nodes connected, mesh healthy
2. Record baseline metrics before disconnection

**Execution**:

### Phase 1: Preparation (5 minutes)

- Verify all nodes at positions
- Ensure offline mesh is enabled:
  ```yaml
  offline_mesh:
    enabled: true
    autonomous_quorum: true
  ```
- Pre-populate node cache with all track data

### Phase 2: Disconnection (0-5 minutes)

- Operator monitors: "Initiating C2 disconnection for 30 minutes"
- Simulate C2 link failure:
  ```bash
  # Firewall block C2 traffic on gateway:
  iptables -I INPUT 1 -s 192.168.1.0/24 -p tcp --dport 8443 -j DROP
  ```
- Tactical Glass shows:
  ```
  [LINK DEGRADED] Reconnection attempts: 1/20
  [12:47:23] Network health: DEGRADED (latency spikes, packet loss)
  [12:47:35] C2 unreachable for 12 seconds...
  [12:47:47] AUTONOMOUS MODE ACTIVATED
              Trust operations transferred to local quorum
  ```

### Phase 3: Offline Operations (5-35 minutes)

- FSO commands movements via quorum (no C2):

  ```
  Command: ISR-01 move to waypoint
  Authority: FSO-01 (local delegation)
  Consensus: ISR-02, MULE-1 agree (2/3 quorum met)
  Status: EXECUTING (offline)
  ```

- Position updates continue (peer gossip):
  - Each node shares updates with neighbors
  - Merkle vine chains maintained locally
  - Trust scores remain stable
  - Spoof detection still active

- Try firing weapons (if authorized offline):
  - Fire solution accepted locally
  - Weapon authorization still required (FSO signature)
  - Execute immediately (no C2 gate)
  - Track result locally

### Phase 4: Recovery (35-38 minutes)

- Operator restores C2 link:

  ```bash
  iptables -D INPUT 1  # Remove firewall block
  ```

- Tactical Glass shows reconnection:

  ```
  [12:52:15] C2 link restored
  [12:52:16] Syncing offline events...
  [12:52:18] Offline duration: 31m 12s
  [12:52:19] Events synced: 148 positions, 12 commands, 3 targeting updates
  [12:52:20] LINK ESTABLISHED
  ```

- Verify sync:
  - All offline decisions now recorded in C2 ledger
  - C2 acknowledges "EVENTS ACCEPTED"
  - Trust scores restored to pre-offline values

**Success Criteria**:

- ✅ Mesh continues operating 30+ minutes without C2
- ✅ Movements executed via quorum (no C2 override)
- ✅ Position updates continued (peer gossip)
- ✅ No spoofed data entered mesh during offline operation
- ✅ All offline events synced to C2 after reconnection
- ✅ No data loss, complete audit trail

---

# Verification Procedures

## After Each Scenario - Validation Checklist

```bash
#!/bin/bash
# Run after each scenario to validate KPIs

echo "=== FIELD TEST SCENARIO VALIDATION ==="

# 1. Check spoof detection rate
echo "Spoof Detection Rate:"
grep "SPOOF_DETECTION" /var/log/coderalphie/audit.log | wc -l
# Expected: > 99% of injected spoofed messages

# 2. Check verification success rate
echo "Verification Success Rate:"
grep "VERIFICATION_SUCCESS" /var/log/coderalphie/audit.log | wc -l

# 3. Check Byzantine detections
echo "Byzantine Detections:"
grep "AETHERIC_SWEEP" /var/log/coderalphie/audit.log | wc -l

# 4. Check offline operation duration
echo "Offline Operation Duration:"
grep "AUTONOMOUS_MODE" /var/log/coderalphie/field-test/*.log | \
  grep "ACTIVATED" | tail -1

# 5. Extract latency metrics
echo "Average Verification Latency:"
jq '.verification_latency_ms' /var/log/coderalphie/field-metrics.json | \
  python3 -c "import sys, json; data = [float(x) for x in sys.stdin]; \
  print(f'Mean: {sum(data)/len(data):.1f}ms, P99: {sorted(data)[int(len(data)*0.99)]:.1f}ms')"

# 6. Mesh connectivity
echo "Mesh Nodes Connected:"
journalctl -u coderalphie -S "30 minutes ago" | \
  grep "node_discovered" | wc -l
```

---

# Troubleshooting Guide

## Dashboard Shows "LINK COMPROMISED" (Red)

**Symptoms**: Dashboard displays red banner, cannot issue commands

**Diagnosis**:

```bash
# From Tactical Glass:
1. Check C2 connection status (should show endpoint URL)
2. Check TPM status on desktop (not applicable - this is dashboard)
3. Check websocket heartbeat logs
```

**Resolution**:

1. **First**: Verify C2 router is running

   ```bash
   # On C2 server:
   systemctl status aethercore-gateway
   systemctl status aethercore-c2-router
   ```

2. **Second**: Verify network connectivity

   ```bash
   # From operator box:
   ping c2.aethercore.local
   curl -k https://c2.aethercore.local:8443/health
   ```

3. **Third**: Check TLS certificates

   ```bash
   # Verify certificate validity:
   echo | openssl s_client -connect c2.aethercore.local:8443 -showcerts 2>/dev/null | \
   openssl x509 -text -noout | grep -A 2 "Validity"
   ```

4. **Fourth**: Restart dashboard
   - Close Tactical Glass
   - Clear browser cache: `rm -rf ~/.cache/Cohesion`
   - Reopen Tactical Glass
   - Re-enter C2 endpoint URL

## Node Shows Red (Low Trust Score < 50%)

**Symptoms**: Particular node marked with ❌ icon, grayed out

**Diagnosis**:

```bash
# SSH to low-trust node:
systemctl status coderalphie
journalctl -u coderalphie -n 20  # Last 20 log lines

# Check for:
# - TPM errors (Device /dev/tpm0 not found)
# - Signature failures
# - Attestation failures
```

**Resolution**:

1. **Verify TPM is available**:

   ```bash
   ls -l /dev/tpm0
   tpm2_getcap properties-fixed
   ```

2. **Check service logs for errors**:

   ```bash
   journalctl -u coderalphie --priority err
   ```

3. **Force re-attestation**:
   - In Tactical Glass, right-click node
   - Select "Request Re-attestation"
   - Wait 30 seconds for verification
   - Check if trust score improves

4. **If still failing**, the node may be Byzantine:
   - Trigger Aetheric Sweep (isolation)
   - Operator decision: keep node isolated or reboot

## Spoof Detection Not Working (Spoofed Messages Accepted)

**Symptoms**: Inject fake position from rogue device, mesh accepts it (red flag!)

**Diagnosis**:

```bash
# Check if spoof detection is enabled:
grep -A 5 "kinematic_validation:" /etc/coderalphie/config.yaml
# Should show "enabled: true"

# Check if signatures are actually being verified:
grep "signature verification" /var/log/coderalphie/audit.log | tail -5
```

**Resolution**:

1. **Verify config loaded correctly**:

   ```bash
   sudo systemctl restart coderalphie
   sleep 5
   journalctl -u coderalphie | grep "Configuration loaded"
   ```

2. **Check crypto module is working**:

   ```bash
   # Test Ed25519 signature:
   echo "test" | coderalphie sign - test.sig
   coderalphie verify test.sig test
   # Should succeed
   ```

3. **Inject spoofed signature (not just wrong position)**:

   ```bash
   # Proper spoofing attempt includes:
   # - Valid signature from DIFFERENT private key (attacker's key)
   # - Should be rejected as INVALID_SIGNATURE

   ./inject-spoofed-position.sh --bad-signature 192.168.1.99
   ```

4. **Force verification mode to STRICT**:
   ```bash
   # Edit config:
   sudo sed -i 's/verification_mode: "audit_only"/verification_mode: "strict"/' \
     /etc/coderalphie/config.yaml
   sudo systemctl restart coderalphie
   ```

## Offline Operation Not Working (Still Requires C2)

**Symptoms**: Set C2 offline, mesh stops coordinating (should continue)

**Diagnosis**:

```bash
# Check offline mesh is enabled:
grep -A 5 "offline_mesh:" /etc/coderalphie/config.yaml
# Should show "enabled: true"

# Check if algorithm switched modes:
journalctl -u coderalphie | grep "AUTONOMOUS_MODE"
# Should see "ACTIVATED" after 60 seconds of C2 downtime
```

**Resolution**:

1. **Verify timeout setting**:

   ```yaml
   # In degraded-rf-resilience.yaml:
   c2_connection:
     state_machine:
       degraded_mode_threshold_seconds: 60
       autonomous_mode_threshold_seconds: 300
   ```

   Change if needed (reduce to 30s for faster testing)

2. **Kill C2 more aggressively**:

   ```bash
   # Block at firewall (not just kill process):
   sudo iptables -I OUTPUT 1 -d 192.168.1.0/24 -p tcp --dport 8443 -j DROP

   # Wait 60+ seconds for nodes to switch to autonomous mode
   # Try a coordinate command from FSO unit
   ```

3. **Force autonomous mode manually** (for testing):
   ```bash
   # Edit config to set threshold to 0:
   degraded_mode_threshold_seconds: 0  # Immediate
   # Then restart
   ```

---

# Post-Test Analysis

## Metrics Collection

After test completes, collect field metrics:

```bash
#!/bin/bash
# run on C2 server to aggregate results

OUTPUT_DIR="./field-test-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTPUT_DIR"

echo "=== FIELD TEST POST-ANALYSIS ==="

# 1. Aggregate audit logs
echo "Collecting audit events..."
for node in ISR-01 ISR-02 FSO-01 MULE-1 MULE-2 C2; do
  echo "--- $node ---"
  journalctl -u coderalphie --boot | grep -E "SPOOF|VERIFICATION|COORDINATION" \
    > "$OUTPUT_DIR/$node-events.log"
done

# 2. Calculate KPIs
echo "Calculating KPIs..."

# Spoof rejection rate
spoof_count=$(grep "SPOOF_DETECTION" "$OUTPUT_DIR"/*-events.log | wc -l)
total_spoofed_attempts=10  # Record manually
rejection_rate=$((spoof_count * 100 / total_spoofed_attempts))
echo "Spoof Rejection Rate: $rejection_rate%" >> "$OUTPUT_DIR/KPIs.txt"

# Verification success rate
success_count=$(grep "VERIFICATION_SUCCESS" "$OUTPUT_DIR"/*-events.log | wc -l)
echo "Verification Success Events: $success_count" >> "$OUTPUT_DIR/KPIs.txt"

# Coordination decisions
coord_count=$(grep "COORDINATION_DECISION" "$OUTPUT_DIR"/*-events.log | wc -l)
echo "Coordinated Actions: $coord_count" >> "$OUTPUT_DIR/KPIs.txt"

# 3. Latency analysis
echo "Analyzing latencies..."
for event_file in "$OUTPUT_DIR"/*-events.log; do
  grep "verification_latency_ms" "$event_file" | \
    jq '.verification_latency_ms' | \
    awk '{print > "'$OUTPUT_DIR'/latencies.txt"}'
done

# Calculate percentiles
if [ -f "$OUTPUT_DIR/latencies.txt" ]; then
  sort -n "$OUTPUT_DIR/latencies.txt" | \
    awk 'NR==int(NR*(50/100)), NR==int(NR*(90/100)), NR==int(NR*(99/100))' \
    > "$OUTPUT_DIR/latency-percentiles.txt"
fi

# 4. Generate report
echo "=== FIELD TEST RESULTS ===" > "$OUTPUT_DIR/REPORT.md"
echo "Generated: $(date)" >> "$OUTPUT_DIR/REPORT.md"
echo "" >> "$OUTPUT_DIR/REPORT.md"
echo "## KPIs" >> "$OUTPUT_DIR/REPORT.md"
cat "$OUTPUT_DIR/KPIs.txt" >> "$OUTPUT_DIR/REPORT.md"
echo "" >> "$OUTPUT_DIR/REPORT.md"
echo "## Latency Analysis (milliseconds)" >> "$OUTPUT_DIR/REPORT.md"
if [ -f "$OUTPUT_DIR/latency-percentiles.txt" ]; then
  cat "$OUTPUT_DIR/latency-percentiles.txt" >> "$OUTPUT_DIR/REPORT.md"
fi

echo "Results saved to: $OUTPUT_DIR"
echo "Report: $OUTPUT_DIR/REPORT.md"
```

## KPI Validation Matrix

| KPI                                         | Target         | Actual | Status   |
| ------------------------------------------- | -------------- | ------ | -------- |
| Spoof/Replay Rejection Rate                 | > 99.5%        | \_\_\_ | [ ] Pass |
| Track Origin Validation (GNSS denied)       | > 95%          | \_\_\_ | [ ] Pass |
| Verified Intent Coordination (no broadcast) | > 90%          | \_\_\_ | [ ] Pass |
| Command Latency (p99)                       | < 2000ms       | \_\_\_ | [ ] Pass |
| Offline Operation Capability                | > 30 min       | \_\_\_ | [ ] Pass |
| Offline Coordination Success                | > 85%          | \_\_\_ | [ ] Pass |
| Coordination Messages (reduced broadcast)   | < 5 per action | \_\_\_ | [ ] Pass |

---

# Emergency Procedures

## Immediate Red-Light Triggers

If any of these occur, STOP TEST immediately:

1. **Dashboard shows RED "LINK COMPROMISED"** + cannot regain link
   - Action: Troubleshoot C2 connection (see guide)
   - Do NOT proceed until LINK ESTABLISHED

2. **Spoofed data ACCEPTED (not rejected)**
   - Symptom: Inject fake position, mesh accepts it
   - Action: Verify spoofing signature actually invalid (see Troubleshooting)
   - Do NOT continue live weapons tests until resolved

3. **Multiple nodes show RED simultaneously** (> 2 nodes)
   - Symptom: > 2 units show < 50% trust score
   - Possible cause: System-wide configuration error or network issue
   - Action: Reboot all nodes, reload fresh config
   - Do NOT continue until network stabilizes

4. **Offline mode fails to activate** (after 5 min no C2)
   - Symptom: Nodes still trying to reach unreachable C2
   - Action: Force autonomous mode via config reduction
   - Do NOT continue critical coordination tests

## Graceful Test Termination

If need to stop test before completion:

```bash
#!/bin/bash
# Graceful shutdown

echo "TERMINATING FIELD TEST"

# 1. Issue HOLD_POSITION command to all units
# (Operator action in Tactical Glass):
# Command → Issue Intent → HOLD_POSITION (all units)

# 2. Wait for execution (30 seconds)
sleep 30

# 3. Stop telemetry collection
for node in ISR-01 ISR-02 FSO-01 MULE-1 MULE-2; do
  ssh pi@$node "sudo systemctl stop coderalphie"
done

# 4. Collect final logs
mkdir -p ./test-logs-final
for node in ISR-01 ISR-02 FSO-01 MULE-1 MULE-2; do
  scp pi@$node:/var/log/coderalphie/*.log ./test-logs-final/
done

echo "Test terminated, logs collected to ./test-logs-final"
```

---

# Appendix: Quick Reference

## Node IDs & IP Addresses

| Role             | Unit ID | IP Address    | Operator Contact |
| ---------------- | ------- | ------------- | ---------------- |
| ISR (Intel)      | ISR-01  | 192.168.1.10  |                  |
| ISR              | ISR-02  | 192.168.1.11  |                  |
| Fire Support     | FSO-01  | 192.168.1.20  |                  |
| Mule (Transport) | MULE-1  | 192.168.1.30  |                  |
| Mule             | MULE-2  | 192.168.1.31  |                  |
| C2 (Operator)    | C2      | 192.168.1.100 |                  |

## Tactical Glass Keyboard Shortcuts

| Action                 | Shortcut                       |
| ---------------------- | ------------------------------ |
| New Intent             | `Ctrl+I`                       |
| New Targeting          | `Ctrl+T`                       |
| Show Node Details      | Click node                     |
| Show Link Quality      | Click link                     |
| Request Re-attestation | Right-click node → "Re-attest" |
| View Encryption Status | `Ctrl+Shift+S`                 |
| Export Logs            | `Ctrl+E`                       |
| Emergency Stop         | `Ctrl+Alt+S`                   |

---

**End of Field Operator Manual**

For issues during test, contact:

- **Technical Support**: aethercore-support@fourmik.dev
- **Security Incident**: security@fourmik.dev
- **Field Operations**: field-ops@fourmik.dev
