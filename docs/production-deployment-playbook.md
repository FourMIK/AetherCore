# AetherCore Production Deployment Playbook

## Overview

This playbook provides step-by-step procedures for deploying the AetherCore mesh in production environments. It ensures hardware attestation integrity, NIST 800-171 compliance, and optimal performance of the BLAKE3/Ed25519 cryptographic pipeline.

---

## Prerequisites

### Hardware Requirements

- **TPM 2.0**: Firmware version ≥ 1.38
  - Verify with: `tpm2_getcap properties-fixed`
  - Required capabilities: `TPM2_PT_MANUFACTURER`, `TPM2_PT_FIRMWARE_VERSION_1`

- **Secure Enclave** (macOS/iOS only): Apple T2 or later
  - Verify with: `ioreg -l | grep AppleKeyStore`

- **CPU**: x86_64 with AES-NI, AVX2 (for BLAKE3 SIMD acceleration)
  - Verify with: `lscpu | grep -E "aes|avx2"`

### Software Requirements

- **Rust**: 1.70+ with `cargo`
- **Node.js**: 18+ with `npm` 9+
- **OpenSSL**: 3.0+ (for TLS 1.3)
- **NTP**: Configured and synchronized (≤ 1s drift)

---

## Phase 1: Pre-Deployment Validation

### Step 1.1: TPM Health Check

Run the TPM attestation test utility:

```bash
cd /opt/aethercore
cargo run --bin tpm-attestation-test --release
```

**Expected Output**:
```
[INFO] TPM 2.0 detected: Manufacturer=IFX (Infineon), Firmware=7.85
[INFO] Generating AIK...
[INFO] Creating Quote over PCRs [0,1,2,7]...
[INFO] Signing Quote with AIK...
[INFO] Verifying signature...
[SUCCESS] TPM attestation passed!
[INFO] Public key (PEM):
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----
```

**Failure Handling**:
- If TPM not detected → Check BIOS settings, enable TPM
- If Quote generation fails → Update TPM firmware
- If signature verification fails → TPM is compromised; replace hardware

### Step 1.2: Cryptographic Benchmarks

Run the performance benchmark suite:

```bash
cargo run --bin aethercore-bench --release
```

**Expected Metrics**:

| Operation | Target | Acceptable | Failure |
|-----------|--------|------------|---------|
| BLAKE3 (1MB) | > 2 GB/s | > 1 GB/s | < 500 MB/s |
| Ed25519 Sign (TPM) | < 50ms | < 100ms | > 200ms |
| Ed25519 Verify | < 1ms | < 5ms | > 10ms |
| Merkle Vine Append | < 10µs | < 50µs | > 100µs |

**Failure Handling**:
- If BLAKE3 < 500 MB/s → Check CPU SIMD support (AVX2)
- If Ed25519 Sign > 200ms → TPM performance issue; check firmware
- If Merkle Vine > 100µs → Insufficient CPU/Memory; upgrade hardware

### Step 1.3: Network Connectivity

Verify firewall rules permit required ports:

```bash
# WSS (WebSocket Secure) for dashboard
sudo ufw allow 443/tcp

# gRPC for inter-service communication
sudo ufw allow 50051/tcp

# Verify outbound NTP
sudo ufw allow out 123/udp
```

Test NTP synchronization:

```bash
ntpq -p
```

**Expected Output**:
```
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*ntp.example.com .GPS.            1 u   64   64  377    0.123   -0.001   0.050
```

**Failure Handling**:
- If offset > 1s → Adjust NTP server selection
- If reach < 377 → Check firewall/network routing

---

## Phase 2: Genesis Bundle Distribution

### Step 2.1: Generate Federation Root Certificate

On the **Federation Authority** node:

```bash
cd /opt/aethercore
cargo run --bin aether-keygen -- \
  --output /secure/federation-root.pem \
  --type federation-root \
  --validity-days 3650
```

**Output Files**:
- `/secure/federation-root.pem` (Public certificate)
- `/secure/federation-root.key` (Private key - TPM-backed)

**Security Note**: The private key MUST be stored in TPM NVRAM. Never copy to disk.

### Step 2.2: Create Genesis Bundle

```bash
cargo run --bin aether-genesis -- \
  --root-cert /secure/federation-root.pem \
  --initial-merkle-root $(cat /var/lib/aethercore/initial-root.txt) \
  --output /dist/genesis-bundle.bin
```

**Output**: `/dist/genesis-bundle.bin` (Encrypted binary blob)

### Step 2.3: Distribute Genesis Bundle

