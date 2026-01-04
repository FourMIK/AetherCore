# AetherCore Security Guidelines

**Classification:** CRITICAL  
**Mission:** Comprehensive Security Procedures and Best Practices  
**Last Updated:** 2026-01-04

---

## Overview

This document outlines security architecture, best practices, and operational procedures for AetherCore Tactical Glass and associated infrastructure. All personnel must adhere to these guidelines for production deployments.

## Table of Contents

- [Security Architecture](#security-architecture)
- [Cryptographic Standards](#cryptographic-standards)
- [Identity and Authentication](#identity-and-authentication)
- [Network Security](#network-security)
- [Production Deployment Security](#production-deployment-security)
- [Zero-Touch Enrollment Security](#zero-touch-enrollment-security)
- [Trust Mesh Security](#trust-mesh-security)
- [Incident Response](#incident-response)
- [Security Audit and Compliance](#security-audit-and-compliance)

---

## Security Architecture

### Defense-in-Depth Philosophy

AetherCore implements multi-layered security:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Hardware Root of Trust (TPM/Enclave) │
├─────────────────────────────────────────────────┤
│  Layer 2: Cryptographic Primitives (Ed25519)   │
├─────────────────────────────────────────────────┤
│  Layer 3: Trust Mesh (Byzantine Detection)     │
├─────────────────────────────────────────────────┤
│  Layer 4: Network Security (TLS 1.3/WSS)       │
├─────────────────────────────────────────────────┤
│  Layer 5: Application Security (Input Validation)
└─────────────────────────────────────────────────┘
```

### Zero-Trust Principles

**Fundamental Assumptions:**
1. **Never Trust, Always Verify**: Every operation requires cryptographic proof
2. **Assume Breach**: Design for compromise; enable rapid detection and recovery
3. **Minimize Blast Radius**: Isolate components to limit cascade failures
4. **Fail Securely**: Security failures halt operations; no graceful degradation

---

## Cryptographic Standards

### Mandatory Standards

**Hashing:**
- ✅ **BLAKE3**: All integrity verification, Merkle trees, and checksums
- ❌ **SHA-256**: Deprecated; legacy compatibility only (explicitly marked)
- ❌ **MD5**: Prohibited; immediate security failure

**Signing:**
- ✅ **Ed25519**: All digital signatures (TPM-backed in production)
- ❌ **RSA**: Not used; key size and performance concerns
- ❌ **ECDSA**: Not used; complexity and side-channel risks

**Key Storage:**
- ✅ **TPM 2.0**: Hardware-backed private key storage (production)
- ✅ **Secure Enclave**: Apple Silicon/Intel SGX (production)
- ❌ **System Memory**: Prohibited; private keys never in RAM
- ❌ **Disk Storage**: Prohibited; no private keys in files

**Transport Encryption:**
- ✅ **TLS 1.3**: All authenticated network communication
- ✅ **WSS (WebSocket Secure)**: Real-time mesh communication
- ❌ **TLS 1.2 or earlier**: Prohibited; known vulnerabilities
- ❌ **Unencrypted WebSocket**: Development only; never production

### Implementation Requirements

**Rust Crates:**
```rust
// MANDATORY: Use approved cryptographic crates
use blake3;           // Hashing
use ed25519_dalek;    // Signing
use tpm2_tss;         // TPM integration (CodeRalphie)

// PROHIBITED: Do not use these
// use sha2;          // Deprecated
// use openssl;       // Use tpm2_tss instead for production
```

**TypeScript Libraries:**
```typescript
// MANDATORY: Use approved libraries
import { blake3 } from '@noble/hashes/blake3';
import * as ed from '@noble/ed25519';

// PROHIBITED
// import sha256 from 'crypto-js/sha256';  // Deprecated
```

### CodeRalphie: TPM Integration

**Production Requirement:** All private key operations MUST use TPM 2.0.

**Implementation:**
```rust
use tpm2_tss::{TpmContext, TpmSigningKey};
use crate::error::CryptoError;

pub fn sign_with_tpm(message: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let context = TpmContext::new()?;
    let key = TpmSigningKey::load_from_tpm(context)?;
    
    // Private key never enters system memory
    let signature = key.sign(message)?;
    
    Ok(signature)
}

// PROHIBITED: Never do this in production
// fn sign_with_memory_key(message: &[u8], private_key: &[u8]) -> Signature {
//     // This exposes private keys in memory - security violation
// }
```

**Key Generation:**
```rust
// Generate key INSIDE TPM
let tpm_key = TpmContext::generate_ed25519_key()?;
let public_key = tpm_key.export_public_key()?; // Safe to export
// Private key remains in TPM, never exported
```

### Key Rotation Policy

- **Operational Keys**: Rotate every 90 days
- **Emergency Rotation**: Immediate upon suspected compromise
- **Revocation**: Use The Great Gospel ledger for instant invalidation

---

## Identity and Authentication

### Identity Hierarchy

```
┌─────────────────────────────────────────┐
│  The Great Gospel (Sovereign Ledger)   │
│  - Root of trust for all identities     │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │  Operator IDs   │
       │  (Human users)  │
       └───────┬─────────┘
               │
       ┌───────┴─────────┐
       │   Unit IDs      │
       │   (IoT devices) │
       └─────────────────┘
```

### Operator Identity Requirements

**Production Operator Accounts:**
- TPM-backed Ed25519 key pair
- Multi-factor authentication (MFA) mandatory
- Biometric verification recommended
- Regular re-authentication (24-hour sessions)

**Development/Testing:**
- Ephemeral keys acceptable
- Clearly marked in UI as "DEVELOPMENT MODE"
- No access to production meshes

### Unit Identity (IoT Devices)

**Zero-Touch Enrollment:**
1. Operator generates Genesis Bundle (signed with TPM key)
2. QR code contains:
   - Operator public key
   - Squad assignment
   - Enrollment timestamp
   - BLAKE3 hash of bundle
   - Ed25519 signature
3. Unit scans QR, verifies signature
4. Unit generates own TPM-backed key pair
5. Unit registers with mesh using Genesis Bundle proof

**Identity Verification:**
```rust
pub fn verify_genesis_bundle(bundle: &GenesisBundleQR) -> Result<(), SecurityError> {
    // 1. Verify signature using operator's public key
    let signature_valid = verify_ed25519(
        &bundle.operator_public_key,
        &bundle.payload,
        &bundle.signature,
    )?;
    
    if !signature_valid {
        return Err(SecurityError::InvalidSignature);
    }
    
    // 2. Verify hash integrity
    let computed_hash = blake3::hash(&bundle.payload);
    if computed_hash != bundle.hash {
        return Err(SecurityError::HashMismatch);
    }
    
    // 3. Check timestamp (prevent replay attacks)
    if bundle.timestamp.elapsed()? > Duration::from_secs(300) {
        return Err(SecurityError::BundleExpired);
    }
    
    Ok(())
}
```

### Authentication Failures

**Policy:** Fail immediately and loudly. No silent fallbacks.

```rust
// CORRECT: Fail-secure authentication
match authenticate_operator(credentials) {
    Ok(session) => proceed_with_session(session),
    Err(e) => {
        audit_log_failure(&e);
        terminate_connection();
        // Do NOT provide detailed error to client (leak prevention)
        return Err(SecurityError::AuthenticationFailed);
    }
}

// PROHIBITED: Silent fallback
// if let Ok(session) = authenticate_operator(credentials) {
//     proceed_with_session(session)
// } else {
//     // Silently using anonymous session - SECURITY VIOLATION
//     proceed_with_anonymous()
// }
```

---

## Network Security

### Transport Layer Security

**Mandatory Configuration:**
- **Protocol**: TLS 1.3 only
- **Cipher Suites**: 
  - `TLS_AES_256_GCM_SHA384`
  - `TLS_CHACHA20_POLY1305_SHA256`
- **Certificate Validation**: Always verify; no self-signed in production

**WebSocket Security:**
```typescript
// CORRECT: Secure WebSocket configuration
const ws = new WebSocket('wss://testnet.aethercore.local:8443', {
  rejectUnauthorized: true,  // Enforce certificate validation
  minVersion: 'TLSv1.3',
});

// PROHIBITED: Insecure configuration
// const ws = new WebSocket('ws://testnet.aethercore.local:8080');
// const ws = new WebSocket('wss://...', { rejectUnauthorized: false });
```

### Firewall Configuration

**Required Ports:**

| Port | Protocol | Purpose | Access Control |
|------|----------|---------|----------------|
| 8443 | TCP (TLS) | Testnet WebSocket | Authenticated operators only |
| 7000-7100 | TCP/UDP | Mesh P2P | Mesh members only |

**Firewall Rules (Linux/iptables):**
```bash
# Default deny
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow testnet (authenticated)
iptables -A INPUT -p tcp --dport 8443 -m state --state NEW -j ACCEPT

# Allow mesh P2P (only from mesh network)
iptables -A INPUT -p tcp --dport 7000:7100 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p udp --dport 7000:7100 -s 10.0.0.0/8 -j ACCEPT

# Drop all other inbound
iptables -A INPUT -j DROP
```

### DDoS and Rate Limiting

**Connection Limits:**
- Max connections per IP: 10
- Max connection rate: 5/second
- Max message rate: 100/second per connection

**Implementation:**
```rust
use governor::{Quota, RateLimiter};

pub struct ConnectionRateLimiter {
    limiter: RateLimiter<IpAddr>,
}

impl ConnectionRateLimiter {
    pub fn new() -> Self {
        let quota = Quota::per_second(5); // 5 connections per second
        Self {
            limiter: RateLimiter::direct(quota),
        }
    }
    
    pub fn check_rate(&self, ip: IpAddr) -> Result<(), SecurityError> {
        self.limiter.check_key(&ip)
            .map_err(|_| SecurityError::RateLimitExceeded)
    }
}
```

---

## Production Deployment Security

### Pre-Deployment Checklist

Before deploying to production:

- [ ] TPM 2.0 or Secure Enclave available and tested
- [ ] All private keys generated inside hardware root of trust
- [ ] TLS 1.3 configured with valid certificates
- [ ] Firewall rules configured and tested
- [ ] Audit logging enabled and forwarded to SIEM
- [ ] Vulnerability scan completed (see [PROVENANCE.md](PROVENANCE.md))
- [ ] Penetration testing completed (if required)
- [ ] Incident response plan documented
- [ ] Backup and recovery procedures tested
- [ ] Byzantine node detection (Aetheric Sweep) enabled
- [ ] The Great Gospel ledger synchronized

### Configuration Hardening

**Disable Development Features:**
```toml
# src-tauri/tauri.conf.json (production build)
{
  "build": {
    "devPath": false,
    "distDir": "../dist"
  },
  "tauri": {
    "allowlist": {
      "all": false,  // Deny all by default
      "shell": {
        "open": false  // Disable shell access
      }
    }
  }
}
```

**Environment Variables (Production):**
```bash
# NEVER set these in production
# export RUST_BACKTRACE=1         # Leaks stack traces
# export AETHER_DEV_MODE=true     # Disables security checks

# ALWAYS set these in production
export AETHER_ENV=production
export AETHER_TPM_REQUIRED=true
export AETHER_LOG_LEVEL=warn      # Reduce information disclosure
```

### Secure Secrets Management

**Prohibited Practices:**
- ❌ Hardcoded secrets in source code
- ❌ Secrets in environment variables
- ❌ Secrets in configuration files
- ❌ Secrets in container images

**Approved Methods:**
- ✅ TPM-backed key storage
- ✅ Hardware Security Modules (HSM)
- ✅ Secure Enclave (Apple/Intel)
- ✅ Secrets management systems (HashiCorp Vault) for non-key secrets

---

## Zero-Touch Enrollment Security

### Genesis Bundle Security Properties

**Security Requirements:**
1. **Authenticity**: Signed by authorized operator's TPM key
2. **Integrity**: BLAKE3 hash prevents tampering
3. **Freshness**: Timestamp prevents replay attacks (5-minute window)
4. **Non-repudiation**: Ed25519 signature provides proof of origin

### QR Code Security

**Threat Model:**
- **Attack**: QR code interception/modification
- **Mitigation**: Cryptographic signature verification

**Implementation:**
```rust
pub struct GenesisBundleQR {
    pub operator_id: String,
    pub operator_public_key: [u8; 32],
    pub squad_id: String,
    pub timestamp: SystemTime,
    pub payload_hash: [u8; 32],      // BLAKE3
    pub signature: [u8; 64],         // Ed25519
}

impl GenesisBundleQR {
    pub fn verify(&self) -> Result<(), SecurityError> {
        // 1. Check freshness (prevent replay)
        let age = self.timestamp.elapsed()?;
        if age > Duration::from_secs(300) {
            return Err(SecurityError::BundleExpired);
        }
        
        // 2. Verify hash
        let computed_hash = self.compute_payload_hash();
        if computed_hash != self.payload_hash {
            return Err(SecurityError::IntegrityViolation);
        }
        
        // 3. Verify Ed25519 signature
        let public_key = PublicKey::from_bytes(&self.operator_public_key)?;
        public_key.verify(&self.payload_hash, &self.signature)
            .map_err(|_| SecurityError::InvalidSignature)?;
        
        Ok(())
    }
}
```

### Enrollment Failures

**Failure Scenarios:**
1. **Signature Invalid**: Unit MUST NOT join mesh; treat operator as adversary
2. **Hash Mismatch**: Unit MUST NOT join mesh; data tampered
3. **Expired Bundle**: Unit MUST NOT join mesh; potential replay attack

**Policy:** NO graceful degradation. Security failures are Byzantine events.

---

## Trust Mesh Security

### Merkle Vine Structure

All events form cryptographic chain (Merkle Vine):

```
Event[n] = {
  payload: DATA,
  previous_hash: BLAKE3(Event[n-1]),
  signature: Ed25519(Event[n], private_key),
  timestamp: UTC
}
```

**Integrity Property:** Any tampering breaks the chain; detected immediately.

### Byzantine Node Detection (Aetheric Sweep)

**Aetheric Sweep Protocol:**
1. Continuous monitoring of Merkle Vine integrity
2. Detection of:
   - Invalid signatures
   - Hash chain breaks
   - Timestamp anomalies
   - Revoked identities (Great Gospel lookup)
3. Immediate isolation of Byzantine nodes
4. Mesh-wide propagation of revocation

**Implementation:**
```rust
pub async fn sweep_for_byzantine_nodes(mesh: &TrustMesh) -> Vec<NodeId> {
    let mut byzantine_nodes = Vec::new();
    
    for node in mesh.all_nodes() {
        // Check signature validity
        if !node.verify_current_signature() {
            byzantine_nodes.push(node.id);
            continue;
        }
        
        // Check Merkle Vine integrity
        if !node.verify_merkle_chain() {
            byzantine_nodes.push(node.id);
            continue;
        }
        
        // Check against The Great Gospel
        if gospel::is_revoked(&node.identity).await? {
            byzantine_nodes.push(node.id);
            continue;
        }
    }
    
    // Isolate detected adversaries
    for node_id in &byzantine_nodes {
        mesh.isolate_node(*node_id).await?;
        audit_log_byzantine_detection(*node_id);
    }
    
    byzantine_nodes
}
```

### The Great Gospel: Revocation Ledger

**Purpose:** System-wide sovereign identity revocation.

**Security Properties:**
- Immutable append-only ledger
- Cryptographically signed revocation entries
- Real-time synchronization across mesh
- Byzantine-fault-tolerant consensus

**Revocation Process:**
1. Security team detects compromise
2. Revocation entry created with:
   - Identity to revoke
   - Reason (enum: COMPROMISED, MALICIOUS, EXPIRED)
   - Timestamp
   - Authorizing operator signature
3. Entry propagated to all mesh nodes
4. Revoked identity immediately isolated

---

## Incident Response

### Security Incident Classification

**Severity Levels:**

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| CRITICAL | Active compromise | Immediate | Private key exposure |
| HIGH | Potential compromise | <1 hour | Vulnerability exploitation attempt |
| MEDIUM | Policy violation | <4 hours | Unauthorized access attempt |
| LOW | Informational | <24 hours | Failed login attempts |

### Incident Response Procedures

**CRITICAL Incident Response:**
1. **Immediate Actions** (0-5 minutes):
   - Isolate affected systems from mesh
   - Revoke compromised identities in The Great Gospel
   - Initiate Aetheric Sweep across entire mesh
   - Alert security team (PagerDuty/similar)

2. **Containment** (5-30 minutes):
   - Identify scope of compromise
   - Rotate all potentially exposed keys
   - Review audit logs for lateral movement
   - Document timeline and actions

3. **Eradication** (30 min - 2 hours):
   - Remove adversary access
   - Patch vulnerabilities
   - Restore from known-good backups if needed

4. **Recovery** (2-24 hours):
   - Gradually restore affected systems
   - Monitor for reinfection
   - Conduct post-incident review

5. **Lessons Learned** (1 week):
   - Root cause analysis
   - Update security controls
   - Update incident response playbook

### Audit Logging

**Mandatory Logging Events:**
- Authentication attempts (success and failure)
- Identity operations (creation, revocation)
- Cryptographic operations (signing, verification)
- Mesh membership changes
- Byzantine node detections
- Configuration changes

**Log Format:**
```json
{
  "timestamp": "2026-01-04T20:00:00Z",
  "event_type": "AUTHENTICATION_FAILURE",
  "severity": "MEDIUM",
  "operator_id": "operator-001",
  "source_ip": "10.0.1.50",
  "details": {
    "reason": "Invalid signature",
    "attempt_count": 3
  },
  "hash": "blake3:a1b2c3..."  // Event integrity
}
```

**Log Security:**
- Forward to centralized SIEM immediately
- Tamper-evident logging (append-only, signed)
- Retain for minimum 1 year (compliance)
- Encrypt at rest and in transit

---

## Security Audit and Compliance

### Regular Security Audits

**Quarterly Audits:**
- Vulnerability scanning (see [PROVENANCE.md](PROVENANCE.md))
- Dependency audits (cargo-audit, npm audit)
- Configuration reviews
- Access control reviews

**Annual Audits:**
- Penetration testing (third-party)
- Code security review
- Incident response drill
- Disaster recovery testing

### Compliance Requirements

**NIST SP 800-218 (Secure Software Development Framework):**
- ✅ Prepare the Organization (PO)
- ✅ Protect the Software (PS)
- ✅ Produce Well-Secured Software (PW)
- ✅ Respond to Vulnerabilities (RV)

**EO 14028 (Cybersecurity Supply Chain Security):**
- ✅ SBOM generation and distribution
- ✅ Vulnerability disclosure process
- ✅ Secure development practices

**CIS Controls:**
- ✅ Inventory and control of software assets
- ✅ Secure configuration
- ✅ Continuous vulnerability management
- ✅ Audit log management

### Security Metrics

**Track and Report:**
- Mean Time to Detect (MTTD): <5 minutes
- Mean Time to Respond (MTTR): <30 minutes
- Vulnerability patching SLA: <7 days for HIGH/CRITICAL
- Authentication failure rate: <0.1%
- Byzantine node detection rate: Log and investigate

---

## Vulnerability Disclosure

### Reporting Security Vulnerabilities

**DO NOT** create public GitHub issues for security vulnerabilities.

**Instead:**
1. Email security team: security@aethercore.io (PGP key available)
2. Include:
   - Vulnerability description
   - Steps to reproduce
   - Potential impact
   - Suggested remediation (if known)
3. Use Signal for urgent/sensitive issues: [Contact Info]

**Response SLA:**
- Acknowledgment: <24 hours
- Initial assessment: <72 hours
- Remediation plan: <7 days
- Fix deployed: <30 days (HIGH/CRITICAL)

### Coordinated Disclosure

We follow responsible disclosure practices:
- 90-day disclosure window
- Coordination with affected parties
- CVE assignment for confirmed vulnerabilities
- Public advisory after remediation

---

## Security Contact

**Security Team Email:** security@aethercore.io  
**PGP Key Fingerprint:** [To be added]  
**Signal:** [To be added]

---

## Related Documentation

- [INSTALLATION.md](INSTALLATION.md) - Installation procedures
- [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md) - Deployment guide
- [PROVENANCE.md](PROVENANCE.md) - Supply chain security and SBOM
- [docs/SUPPLY_CHAIN_SECURITY.md](docs/SUPPLY_CHAIN_SECURITY.md) - Detailed supply chain procedures
- [docs/production-deployment-playbook.md](docs/production-deployment-playbook.md) - Production deployment
- [services/collaboration/TPM_INTEGRATION_V2.md](services/collaboration/TPM_INTEGRATION_V2.md) - TPM integration details

---

**Status:** SECURITY GUIDELINES OPERATIONAL ✅  
**Classification:** CRITICAL  
**Maintainer:** AetherCore Security Team  
**Next Review:** Quarterly or upon critical vulnerability disclosure
