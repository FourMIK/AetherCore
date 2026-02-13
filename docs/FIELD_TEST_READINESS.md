# AetherCore MDCA Field Test - Complete Setup & Readiness Guide

## "Truth as a Weapon" - Hardware-Rooted Trust Under Contested RF

##

## Version: 1.0

## Date: 2026-02-13

## Classification: OPERATIONAL

---

## Quick Start

You are now ready to execute the AetherCore MDCA field test. To begin:

### 1. Copy Field Node Configuration

```bash
cd /workspaces/AetherCore

# Create your field nodes list (edit with actual IP addresses)
cp field-nodes.example.txt field-nodes.txt

# Edit to match your deployment:
# Format: hostname[,user[,arch[,ssh_key_path]]]
nano field-nodes.txt
```

### 2. Deploy Field Swarm

```bash
# Make deployment script executable
chmod +x scripts/deploy-field-swarm.sh

# Run deployment (builds CodeRalphie, provisions all nodes)
./scripts/deploy-field-swarm.sh \
  config/mdca-field-test.yaml \
  field-nodes.txt
```

This will:

- ✅ Build ARM64 and x86_64 CodeRalphie binaries
- ✅ Provision all nodes with system hardening
- ✅ Install TPM driver and verify hardware
- ✅ Deploy CodeRalphie service with auto-restart
- ✅ Configure field test mode
- ✅ Verify all nodes are healthy

### 3. Launch Tactical Glass Dashboard

```bash
# On operator workstation:
cd /workspaces/AetherCore/packages/dashboard

# Build and run (requires Node.js 20+, npm)
npm install
npm run build
npm run tauri dev

# Or run pre-built binary (if available)
./Tactical\ Glass.AppImage
```

### 4. Verify Mesh Formation

In Tactical Glass:

1. Open **C2 Settings** tab
2. Enter C2 endpoint: `wss://c2.aethercore.local:8443`
3. Click **Connect**
4. Verify status shows **"LINK ESTABLISHED"** (green)
5. All nodes should appear in **Status tab** within 60 seconds
6. Verify all nodes show **> 90% trust score**

### 5. Begin Field Test

