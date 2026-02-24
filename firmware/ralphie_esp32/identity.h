/**
 * AetherCore Identity Protocol - Arduino Implementation
 * 
 * This implementation MUST produce identical genesis hashes as the TypeScript version.
 * Platform: Arduino (MCU)
 * 
 * REQUIREMENTS:
 * - BLAKE3 library for Arduino (https://github.com/BLAKE3-team/BLAKE3)
 * - Ed25519 support (optional for key generation, assume key provided)
 * 
 * PROTOCOL INVARIANT:
 * genesis_hash = BLAKE3(hardware_id + public_key + salt)
 */

#ifndef AETHERCORE_IDENTITY_H
#define AETHERCORE_IDENTITY_H

#include <Arduino.h>

// BLAKE3 C library integration
#include "blake3.h"

/**
 * Platform types
 */
enum PlatformType {
  MCU,  // Microcontroller Unit (Arduino, ESP32, etc.)
  SBC   // Single Board Computer (Raspberry Pi, etc.)
};

/**
 * Identity Block structure
 * 
 * This MUST match the TypeScript IdentityBlock interface exactly.
 */
struct IdentityBlock {
  char hardware_id[18];      // MAC address format: "XX:XX:XX:XX:XX:XX" + null terminator
  char public_key[65];       // Ed25519 public key (32 bytes = 64 hex chars) + null terminator
  char genesis_hash[65];     // BLAKE3 hash (32 bytes = 64 hex chars) + null terminator
  PlatformType platform_type;
};

/**
 * Convert byte array to hex string
 * 
 * @param data Byte array
 * @param len Length of byte array
 * @param hex_out Output buffer (must be at least len*2+1 bytes)
 */
void bytesToHex(const uint8_t* data, size_t len, char* hex_out) {
  const char hex_chars[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    hex_out[i * 2] = hex_chars[(data[i] >> 4) & 0x0F];
    hex_out[i * 2 + 1] = hex_chars[data[i] & 0x0F];
  }
  hex_out[len * 2] = '\0';
}

/**
 * BLAKE3 Hash Wrapper
 * 
 * Production implementation using official BLAKE3 C library.
 * 
 * @param input Input string to hash
 * @param input_len Length of input
 * @param output Output buffer (32 bytes)
 */
void blake3_hash(const char* input, size_t input_len, uint8_t* output) {
  blake3_hasher hasher;
  blake3_hasher_init(&hasher);
  blake3_hasher_update(&hasher, input, input_len);
  blake3_hasher_finalize(&hasher, output, BLAKE3_OUT_LEN);
}

/**
 * Generate Genesis Hash
 * 
 * CRITICAL: This function MUST produce identical output to the TypeScript version.
 * 
 * Protocol: genesis_hash = BLAKE3(hardware_id + public_key + salt)
 * 
 * @param hardware_id MAC address string
 * @param public_key Ed25519 public key (hex string)
 * @param salt Random salt string
 * @param genesis_hash_out Output buffer (65 chars: 64 hex + null terminator)
 */
void generateGenesisHash(
  const char* hardware_id,
  const char* public_key,
  const char* salt,
  char* genesis_hash_out
) {
  // Concatenate inputs in canonical order
  String preimage = String(hardware_id) + String(public_key) + String(salt);
  
  // Hash with BLAKE3
  uint8_t hash_bytes[32];
  blake3_hash(preimage.c_str(), preimage.length(), hash_bytes);
  
  // Convert to hex string
  bytesToHex(hash_bytes, 32, genesis_hash_out);
}

/**
 * Create Identity Block
 * 
 * @param hardware_id MAC address
 * @param public_key Ed25519 public key (hex)
 * @param salt Salt for genesis hash
 * @param platform_type MCU or SBC
 * @param block Output identity block
 */
void createIdentityBlock(
  const char* hardware_id,
  const char* public_key,
  const char* salt,
  PlatformType platform_type,
  IdentityBlock* block
) {
  // Copy hardware_id
  strncpy(block->hardware_id, hardware_id, 17);
  block->hardware_id[17] = '\0';
  
  // Copy public_key
  strncpy(block->public_key, public_key, 64);
  block->public_key[64] = '\0';
  
  // Generate genesis hash
  generateGenesisHash(hardware_id, public_key, salt, block->genesis_hash);
  
  // Set platform type
  block->platform_type = platform_type;
}

/**
 * Verify Identity Block
 * 
 * @param block Identity block to verify
 * @param salt Original salt
 * @return true if genesis_hash is valid
 */
bool verifyIdentityBlock(const IdentityBlock* block, const char* salt) {
  char expected_hash[65];
  generateGenesisHash(block->hardware_id, block->public_key, salt, expected_hash);
  
  return strcmp(block->genesis_hash, expected_hash) == 0;
}

/**
 * Print Identity Block (for debugging)
 */
void printIdentityBlock(const IdentityBlock* block) {
  Serial.println("=== Identity Block ===");
  Serial.print("Hardware ID: ");
  Serial.println(block->hardware_id);
  Serial.print("Public Key: ");
  Serial.println(block->public_key);
  Serial.print("Genesis Hash: ");
  Serial.println(block->genesis_hash);
  Serial.print("Platform Type: ");
  Serial.println(block->platform_type == MCU ? "MCU" : "SBC");
  Serial.println("======================");
}

#endif // AETHERCORE_IDENTITY_H
