# BLAKE3 Arduino Integration Guide

This guide explains how to integrate the official BLAKE3 C library with the AetherCore Identity implementation on Arduino platforms.

## Overview

The current `embedded/arduino_satellite/identity.h` includes a placeholder BLAKE3 hash function. This MUST be replaced with the official BLAKE3 implementation before production deployment.

## Required Components

1. **BLAKE3 C Library**
   - Repository: https://github.com/BLAKE3-team/BLAKE3
   - Files needed: `blake3.c`, `blake3.h`, `blake3_dispatch.c`, `blake3_portable.c`

2. **Arduino IDE** or **PlatformIO**

## Installation Steps

### Method 1: Arduino IDE Library

```bash
# Clone BLAKE3 repository
git clone https://github.com/BLAKE3-team/BLAKE3.git

# Create Arduino library directory
mkdir -p ~/Arduino/libraries/BLAKE3

# Copy required files
cp BLAKE3/c/blake3.h ~/Arduino/libraries/BLAKE3/
cp BLAKE3/c/blake3.c ~/Arduino/libraries/BLAKE3/
cp BLAKE3/c/blake3_impl.h ~/Arduino/libraries/BLAKE3/
cp BLAKE3/c/blake3_dispatch.c ~/Arduino/libraries/BLAKE3/
cp BLAKE3/c/blake3_portable.c ~/Arduino/libraries/BLAKE3/

# Create library metadata
cat > ~/Arduino/libraries/BLAKE3/library.properties << EOF
name=BLAKE3
version=1.5.0
author=BLAKE3 Team
maintainer=BLAKE3 Team
sentence=Official BLAKE3 cryptographic hash function
paragraph=Fast, secure, and highly parallel cryptographic hash function
category=Data Processing
url=https://github.com/BLAKE3-team/BLAKE3
architectures=*
includes=blake3.h
EOF
```

### Method 2: PlatformIO

Create `platformio.ini`:

```ini
[env:arduino]
platform = atmelavr
board = uno
framework = arduino
build_flags = 
    -DBLAKE3_NO_SSE2
    -DBLAKE3_NO_SSE41
    -DBLAKE3_NO_AVX2
    -DBLAKE3_NO_AVX512
lib_deps = 
    https://github.com/BLAKE3-team/BLAKE3.git
```

## Code Integration

### Update identity.h

Replace the placeholder `blake3_hash()` function:

```cpp
// REMOVE THIS:
void blake3_hash(const char* input, size_t input_len, uint8_t* output) {
  #warning "Using placeholder hash - INSTALL BLAKE3 LIBRARY FOR PRODUCTION"
  // ...placeholder code...
}

// REPLACE WITH THIS:
#include <blake3.h>

void blake3_hash(const char* input, size_t input_len, uint8_t* output) {
  blake3_hasher hasher;
  blake3_hasher_init(&hasher);
  blake3_hasher_update(&hasher, input, input_len);
  blake3_hasher_finalize(&hasher, output, BLAKE3_OUT_LEN);
}
```

### Update identity.cpp

```cpp
#include "identity.h"
#include <blake3.h>

// All implementation is now in identity.h with real BLAKE3
```

## Compilation

### Arduino IDE

1. Open `example.ino`
2. Go to Sketch → Include Library → BLAKE3
3. Compile and upload
4. Open Serial Monitor (115200 baud)
5. Verify hash matches: `5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e`

### PlatformIO

```bash
platformio run --target upload
platformio device monitor
```

## Memory Requirements

BLAKE3 requires approximately:
- **Flash**: ~8KB (code)
- **RAM**: ~1.7KB (hasher state)

### Supported Boards

✓ **Working**:
- Arduino Mega 2560 (8KB SRAM)
- ESP32 (520KB SRAM)
- ESP8266 (80KB SRAM)
- Teensy 3.x/4.x (64KB+ SRAM)
- STM32 (20KB+ SRAM)

⚠️ **Limited**:
- Arduino Uno (2KB SRAM) - Tight, but possible with optimization
- Arduino Nano (2KB SRAM) - Tight, but possible with optimization

✗ **Not Recommended**:
- ATtiny85 (512 bytes SRAM) - Insufficient memory

