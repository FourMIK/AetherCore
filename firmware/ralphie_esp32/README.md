# AetherCore Arduino Identity Implementation

This directory contains the Arduino/embedded implementation of the AetherCore Identity Protocol.

## Protocol Invariant

The genesis hash MUST be computed identically across all platforms:

```
genesis_hash = BLAKE3(hardware_id + public_key + salt)
```

## Files

- `identity.h` - Header file with protocol definitions and inline implementations
- `identity.cpp` - Implementation file (minimal, most code is in header)

## Installation

### Prerequisites

1. **BLAKE3 C Library**
   - Download from: https://github.com/BLAKE3-team/BLAKE3
   - Copy `blake3.c` and `blake3.h` to your Arduino libraries folder
   - Or use as a header-only library

2. **Arduino IDE or PlatformIO**

### Integration

```cpp
#include "identity.h"

void setup() {
  Serial.begin(115200);
  
  // Create identity block
  IdentityBlock block;
  createIdentityBlock(
    "AA:BB:CC:DD:EE:FF",  // MAC address
    "abcd1234...",         // Ed25519 public key (64 hex chars)
    "test-salt",           // Salt
    MCU,                   // Platform type
    &block
  );
  
  // Print for verification
  printIdentityBlock(&block);
  
  // Verify
  bool valid = verifyIdentityBlock(&block, "test-salt");
  Serial.print("Valid: ");
  Serial.println(valid ? "true" : "false");
}

void loop() {
  // Your code here
}
```

## Testing

Cross-platform compatibility is verified in:
- `tests/cross-platform/identity.test.ts`

This test ensures that C++ (Arduino) and TypeScript (Node/Pi) produce identical genesis hashes for the same inputs.

## Security Notes

⚠️ **WARNING**: The current implementation includes a placeholder hash function for testing.

**PRODUCTION DEPLOYMENT REQUIRES:**
1. Real BLAKE3 library integration
2. Hardware-backed key generation (TPM, Secure Enclave)
3. Secure storage of private keys (never in system memory)
4. Ed25519 signature verification

## Platform Support

- Arduino Uno, Mega, Leonardo
- ESP32, ESP8266
- Teensy
- STM32
- Any Arduino-compatible MCU with sufficient memory (requires ~2KB RAM for BLAKE3)