**Option A: Out-of-Band (USB)**
1. Copy `genesis-bundle.bin` to encrypted USB drive
2. Physically deliver to each deployment site
3. Load on each node:
   ```bash
   sudo cp /media/usb/genesis-bundle.bin /etc/aethercore/
   sudo chmod 400 /etc/aethercore/genesis-bundle.bin
   ```

**Option B: Secure Channel (TLS)**
1. Set up temporary TLS server on Federation Authority
2. Each node downloads via mTLS:
   ```bash
   curl --cert /etc/pki/node-cert.pem \
        --key /etc/pki/node-key.pem \
        --cacert /etc/pki/ca-bundle.crt \
        https://federation.internal/genesis-bundle.bin \
        -o /etc/aethercore/genesis-bundle.bin
   ```

---

## Phase 3: Node Enrollment

### Step 3.1: Boot Node with Genesis Bundle

```bash
systemctl start aethercore-node
journalctl -u aethercore-node -f
```

**Expected Log Sequence**:
```
[INFO] Loading genesis bundle from /etc/aethercore/genesis-bundle.bin
[INFO] Verifying bundle signature...
[SUCCESS] Genesis bundle validated
[INFO] Generating TPM Quote for enrollment...
[INFO] Sending enrollment request to Federation Authority...
[INFO] Received PlatformIdentity (NodeID: unit-alpha-7)
[SUCCESS] Enrollment complete. Joining mesh...
```

### Step 3.2: Verify Mesh Connectivity

Check that node appears in Federation registry:

```bash
aether-ctl list-nodes --status HEALTHY
```

**Expected Output**:
```
NODE_ID          STATUS    TRUST_SCORE  LAST_SEEN
unit-alpha-7     HEALTHY   0.98         2s ago
unit-bravo-3     HEALTHY   0.99         1s ago
...
```

---

## Phase 4: Dashboard Deployment

### Step 4.1: Install Dashboard Certificate

Copy Federation Root Certificate to dashboard trust store:

```bash
sudo cp /dist/federation-root.pem /etc/aethercore/dashboard/trusted-root.pem
sudo chmod 444 /etc/aethercore/dashboard/trusted-root.pem
```

### Step 4.2: Configure WSS Endpoint

Edit `/etc/aethercore/dashboard/config.json`:

```json
{
  "websocket": {
    "url": "wss://sentinel.aethercore.local/mesh/health",
    "tls": {
      "pinned_cert": "/etc/aethercore/dashboard/trusted-root.pem",
      "min_version": "TLSv1.3"
    }
  },
  "update_frequency_hz": 1,
  "aetheric_sweep_frequency_hz": 10
}
```

### Step 4.3: Start Dashboard

```bash
cd /opt/aethercore/packages/dashboard
pnpm run build
pnpm run start -- --port 8443 --tls
```

**Access Dashboard**:
- URL: `https://localhost:8443`
- Login with operator credentials (hardware token required)

---

## Phase 5: NIST 800-171 Compliance Validation

### Step 5.1: Enable Audit Logging

Edit `/etc/aethercore/audit.conf`:

```toml
[audit]
enabled = true
log_path = "/var/log/aethercore/audit.log"
merkle_tree_path = "/var/lib/aethercore/audit-merkle.db"
root_publish_interval_s = 300  # Publish root every 5 minutes

[retention]
days = 2555  # 7 years (NIST 800-171 requirement)
```

Restart audit service:

```bash
systemctl restart aethercore-audit
```

### Step 5.2: Verify Non-Repudiation

Perform a test actuation and verify audit trail:

```bash
aether-ctl config-update --key mesh.quorum_size --value 5
aether-ctl audit-log --last 1
```

**Expected Output**:
```json
{
  "event_id": "a3f2c1e5-...",
  "timestamp_ns": 1704153600000000000,
  "operator_id": "operator-alice",
  "action": "ConfigUpdate",
  "target": "mesh.quorum_size=5",
  "signature": "3a4f9e2b...",
  "merkle_proof": ["7f3a2c1d...", "9e4b8f2a..."]
}
```

Verify signature:

```bash
aether-ctl audit-verify --event-id a3f2c1e5-...
```

**Expected**: `[SUCCESS] Signature valid, Merkle proof verified`

### Step 5.3: Audit Trail Integrity Check

Run daily integrity check (add to cron):

```bash
0 2 * * * /opt/aethercore/bin/audit-integrity-check
```

**Failure Handling**:
- If Merkle root mismatch → Investigate tampering; restore from backup
- If signature invalid → Operator key compromised; revoke credentials

---

## Phase 6: Contested Mode Testing

### Step 6.1: Simulate 80% Packet Loss

Use `tc` (traffic control) to inject packet loss:

```bash
sudo tc qdisc add dev eth0 root netem loss 80%
```

Monitor mesh health:

```bash
aether-ctl mesh-status --watch
```

