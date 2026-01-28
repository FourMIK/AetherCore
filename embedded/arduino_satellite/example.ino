/**
 * AetherCore Identity Example for Arduino
 * 
 * This sketch demonstrates how to use the AetherCore Identity Protocol
 * on Arduino/embedded platforms.
 * 
 * EXPECTED OUTPUT:
 * When using the test vector:
 *   Hardware ID: AA:BB:CC:DD:EE:FF
 *   Public Key: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *   Salt: test-salt-12345
 * 
 * Expected Genesis Hash (from TypeScript reference):
 *   5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e
 * 
 * VERIFICATION:
 * The genesis_hash output from this sketch MUST match the expected hash above.
 * If it doesn't match, the cross-platform protocol is broken.
 */

#include "identity.h"

// Test vector - these values match the TypeScript tests
const char* TEST_HARDWARE_ID = "AA:BB:CC:DD:EE:FF";
const char* TEST_PUBLIC_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const char* TEST_SALT = "test-salt-12345";

// Expected hash from TypeScript implementation
const char* EXPECTED_HASH = "5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e";

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ; // Wait for serial port to connect
  }
  
  Serial.println("=== AetherCore Identity Protocol Test ===");
  Serial.println("Platform: Arduino (MCU)");
  Serial.println();
  
  // Create identity block with test vector
  IdentityBlock block;
  createIdentityBlock(
    TEST_HARDWARE_ID,
    TEST_PUBLIC_KEY,
    TEST_SALT,
    MCU,
    &block
  );
  
  // Print identity block
  printIdentityBlock(&block);
  
  // Verify
  bool valid = verifyIdentityBlock(&block, TEST_SALT);
  Serial.println();
  Serial.print("Self-Verification: ");
  Serial.println(valid ? "PASSED" : "FAILED");
  
  // Cross-platform verification
  Serial.println();
  Serial.println("=== Cross-Platform Verification ===");
  Serial.print("Generated Hash: ");
  Serial.println(block.genesis_hash);
  Serial.print("Expected Hash:  ");
  Serial.println(EXPECTED_HASH);
  
  bool crossPlatformValid = (strcmp(block.genesis_hash, EXPECTED_HASH) == 0);
  Serial.print("Status: ");
  if (crossPlatformValid) {
    Serial.println("✓ PASS - Hashes match!");
    Serial.println("Cross-platform identity protocol is VALID");
  } else {
    Serial.println("✗ FAIL - Hashes DO NOT match!");
    Serial.println("CRITICAL: Cross-platform protocol is BROKEN");
    Serial.println("Action required: Check BLAKE3 implementation");
  }
  
  Serial.println();
  Serial.println("=== Test Complete ===");
}

void loop() {
  // Nothing to do in loop
  delay(1000);
}
