package com.aethercore.atak.trustoverlay.identity

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope

/**
 * Pure identity extraction from CoT events.
 * 
 * Design Principles:
 * - Zero Android dependencies
 * - Pure function - no side effects
 * - Fail-Visible - explicit error states
 * - Testable in isolation
 */
object TrustIdentityExtractor {
    
    private const val NODE_ID_KEY = "node_id"
    private const val PUBLIC_KEY_KEY = "public_key"
    private const val PUBLIC_KEY_HEX_KEY = "public_key_hex"
    
    /**
     * Extract identity from CoT event envelope.
     * 
     * @param envelope CoT event envelope containing identity fields
     * @return Sealed result indicating extraction outcome
     */
    fun extract(envelope: CotEventEnvelope): IdentityExtractionResult {
        // Extract node ID
        val nodeId = envelope.detail[NODE_ID_KEY]?.trim()
        if (nodeId.isNullOrEmpty()) {
            return IdentityExtractionResult.IdentityMissing("Missing node_id in CoT detail")
        }

        // Extract public key (try hex format first, then raw)
        val publicKeyHex = envelope.detail[PUBLIC_KEY_HEX_KEY] 
            ?: envelope.detail[PUBLIC_KEY_KEY]
        
        if (publicKeyHex.isNullOrEmpty()) {
            return IdentityExtractionResult.IdentityMissing("Missing public_key in CoT detail")
        }

        // Parse hex to bytes
        val publicKeyBytes = try {
            hexStringToByteArray(publicKeyHex.trim())
        } catch (e: IllegalArgumentException) {
            return IdentityExtractionResult.IdentityInvalid(
                nodeId = nodeId,
                reason = "Invalid hex encoding: ${e.message}"
            )
        }

        // Validate Ed25519 key length (32 bytes)
        if (publicKeyBytes.size != 32) {
            return IdentityExtractionResult.IdentityInvalid(
                nodeId = nodeId,
                reason = "Invalid public key length: expected 32 bytes, got ${publicKeyBytes.size}"
            )
        }

        // Validate not all zeros
        if (publicKeyBytes.all { it == 0.toByte() }) {
            return IdentityExtractionResult.IdentityInvalid(
                nodeId = nodeId,
                reason = "Public key is all zeros"
            )
        }

        return IdentityExtractionResult.IdentityExtracted(
            nodeId = nodeId,
            publicKey = publicKeyBytes
        )
    }

    /**
     * Convert hex string to byte array.
     * 
     * @param hex Hex string (with or without 0x prefix)
     * @return Byte array
     * @throws IllegalArgumentException if hex is invalid
     */
    private fun hexStringToByteArray(hex: String): ByteArray {
        val cleanHex = hex.removePrefix("0x").removePrefix("0X")
        
        if (cleanHex.length % 2 != 0) {
            throw IllegalArgumentException("Hex string must have even length")
        }

        return try {
            ByteArray(cleanHex.length / 2) { i ->
                cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
        } catch (e: NumberFormatException) {
            throw IllegalArgumentException("Invalid hex character: ${e.message}")
        }
    }
}

/**
 * Sealed result type for identity extraction.
 * 
 * Fail-Visible Design:
 * - IdentityExtracted: Success with node_id and public_key
 * - IdentityMissing: CoT event lacks identity fields
 * - IdentityInvalid: Identity present but malformed
 */
sealed class IdentityExtractionResult {
    /**
     * Identity successfully extracted from CoT.
     */
    data class IdentityExtracted(
        val nodeId: String,
        val publicKey: ByteArray
    ) : IdentityExtractionResult() {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is IdentityExtracted) return false
            if (nodeId != other.nodeId) return false
            if (!publicKey.contentEquals(other.publicKey)) return false
            return true
        }

        override fun hashCode(): Int {
            var result = nodeId.hashCode()
            result = 31 * result + publicKey.contentHashCode()
            return result
        }
    }

    /**
     * Identity fields are missing from CoT.
     */
    data class IdentityMissing(
        val reason: String
    ) : IdentityExtractionResult()

    /**
     * Identity fields present but invalid (bad encoding, wrong length, etc).
     */
    data class IdentityInvalid(
        val nodeId: String,
        val reason: String
    ) : IdentityExtractionResult()
}
