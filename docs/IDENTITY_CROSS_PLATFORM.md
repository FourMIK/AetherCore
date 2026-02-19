# Cross-Platform Identity Implementation

This document describes the AetherCore cross-platform identity system that ensures identical identity generation across all hardware architectures.

## Core Principle

**A "Node" is defined by its ability to generate a Genesis Hash and sign a Merkle Stream.**

This definition must be identical across:
- **MCU**: Arduino, ESP32, STM32, etc.
- **SBC**: Raspberry Pi, Jetson, etc.
- **Server**: Cloud nodes, data centers
- **Edge**: Future embedded platforms

## Protocol Specification

### Identity Block Structure

```typescript
interface IdentityBlock {
  hardware_id: string;      // MAC Address
  public_key: string;       // Ed25519 Public Key (hex)
  genesis_hash: string;     // BLAKE3(hardware_id + public_key + salt)
  platform_type: 'MCU' | 'SBC';  // Metadata only
}
```

### Genesis Hash Computation

```
genesis_hash = BLAKE3(hardware_id || public_key || salt)
```

Where:
- `||` represents string concatenation
- `BLAKE3` is the cryptographic hash function
- Output is 32 bytes (64 hex characters)

### Canonical Order

The concatenation order is **CRITICAL** and must be:
1. `hardware_id`
2. `public_key`
3. `salt`

Any other order will produce a different hash and break cross-platform compatibility.

## Implementation Files

### TypeScript (Reference Implementation)

**Location**: `packages/shared/src/identity.ts`

This is the canonical reference implementation. All other implementations must match its behavior.

**Key Functions**:
- `generateGenesisHash()` - Computes BLAKE3 hash
- `createIdentityBlock()` - Creates complete identity
- `verifyIdentityBlock()` - Validates identity

**Dependencies**:
- `hash-wasm` - BLAKE3 implementation for Node.js/Browser

### C++ (Arduino/Embedded)

**Location**: `embedded/arduino_satellite/`

Files:
- `identity.h` - Header with protocol definitions
- `identity.cpp` - Implementation
- `example.ino` - Example sketch with test vector

**Status**: ⚠️ Requires BLAKE3 C library integration

The current implementation includes a placeholder hash function. For production:

1. Install BLAKE3 C library from: https://github.com/BLAKE3-team/BLAKE3
2. Link against `blake3.c`
3. Replace placeholder in `blake3_hash()` function

### TypeScript (Linux/Pi Agent)

**Location**: `agent/linux/src/identity.ts`

This implementation uses the shared TypeScript code to manage identity on Linux SBCs.

**Features**:
- Automatic MAC address detection
- Persistent identity storage (`/etc/4mik/identity.json`)
- Key pair generation (placeholder - should use TPM)
- CLI tool for identity management

## Test Vector

For cross-platform verification, use this test vector:

```
Hardware ID: AA:BB:CC:DD:EE:FF
Public Key:  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Salt:        test-salt-12345

Expected Genesis Hash:
5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e
```

All implementations MUST produce this exact hash for these inputs.

## Validation Tests

**Location**: `tests/cross-platform/identity.test.ts`

Run tests:
```bash
cd tests/cross-platform
pnpm install --frozen-lockfile
npm test
```

Tests verify:
- ✓ Deterministic hash generation
- ✓ Different inputs produce different hashes
- ✓ Identity block creation for MCU and SBC
- ✓ Verification of valid and invalid blocks
- ✓ Protocol invariants (concatenation order, sensitivity, edge cases)

## Integration Guide

### Arduino Integration

```cpp
#include "identity.h"

void setup() {
  Serial.begin(115200);
  
  IdentityBlock block;
  createIdentityBlock(
    "AA:BB:CC:DD:EE:FF",  // Your MAC address
    "your-public-key",     // Ed25519 key (64 hex chars)
    "your-salt",           // Salt value
    MCU,                   // Platform type
    &block
  );
  
  printIdentityBlock(&block);
}
```

### Raspberry Pi Integration

```typescript
import { LinuxIdentityAgent } from '@aethercore/linux-agent';

const agent = new LinuxIdentityAgent();
const salt = 'your-salt-value';

// Get or create identity
const identity = await agent.getOrCreateIdentity(salt);

console.log('Genesis Hash:', identity.genesis_hash);
```

### Node.js Integration

```typescript
import { createIdentityBlock } from '@aethercore/shared';

const identity = await createIdentityBlock(
  'AA:BB:CC:DD:EE:FF',  // MAC address
  'your-public-key',     // Ed25519 key
  'your-salt',           // Salt
  'SBC'                  // Platform type
);

console.log('Genesis Hash:', identity.genesis_hash);
```

## Security Considerations

### Current Implementation

⚠️ **WARNING**: The current implementation is for protocol verification only.

**NOT Production Ready**:
- Placeholder key generation (should use TPM/Secure Enclave)
- Keys stored in memory (violates CodeRalphie requirements)
- No hardware attestation

### Production Requirements

For production deployment:

1. **TPM Integration** (CodeRalphie)
   - Keys must be generated in TPM/Secure Enclave
   - Private keys never touch system memory
   - Hardware-backed attestation

2. **Key Management**
   - Ed25519 keypair generation via TPM
   - Public key stored in identity block
   - Private key stays in hardware

3. **Attestation**
   - TPM quote for platform state
   - PCR measurements
   - Firmware verification

4. **Identity Lifecycle**
   - Genesis (first boot)
   - Renewal (periodic re-attestation)
   - Revocation (compromise detected)

## Verification Checklist

Before deploying to production:

- [ ] BLAKE3 C library integrated (not placeholder)
- [ ] TypeScript tests pass (all 14 tests)
- [ ] Arduino produces correct hash for test vector
- [ ] Raspberry Pi produces correct hash for test vector
- [ ] Cross-platform hashes match exactly
- [ ] TPM integration complete (CodeRalphie)
- [ ] Private keys never in system memory
- [ ] Hardware attestation working
- [ ] Identity persistence implemented
- [ ] Revocation mechanism tested

## Troubleshooting

### Hash Mismatch

If hashes don't match across platforms:

1. **Check concatenation order**: hardware_id + public_key + salt
2. **Verify input encoding**: All strings should be UTF-8
3. **Check BLAKE3 version**: Use official BLAKE3 implementation
4. **Verify hex encoding**: Lowercase, no prefixes (0x)
5. **Check for whitespace**: No trailing newlines or spaces

### BLAKE3 Not Available

Arduino:
```bash
# Install BLAKE3 C library
git clone https://github.com/BLAKE3-team/BLAKE3
cp BLAKE3/c/blake3.c ~/Arduino/libraries/BLAKE3/
cp BLAKE3/c/blake3.h ~/Arduino/libraries/BLAKE3/
```

Node.js:
```bash
pnpm add hash-wasm
```

## References

- BLAKE3 Specification: https://github.com/BLAKE3-team/BLAKE3/blob/master/spec/blake3.pdf
- Ed25519 Signature Scheme: https://ed25519.cr.yp.to/
- AetherCore Architecture: See `ARCHITECTURE.md`
- CodeRalphie (TPM Integration): See `coderalphie/README.md`

## Support

For issues with cross-platform identity:

1. Run test suite: `cd tests/cross-platform && npm test`
2. Check test vector output
3. Verify BLAKE3 installation
4. Compare hex strings character-by-character
5. Open issue with test results

## License

MIT License - See LICENSE file
