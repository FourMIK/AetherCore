# AetherCore Firmware

This directory contains firmware implementations for hardware-rooted identity on embedded platforms.

## Structure

### `ralphie_esp32/`
Arduino/ESP32 firmware for CodeRalphie hardware identity implementation.

**Files:**
- `main.ino` - Main sketch with identity protocol demonstration
- `identity.h` - Identity protocol header (inline implementation)
- `identity.cpp` - Identity protocol implementation file
- `BLAKE3_INTEGRATION.md` - Guide for integrating BLAKE3 library
- `README.md` - Detailed firmware documentation

**Platform:** ESP32, Arduino-compatible MCUs
**Language:** C++
**Protocol:** AetherCore Identity Protocol v1.0

## Protocol Compliance

All firmware implementations MUST produce identical genesis hashes as the TypeScript reference implementation.

**Test Vector:**
```
Hardware ID: AA:BB:CC:DD:EE:FF
Public Key:  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Salt:        test-salt-12345
Expected:    5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e
```

See `PROTOCOL_ALIGNMENT_REPORT.md` in the repository root for verification status.

## Building and Testing

### Prerequisites
- Arduino IDE or PlatformIO
- BLAKE3 C library (see `ralphie_esp32/BLAKE3_INTEGRATION.md`)
- ESP32 board support (if using ESP32)

### Upload
1. Open `ralphie_esp32/main.ino` in Arduino IDE
2. Select your board (ESP32, Arduino, etc.)
3. Compile and upload
4. Open Serial Monitor at 115200 baud
5. Verify genesis hash matches expected value

### Cross-Platform Verification
The firmware includes test vectors that match the TypeScript implementation. When you run the sketch, it will:
1. Generate a genesis hash using test inputs
2. Compare with expected hash from TypeScript
3. Report PASS or FAIL

**If the test fails, the cross-platform protocol is broken and must be fixed immediately.**

## Adding New Platforms

To add support for a new embedded platform:

1. Create a new directory: `firmware/<platform_name>/`
2. Implement identity protocol following `ralphie_esp32` structure
3. Use same concatenation order: `hardware_id + public_key + salt`
4. Use BLAKE3 hash algorithm
5. Output lowercase hex (64 characters)
6. Add test vectors from `tests/vectors.json`
7. Verify genesis hash matches TypeScript implementation

## Security Notes

- This firmware uses BLAKE3 for cryptographic hashing (SHA-256 is prohibited)
- Private keys MUST be stored in TPM/Secure Enclave, never in system memory
- Ed25519 is the required signing algorithm
- All implementations must use UTF-8 encoding
- Genesis hash is hardware-binding and immutable

## Related Documentation

- `/PROTOCOL_ALIGNMENT_REPORT.md` - Cross-platform verification status
- `/tests/vectors.json` - Canonical test vectors
- `/packages/shared/src/protocol.ts` - TypeScript reference implementation
- `/tests/cross-platform/identity.test.ts` - Cross-platform test suite
