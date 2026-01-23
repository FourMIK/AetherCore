# AetherCore Dev Mode

**Last Updated:** 2025-01-23  
**Purpose:** Define capabilities and limitations of Development Mode deployment

---

## What is Dev Mode?

**Dev Mode** is a configuration of AetherCore designed for:

- **Local development and testing** of core protocols
- **Controlled technical demonstrations** of system capabilities
- **Engineering validation** of distributed algorithms
- **Integration testing** without production dependencies

Dev Mode runs as a **Windows desktop application** with embedded runtime components.

## What Dev Mode Provides

### Core Functionality

✅ **Merkle Vine Streaming Protocol**
- Data integrity chaining via BLAKE3 hashing
- Event ancestry verification
- Tamper-evident data structures

✅ **Trust Mesh Coordination**
- Peer trust scoring based on verification history
- Byzantine node detection
- Gossip protocol for trust dissemination

✅ **Mesh Networking**
- Peer discovery and routing
- Message propagation
- Network topology visualization

✅ **Operator Interface (Tactical Glass)**
- Real-time node status monitoring
- Telemetry visualization
- Manual node provisioning
- Trust state inspection

✅ **Simulated Multi-Node Environment**
- Local mesh simulation
- Controlled Byzantine behavior injection
- Performance benchmarking

### Development Features

✅ **Hot Reload Development**
- Fast iteration via Tauri dev mode
- Immediate UI updates
- Live code reloading

✅ **Detailed Logging**
- Comprehensive debug output
- Trace-level protocol visibility
- Performance instrumentation

✅ **Local State Persistence**
- Configuration saved to local storage
- Node state recovery across restarts
- Telemetry history retention

## What Dev Mode Does NOT Provide

### Production Security Features

❌ **Hardware-Backed Identity**
- No TPM integration
- No Secure Enclave usage
- Private keys stored in software

❌ **Remote Attestation**
- No platform integrity verification
- No boot chain validation
- No runtime integrity proofs

❌ **Hardware Root of Trust**
- Identity registry uses mock implementation
- Signatures generated via software-only Ed25519
- No hardware security module (HSM) integration

### Production Hardening

❌ **Supply Chain Verification**
- No runtime binary attestation
- No code signing enforcement (dev builds)
- SBOM generated but not cryptographically bound

❌ **Network Security Hardening**
- Certificate validation may be relaxed
- No certificate pinning
- Localhost connections for demo purposes

❌ **Operational Resilience**
- No automatic failover
- No distributed consensus for configuration
- Single-node desktop execution only

### Regulatory Compliance

❌ **Certification**
- Not evaluated for FIPS 140-3
- Not assessed for Common Criteria
- Not authorized for any deployment classification

❌ **Production Readiness**
- Not suitable for operational deployment
- Not intended for sensitive data processing
- Not authorized for field use

## Use Cases for Dev Mode

### ✅ Appropriate Uses

**Engineering Development**
- Protocol development and testing
- Algorithm validation
- Performance profiling
- Integration testing

**Controlled Demonstrations**
- Technical walkthroughs for engineering audiences
- Proof-of-concept presentations
- Academic research collaboration
- Internal design reviews

**Training and Education**
- Developer onboarding
- Protocol education
- System architecture training
- Trust mesh concept demonstration

### ❌ Inappropriate Uses

**Operational Deployment**
- Do NOT deploy to field environments
- Do NOT process classified information
- Do NOT use for mission-critical operations
- Do NOT connect to production networks

**Security-Critical Applications**
- Do NOT rely on for authentication in production
- Do NOT use for cryptographic key management
- Do NOT trust for tamper detection in adversarial environments
- Do NOT use for compliance-requiring applications

## Dev Mode vs Production Comparison

| Feature | Dev Mode | Production |
|---------|----------|------------|
| **Identity Registry** | Mock/Simulated | TPM-backed hardware registry |
| **Signing Keys** | Software storage | TPM/Secure Enclave only |
| **Attestation** | None | Remote attestation required |
| **Trust Anchors** | Local configuration | Distributed consensus anchors |
| **Network Security** | TLS optional | TLS 1.3 mandatory + pinning |
| **Deployment** | Single desktop | Distributed edge nodes |
| **Logging** | Verbose debug | Minimal audit logs |
| **UI** | Full Tactical Glass | Operator-specific views |
| **Configuration** | Manual/local | Zero-Touch Provisioning |
| **Updates** | Manual reinstall | Secure OTA updates |