See [Field Test Scenarios](#field-test-scenarios) in the operator manual for step-by-step scenario execution.

---

## What's Been Deployed

Your AetherCore ecosystem now includes:

### 1. **MDCA Field Test Configuration** (`config/mdca-field-test.yaml`)

- Hardware-rooted identity enforcement
- Merkle Vine integrity verification
- Degraded RF resilience tuning
- Spoof/replay protection configuration
- Field test telemetry collection settings

**Usage**: Automatically applied to all nodes via deployment script

### 2. **Degraded RF Resilience Configuration** (`config/degraded-rf-resilience.yaml`)

- Connection resilience (reconnection, timeouts)
- Network health monitoring
- Transmission optimization (compression, batching, retransmission)
- Offline mesh operation (quorum, gossip, authority delegation)
- Kinematic validation (spoofing detection)
- Trust management (revocation, Byzantine detection)

**Usage**: Loaded by CodeRalphie at startup

### 3. **Multi-Node Provisioning Harness** (`scripts/deploy-field-swarm.sh`)

- Autonomous CodeRalphie binary builds (ARM64, x86_64)
- Parallel SSH provisioning (up to 5 nodes simultaneously)
- TPM verification and hardware attestation
- System hardening (firewall, fail2ban)
- Service monitoring and verification

**Usage**: Executed once during initial deployment, can be re-run for updates

### 4. **MDCA Telemetry Schema** (`packages/shared/src/mdca-telemetry-schema.ts`)

- Track origin verification (position with Merkle ancestry)
- Intent data (operator-signed commands)
- Targeting data (fire solutions with information chains)
- Spoof detection events (rejection reasons, metrics)
- Verification success events (cryptographic checks passed)
- Coordination decision events (quorum approvals)
- Field test metrics aggregation

**Usage**: Used by all services for data validation and metric collection

### 5. **Spoof/Replay Detection Tests** (`tests/field-spoof-replay-validation.rs`)

- 10 comprehensive red-cell assault scenarios
- Tests for signature validation, replay nonces, chain integrity, kinematics, attestation, revocation
- Integration test validating 100% spoof/replay rejection rate

**Usage**: Run as part of pre-test validation:

```bash
cargo test --test field-spoof-replay-validation -- --nocapture
```

### 6. **Field Operator Manual** (`docs/FIELD_TEST_OPERATOR_MANUAL.md`)

- Complete Tactical Glass dashboard guide
- 5 detailed field test scenarios with execution steps
- Verification procedures and troubleshooting
- Emergency procedures and graceful termination
- KPI validation checklist

**Usage**: Reference during field test operations

### 7. **Offline Mesh Coordination** (`docs/OFFLINE_MESH_COORDINATION.md`)

- Authority delegation model (squad leader authorization)
- Quorum consensus algorithm (N-1 voting)
- Gossip protocol synchronization
- Merkle Vine chain maintenance offline
- Conflict resolution and Byzantine handling
- C2 reconnection and ledger sync

**Usage**: Reference when C2 link is [inaccessible for 60+ seconds

### 8. **Performance Telemetry Collector** (`services/gateway/src/field-telemetry-collector.ts`)

- Real-time KPI collection (spoof/replay rejection, origin validation, coordination success)
- Latency percentile calculation (P50, P90, P99)
- Offline operation duration tracking
- Network health monitoring
- JSON metrics export
- Post-test analysis report generation

**Usage**: Runs continuously during test, generates report on completion

---

## Pre-Test Validation Checklist

Run these checks before starting the field test:

### ☐ Hardware Verification

```bash
# On each CodeRalphie node:
ssh pi@192.168.1.10

# Verify Raspberry Pi OS
uname -a
# Should show: Linux ... aarch64 GNU/Linux

# Verify TPM is present and working
ls -l /dev/tpm0
tpm2_getcap properties-fixed
# Should show TPM device and capabilities

# Verify network connectivity
ping -c 5 c2.aethercore.local
# Should show 0% packet loss

# Verify service is running
systemctl status coderalphie
# Should show: active (running)

# Check latest logs
journalctl -u coderalphie -n 10
# Should show recent heartbeat/enrollment events
```

### ☐ Configuration Validation

```bash
# Verify field test config is deployed
sudo cat /etc/coderalphie/config.yaml | grep -A 10 "field_test:"

# Verify degraded RF mode is configured
sudo cat /etc/coderalphie/config.yaml | grep -A 5 "contested_mode:"

# Verify offline mesh is enabled
sudo cat /etc/coderalphie/config.yaml | grep -A 3 "offline_mesh:"
```

### ☐ Mesh Formation Verification

```bash
# In Tactical Glass dashboard:

# 1. Check node discovery
Dashboard > Status tab
  - Should list all 6 nodes (ISR-01, ISR-02, FSO-01, MULE-1, MULE-2, C2)
  - Each node should show trust score >= 90%
  - Connection latency should be < 100ms

# 2. Check C2 link
Top bar > AETHERIC LINK indicator
  - Should show GREEN "LINK ESTABLISHED"
  - Not yellow "LINK PENDING" or red "LINK SEVERED"

# 3. Check mesh connectivity
View > Mesh View
  - Should show all nodes with links between them
  - Links should be GREEN (good quality)
  - No RED or BROKEN links
```

### ☐ Security Verification

```bash
# Test spoof detection
cd /workspaces/AetherCore

# Run validation test suite
cargo test --test field-spoof-replay-validation -- --nocapture 2>&1 | tail -20
# Should show: test result: ok. X passed

# Inject spoofed test message (optional)
# (Would require test harness - documented in FIELD_TEST_OPERATOR_MANUAL.md)
```

### ☐ Operator Briefing

```
All personnel must understand:

1. MDCA Objectives
   - Spoof/replay rejection rate: > 99.5%
   - Track origin validation: > 95%
   - Verified intent coordination: > 90%
   - Decision latency: < 2s (P99)
   - Offline operation: > 30 minutes

2. Field Safety
   - Emergency stop: Ctrl+Alt+S in Tactical Glass
   - Link status: Watch for RED "LINK COMPROMISED" - exit immediately
   - Spoofed data: Dashboard will show orange/red warnings
   - Weapon safety: Fire authorization requires C2 or FSO signature

3. Network Degradation Expectations
   - RF packet loss: 25% expected (normal field conditions)
   - GNSS denial: 60-70% loss of satellites (indoor/contested)
   - Latency variance: 50-500ms typical (from 5-50ms normal)
   - Connection drops: Expect brief disconnects, C2 will reconnect auto

4. Offline Operation (No C2)
   - Activation: After 5 minutes without C2 connection
   - Authority: FSO has squad-level decision authority
   - Coordination: Quorum voting if no FSO available
   - Safety: Default to HOLD_POSITION (conservative)
```

---

## Field Test Execution Timeline

### T-24H: Equipment Checks

- ✅ All nodes power on, service starts
- ✅ TPM verified on all nodes
- ✅ Network connectivity verified
- ✅ Tactical Glass connects to C2

### T-2H: Operator Briefing

- ✅ Review objectives and acceptance criteria
- ✅ Assign unit responsibilities (ISR, FSO, Mules, C2)
- ✅ Review emergency procedures
- ✅ Confirm communication plan

### T-30M: Pre-Test Validation

- ✅ Run validation checklist above
- ✅ Verify all nodes healthy (trust > 90%)
- ✅ Confirm C2 link established
- ✅ Record baseline metrics

### T-0M: Test Execution

Execute scenarios from FIELD_TEST_OPERATOR_MANUAL.md:

1. **Scenario 1 (15 min)**: Initial Mesh Formation & Verification
   - Verify mesh under 25% packet loss
   - Verify all nodes reach > 90% trust
   - Inject 1 spoofed position, verify rejection

2. **Scenario 2 (20 min)**: Track Origin Validation (GNSS Denied)
   - Simulate GNSS unavailability
   - Verify positions continue verifying (dead reckoning)
   - Inject impossible kinematics, verify rejection

3. **Scenario 3 (20 min)**: Verified Intent Coordination (No Broadcast)
   - Coordinated movements without broadcast
   - Fire support information chain verification
   - Quorum consensus if C2 unavailable

4. **Scenario 4 (15 min)**: Byzantine Node Detection & Sweep
   - Send unsigned/bad signatures from designated node
   - Watch trust score drop
   - Observe Aetheric Sweep isolation

5. **Scenario 5 (35 min)**: Extended Offline Operation
   - Disconnect C2 for 30+ minutes
   - Execute movements via FSO authority and quorum
   - Reconnect and verify all events synced

### T+105M: Test Completion

- Stop telemetry collection
- Generate field metrics report
- Verify verdict (PASS / CONDITIONAL_PASS / FAIL)
- Collect operator observations

### T+120M: Teardown

- Stop all nodes
- Collect logs from all units
- Generate final report
- Archive all telemetry data

---

## Expected KPI Results

Based on system design, expect:

| KPI                          | Target   | Expected | Margin |
| ---------------------------- | -------- | -------- | ------ |
| Spoof/Replay Rejection       | > 99.5%  | 100%     | +0.5%  |
| Track Origin Validation      | > 95%    | 98%      | +3%    |
| Verified Intent Coordination | > 90%    | 95%      | +5%    |
| Command Latency (P99)        | < 2000ms | 1200ms   | +800ms |
| Offline Operation            | > 30min  | 35min+   | +5min  |

---

## Troubleshooting Quick Reference

### Issue: Node shows RED (< 50% trust)

**Solution**: Right-click node → "Request Re-attestation" → wait 30s

### Issue: "LINK SEVERED" (red banner)

**Solution**: Verify C2 service running, check network connectivity, restart Tactical Glass

### Issue: Spoofed message accepted (not rejected)

**Solution**: Verify spoof has invalid signature (not just wrong position), check kinematic validation enabled

### Issue: Offline mode not activating (still trying to reach C2 after 5 min)

**Solution**: Force autonomous mode by editing config, reducing timeout to 0 second

See FIELD_TEST_OPERATOR_MANUAL.md "Troubleshooting Guide" for detailed procedures.

---

## Post-Test Analysis

After test completes, review generated report:

```
./field-test-metrics/field-metrics-{test-id}-REPORT.md
```

Report includes:

- ✅ Verdict (PASS / CONDITIONAL_PASS / FAIL)
- ✅ KPI metrics vs targets
- ✅ Per-unit performance
- ✅ Event logs (spoof detections, verifications, coordinations)
- ✅ Recommendations

For detailed metrics, see JSON file:

```
./field-test-metrics/field-metrics-{test-id}.json
```

---

## Files & Artifacts

### Configuration Files

- `config/mdca-field-test.yaml` - Field test mode configuration
- `config/degraded-rf-resilience.yaml` - RF degradation resilience
- `config/production.yaml` - Standard production config
- `field-nodes.txt` - Your specific node list (edit for your deployment)

### Deployment Scripts

- `scripts/deploy-field-swarm.sh` - Multi-node provisioning harness
- `scripts/doctor.js` - System health verification script
- `coderalphie/raspberry-pi/setup.sh` - System hardening
- `coderalphie/raspberry-pi/deploy-ralphie.sh` - Service deployment

### Code & Tests

- `packages/shared/src/mdca-telemetry-schema.ts` - Data schemas
- `tests/field-spoof-replay-validation.rs` - Validation test suite
- `services/gateway/src/field-telemetry-collector.ts` - Metrics collector

### Documentation

- `docs/FIELD_TEST_OPERATOR_MANUAL.md` - Complete operator guide (→ START HERE)
- `docs/OFFLINE_MESH_COORDINATION.md` - Autonomous operation guide
- `docs/AETHERIC_LINK_COMPLETE.md` - C2 heartbeat protocol
- `ARCHITECTURE.md` - System architecture overview
- `SECURITY.md` - Security model details

### Logs & Artifacts

- `/var/log/coderalphie/field-test/` - Node-specific field logs
- `/var/log/coderalphie/audit.log` - Immutable audit trail
- `./field-test-metrics/` - Collected KPI metrics and reports

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    OPERATOR WORKSTATION                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │   Tactical Glass (Dashboard)                               │ │
│  │   - Real-time mesh visualization                           │ │
│  │   - Node trust scores & position streams                   │ │
│  │   - Intent coordination UI                                 │ │
│  │   - Spoof detection warnings                               │ │
│  └────────────────┬────────────────────────────────────────────┘ │
└───────────────────┼──────────────────────────────────────────────┘
                    │ WSS (TLS 1.3 encrypted)
                    ↓
┌──────────────────────────────────────────────────────────────────┐
│              AetherCore C2 SERVER (Bunker)                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Gateway Service                                            │ │
│  │  - C2 Router (command authority)                            │ │
│  │  - Identity Registry (TPM attestation verification)         │ │
│  │  - Auth Service (operator authorization)                   │ │
│  │  - Telemetry Collector (KPI aggregation)                   │ │
│  └────────────┬───────────────────────┬──────────────────────┘ │
└───────────────┼───────────────────────┼──────────────────────────┘
                │                       │
        ┌───────┴──────┬────────┬───────┴─────┐
        │              │        │             │
        ↓              ↓        ↓             ↓
    [CodeRalphie Mesh Nodes - Field]

    ISR-01 ─── ISR-02 ─── FSO-01
     │           │          │
    MULE-1 ────MULE-2 ─────┘

    All nodes:
    - TPM-backed Ed25519 identity
    - BLAKE3 Merkle Vine chains
    - Offline mesh coordination
    - Spoof/replay rejection
```

---

## Success Criteria Summary

Your field test is **SUCCESSFUL** if:

✅ **Spoof/Replay Rejection**: > 99.5%

- Inject 100 spoofed messages
- Expect ≥ 99.5 rejections (at most 1 false positive)

✅ **Track Origin Validation**: > 95%

- Verify 100+ positions (with GNSS, denied, dead reckoning)
- Expect ≥ 95 successful verifications

✅ **Verified Intent Coordination**: > 90%

- Execute 10+ coordinated actions
- Expect ≥ 9 successful consensus approvals

✅ **Command Latency**: P99 < 2000ms

- Measure latency on 100+ commands
- 99th percentile should be < 2 seconds

✅ **Offline Operation**: > 30 minutes

- Disconnect C2 for 30+ minutes
- Expect autonomous coordination continues, no loss of function

---

## Getting Help

If you encounter issues:

1. **Check Troubleshooting Guide** (Field Operator Manual)
2. **Check Logs**: `journalctl -u coderalphie -f`
3. **Verify Config**: `cat /etc/coderalphie/config.yaml`
4. **Restart Service**: `sudo systemctl restart coderalphie`
5. **Run Pre-Test Validation** (checklist above)

---

## Architecture Philosophy

> **"Truth as a Weapon"** - Every event is cryptographically verifiable, immutable, and attributable. Unverified data is never hidden; it's flagged prominently for operator review.

The system is designed around **fail-visible** principles:

- ❌ No graceful degradation for security
- ❌ No silent data drop-off
- ✅ Prominently display verification failures
- ✅ Operator always knows what's trusted vs. unverified
- ✅ Every decision is logged and auditable

---

## Next Steps

1. **Copy field node list**: `cp field-nodes.example.txt field-nodes.txt`
2. **Edit with your node IPs**: `nano field-nodes.txt`
3. **Run deployment**: `./scripts/deploy-field-swarm.sh`
4. **Verify mesh**: Open Tactical Glass, check all nodes healthy
5. **Review Operator Manual**: `docs/FIELD_TEST_OPERATOR_MANUAL.md`
6. **Execute Scenario 1**: Start with "Initial Mesh Formation"

---

**You are now ready to deploy and test AetherCore MDCA in the field.**

Trust your hardware root of trust (CodeRalphie). Verify everything. Make every decision explicit.

**"Trust at the Tactical Edge"** ⚓

---

_For detailed step-by-step scenario execution, see: docs/FIELD_TEST_OPERATOR_MANUAL.md_
_For offline coordination details, see: docs/OFFLINE_MESH_COORDINATION.md_
_For architecture, see: ARCHITECTURE.md_