**Expected Behavior**:
- Nodes maintain connectivity via aggressive retransmission
- Gospel synchronization completes within 30 seconds
- No nodes marked as COMPROMISED

### Step 6.2: Test Aetheric Sweep

Manually trigger a node purge:

```bash
aether-ctl purge unit-test-1 --reason "OperatorOverride"
```

**Verify on Dashboard**:
1. Revoked node icon pulses red
2. Expanding concentric circles animate
3. Neighboring nodes briefly highlight
4. Final state: `unit-test-1` grayed out, status=PURGED

### Step 6.3: Mesh Recovery

Remove packet loss:

```bash
sudo tc qdisc del dev eth0 root netem
```

Monitor recovery:

```bash
aether-ctl mesh-status --watch
```

**Expected**:
- Nodes re-synchronize Gospel within 10 seconds
- Mesh transitions to HEALTHY state
- Dashboard displays "Mesh Resync Complete"

---

## Phase 7: Performance Validation

### Step 7.1: Telemetry Throughput Test

Generate synthetic telemetry load:

```bash
cargo run --bin telemetry-load-test -- \
  --nodes 100 \
  --rate 10 \
  --duration 60
```

**Expected Results**:
- Throughput: > 1000 events/second per node
- Latency (P50): < 10ms
- Latency (P99): < 50ms

### Step 7.2: Dashboard Responsiveness

Open Dashboard and monitor update latency:

```bash
aether-ctl dashboard-metrics
```

**Expected**:
- WebSocket latency: < 100ms
- UI render time: < 16ms (60 FPS)
- No dropped frames during Aetheric Sweep animation

---

## Phase 8: Operational Readiness

### Step 8.1: Backup Critical Data

```bash
# Backup Gospel ledger
tar -czf gospel-backup-$(date +%Y%m%d).tar.gz \
  /var/lib/aethercore/gospel.db

# Backup audit trail
tar -czf audit-backup-$(date +%Y%m%d).tar.gz \
  /var/log/aethercore/audit.log \
  /var/lib/aethercore/audit-merkle.db

# Store backups on encrypted volume
mv *.tar.gz /mnt/secure-backup/
```

### Step 8.2: Document Baseline

Record baseline metrics for future comparison:

```bash
aether-ctl export-baseline --output /var/lib/aethercore/baseline-$(date +%Y%m%d).json
```

### Step 8.3: Operator Training

Ensure all operators complete:
- [ ] Hardware token enrollment
- [ ] Dashboard navigation training
- [ ] Emergency purge procedures
- [ ] Mesh recovery drills

---

## Troubleshooting

### Issue: Node Fails Enrollment

**Symptoms**: `[ERROR] TPM Quote verification failed`

**Resolution**:
1. Check TPM PCR values: `tpm2_pcrread sha256:0,1,2,7`
2. Verify PCRs match expected baseline
3. If mismatch → Firmware/BIOS compromised; re-image node

### Issue: Dashboard Cannot Connect

**Symptoms**: `WebSocket connection refused`

**Resolution**:
1. Verify WSS endpoint: `curl -v wss://sentinel.aethercore.local/mesh/health`
2. Check TLS certificate: `openssl s_client -connect sentinel.aethercore.local:443`
3. Ensure pinned cert matches Federation Root

### Issue: High Latency

**Symptoms**: Dashboard updates lag > 1 second

**Resolution**:
1. Check network: `ping -c 10 sentinel.aethercore.local`
2. Monitor CPU: `top -bn1 | grep aethercore`
3. If CPU > 80% → Scale horizontally (add more sentinel nodes)

---

## Maintenance Schedule

| Task | Frequency | Command |
|------|-----------|---------|
| Audit integrity check | Daily | `audit-integrity-check` |
| Gospel backup | Weekly | `gospel-backup.sh` |
| TPM firmware update | Quarterly | `tpm-firmware-update` |
| Certificate rotation | Annually | `aether-keygen --rotate` |
| Performance baseline | Quarterly | `export-baseline` |

---

## Compliance Checklist

- [ ] All nodes enrolled with TPM attestation
- [ ] Genesis Bundle securely distributed
- [ ] TLS 1.3 enforced on all pathways
- [ ] Audit logging enabled (7-year retention)
- [ ] Non-repudiation verified for all actuations
- [ ] Contested mode testing completed
- [ ] Operator training documented
- [ ] Baseline metrics recorded
- [ ] Backup procedures validated

---

## Emergency Contacts

- **Federation Authority**: `+1-555-MESH-OPS`
- **Security Incident**: `security@aethercore.local`
- **TPM Vendor Support**: `https://support.infineon.com`

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-02  
**Next Review**: 2026-Q2

End of Playbook.