## Security Boundaries in Dev Mode

### What is Verified

✅ **Data Integrity**
- BLAKE3 hashes verified for all events
- Merkle Vine ancestry chains validated
- Tamper detection within protocol

✅ **Signature Validity**
- Ed25519 signatures mathematically verified
- Public key cryptography enforced
- Digital signature standards compliant

### What is NOT Verified

❌ **Platform Integrity**
- No assurance binary is authentic
- No verification of runtime environment
- No detection of OS-level tampering

❌ **Identity Authenticity**
- Node identities are self-asserted
- No binding to physical hardware
- No proof of authorized enrollment

## Technical Limitations

### Performance

- **Latency:** Not optimized for production workloads
- **Throughput:** Single-node limits, no horizontal scaling
- **Concurrency:** Limited by desktop OS scheduler

### Scale

- **Node Count:** Practical limit ~100 simulated nodes
- **Telemetry Rate:** Subject to desktop hardware limits
- **Storage:** Bounded by local disk space

### Reliability

- **Fault Tolerance:** None - single process
- **Recovery:** Manual restart required
- **Persistence:** Best-effort local storage only

## Logging and Observability

### Log Levels

Dev Mode enables comprehensive logging:

```
TRACE - Protocol message details
DEBUG - Internal state transitions
INFO  - Operational events
WARN  - Recoverable issues
ERROR - Unrecoverable failures
```

### Log Locations

**Windows:**
```
%APPDATA%\com.aethercore.tactical-glass-dev\logs\
```

**Linux (WSL):**
```
~/.local/share/com.aethercore.tactical-glass-dev/logs/
```

### Log Contents

Logs contain:
- Timestamp with microsecond precision
- Thread ID and module path
- Event type and severity
- Protocol message payloads (may be large)

**Note:** Do NOT share logs containing sensitive simulated data.

## Configuration in Dev Mode

### Configuration Files

**Tauri Config:**
```
packages/dashboard/src-tauri/tauri.conf.json
```

**Application State:**
```
%APPDATA%\com.aethercore.tactical-glass-dev\state.db
```

### Environment Variables

Set these for debug logging:

```bash
set RUST_LOG=debug,aethercore=trace
set RUST_BACKTRACE=1
```

## Transitioning from Dev Mode to Production

Moving to production requires:

1. **Hardware Integration**
   - Replace `MockIdentityRegistry` with TPM-backed registry
   - Integrate hardware signing via FFI to `crates/crypto`
   - Implement attestation client

2. **Network Hardening**
   - Enable mandatory TLS 1.3
   - Implement certificate pinning
   - Harden WebSocket authentication

3. **Configuration Management**
   - Replace local config with distributed trust anchors
   - Implement Zero-Touch Provisioning
   - Deploy configuration consensus protocol

4. **Operational Tooling**
   - Integrate with monitoring/alerting infrastructure
   - Implement secure update mechanism
   - Deploy distributed logging aggregation

5. **Compliance and Testing**
   - Conduct security audit
   - Perform penetration testing
   - Obtain required certifications

See `docs/production-deployment-playbook.md` for detailed production procedures.

## Disclaimer

**Dev Mode is explicitly NOT authorized for:**
- Production deployment
- Processing of classified information
- Mission-critical operations
- Compliance-requiring environments
- Field deployment of any kind

**Dev Mode makes NO claims regarding:**
- DoD certification or authorization
- FIPS 140-3 compliance
- Common Criteria evaluation
- Production security posture

All demonstrations and tests conducted in Dev Mode must be clearly labeled as **non-operational** and **for development purposes only**.

---

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture overview
- [SECURITY_SCOPE.md](SECURITY_SCOPE.md) - Security boundaries and threat model
- [RUNNING_ON_WINDOWS.md](RUNNING_ON_WINDOWS.md) - Windows operational guide
- [PROTOCOL_OVERVIEW.md](PROTOCOL_OVERVIEW.md) - Protocol concepts