## Optimization for Low-Memory Boards

For Arduino Uno/Nano with limited RAM:

```cpp
// Use stack allocation carefully
void createIdentityBlock(
  const char* hardware_id,
  const char* public_key,
  const char* salt,
  PlatformType platform_type,
  IdentityBlock* block
) {
  // Process in chunks if needed
  blake3_hasher hasher;
  blake3_hasher_init(&hasher);
  
  // Update piece by piece to avoid large string concatenation
  blake3_hasher_update(&hasher, hardware_id, strlen(hardware_id));
  blake3_hasher_update(&hasher, public_key, strlen(public_key));
  blake3_hasher_update(&hasher, salt, strlen(salt));
  
  uint8_t hash_bytes[32];
  blake3_hasher_finalize(&hasher, hash_bytes, BLAKE3_OUT_LEN);
  
  bytesToHex(hash_bytes, 32, block->genesis_hash);
}
```

## Verification

After integration, run the example sketch and verify output:

```
Expected: 5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e
Actual:   [hash from Arduino]
```

If they match: ✓ Cross-platform protocol is VALID
If they don't: ✗ CRITICAL - Check BLAKE3 integration

## Troubleshooting

### Compilation Errors

**Error**: `blake3.h: No such file or directory`
- **Fix**: Ensure BLAKE3 library is installed in Arduino libraries folder

**Error**: `multiple definition of blake3_compress_in_place`
- **Fix**: Only include blake3.h once, in a single .cpp file

**Error**: `undefined reference to blake3_hasher_init`
- **Fix**: Make sure blake3.c is being compiled

### Runtime Issues

**Problem**: Sketch crashes or resets
- **Cause**: Stack overflow due to low memory
- **Fix**: Use chunk-based processing (see optimization above)

**Problem**: Hash doesn't match expected
- **Causes**:
  1. Incorrect concatenation order
  2. String encoding issues (newlines, null terminators)
  3. Different BLAKE3 version
- **Fix**: Verify inputs byte-by-byte, use Serial.print() to debug

### Memory Issues

**Problem**: Out of RAM
- **Fix Options**:
  1. Use PROGMEM for constant strings
  2. Process input in chunks
  3. Upgrade to board with more RAM (ESP32, Mega)

## Testing Checklist

- [ ] BLAKE3 library compiles without errors
- [ ] Example sketch uploads successfully
- [ ] Serial output shows identity block
- [ ] Genesis hash matches test vector
- [ ] Hash is deterministic (same inputs → same hash)
- [ ] Verification returns true for valid block
- [ ] Memory usage is acceptable (< 80% RAM)
- [ ] No stack overflows or crashes

## Production Deployment

Before deploying to field:

1. ✓ Real BLAKE3 (not placeholder)
2. ✓ Hash verification passed
3. ✓ Memory tested under load
4. ✓ Integrated with TPM/Secure Element if available
5. ✓ Private keys stored securely (not in code)
6. ✓ Identity persisted to EEPROM/Flash
7. ✓ Revocation mechanism implemented

## Security Notes

⚠️ **CRITICAL**: Even with real BLAKE3:

1. **Key Generation**: Must use hardware RNG, not `rand()`
2. **Key Storage**: Private keys in secure element, never in SRAM
3. **Attestation**: Bind to hardware (TPM, ATECC608A, etc.)
4. **Signing**: Ed25519 via hardware, not software

For production-grade security, see:
- `coderalphie/` - TPM integration
- `crates/identity/src/tpm.rs` - Hardware-backed identity

## Resources

- BLAKE3 Specification: https://github.com/BLAKE3-team/BLAKE3/blob/master/spec/blake3.pdf
- Arduino Memory Guide: https://docs.arduino.cc/learn/programming/memory-guide
- AetherCore Identity Protocol: `docs/IDENTITY_CROSS_PLATFORM.md`
- Cross-Platform Tests: `tests/cross-platform/identity.test.ts`

## Support

Issues with BLAKE3 integration:
1. Verify hash with online calculator: https://connor4312.github.io/blake3/index.html
2. Compare with TypeScript output
3. Check memory usage with Serial.print(freeMemory())
4. Open issue with compilation output and Serial logs
