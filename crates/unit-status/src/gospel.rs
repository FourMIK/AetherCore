//! Great Gospel: Sovereign Revocation Ledger
//!
//! The single source of truth for revoked nodes in the AetherCore mesh.
//! Implements the Aetheric Sweep protocol for Byzantine node purging.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

/// Revocation reason enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RevocationReason {
    /// TPM attestation verification failed
    AttestationFailure,

    /// Byzantine behavior detected (root drift, chain breaks)
    ByzantineDetection,

    /// Manual operator intervention
    OperatorOverride,

    /// Duplicate NodeIDs or clock-drift anomalies
    IdentityCollapse,
}

/// Revocation certificate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevocationCertificate {
    /// Node being revoked
    pub node_id: String,

    /// Reason for revocation
    pub revocation_reason: RevocationReason,

    /// Authority that issued the revocation
    pub issuer_id: String,

    /// Timestamp in nanoseconds since epoch
    pub timestamp_ns: u64,

    /// Ed25519 signature from Federation Authority (hex-encoded)
    pub signature: String,

    /// BLAKE3 root of ledger state after this revocation (hex-encoded)
    pub merkle_root: String,
}

/// Gospel ledger state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GospelState {
    /// All revoked nodes
    pub revoked_nodes: HashMap<String, RevocationCertificate>,

    /// Current Merkle root (BLAKE3)
    pub current_root: [u8; 32],

    /// Last update timestamp
    pub last_updated_ns: u64,
}

impl Default for GospelState {
    fn default() -> Self {
        Self {
            revoked_nodes: HashMap::new(),
            current_root: [0u8; 32],
            last_updated_ns: 0,
        }
    }
}

/// Gospel ledger errors
#[derive(Debug, Error)]
pub enum GospelError {
    /// Node already present in ledger
    #[error("Node already revoked: {0}")]
    NodeAlreadyRevoked(String),

    /// Signature failed verification
    #[error("Invalid signature")]
    InvalidSignature,

    /// Merkle root does not match computed state
    #[error("Merkle root mismatch")]
    MerkleRootMismatch,

    /// Certificate timestamp is outside allowed skew
    #[error("Timestamp invalid (clock skew)")]
    InvalidTimestamp,
}

/// Great Gospel ledger
pub struct GospelLedger {
    /// Current ledger state
    state: Arc<RwLock<GospelState>>,

    /// Trusted Federation root public key used for cert signature verification.
    federation_root_key: Option<VerifyingKey>,
}

impl GospelLedger {
    /// Create new Gospel ledger
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(GospelState::default())),
            federation_root_key: Self::load_trusted_federation_root_key(),
        }
    }

    /// Create ledger with explicitly provided trusted root key.
    ///
    /// Useful for tests and controlled bootstrapping flows.
    pub fn new_with_trusted_root_key(federation_root_key: VerifyingKey) -> Self {
        Self {
            state: Arc::new(RwLock::new(GospelState::default())),
            federation_root_key: Some(federation_root_key),
        }
    }

    /// Add revocation certificate to ledger
    ///
    /// # Security
    /// This function MUST verify the Ed25519 signature before accepting the certificate.
    /// Current implementation has signature verification disabled for development/testing.
    /// **DO NOT deploy to production without implementing proper signature verification.**
    pub async fn add_revocation(&self, cert: RevocationCertificate) -> Result<(), GospelError> {
        self.verify_signature(&cert)?;

        let mut state = self.state.write().await;

        // Check if node is already revoked
        if state.revoked_nodes.contains_key(&cert.node_id) {
            return Err(GospelError::NodeAlreadyRevoked(cert.node_id.clone()));
        }

        // Validate timestamp (allow ±5 seconds clock skew)
        let current_time = Self::current_timestamp_ns();
        let time_diff = if current_time > cert.timestamp_ns {
            current_time - cert.timestamp_ns
        } else {
            cert.timestamp_ns - current_time
        };

        if time_diff > 5_000_000_000 {
            // More than 5 seconds skew
            return Err(GospelError::InvalidTimestamp);
        }

        // Compute new Merkle root
        let new_root = self.compute_merkle_root(&state, &cert);
        let new_root_hex = hex::encode(new_root);

        // Verify Merkle root matches certificate
        if new_root_hex != cert.merkle_root {
            return Err(GospelError::MerkleRootMismatch);
        }

        // Add to ledger
        state
            .revoked_nodes
            .insert(cert.node_id.clone(), cert.clone());
        state.current_root = new_root;
        state.last_updated_ns = cert.timestamp_ns;

        Ok(())
    }

    /// Verify revocation certificate signature against trusted federation root key.
    fn verify_signature(&self, cert: &RevocationCertificate) -> Result<(), GospelError> {
        let Some(public_key) = &self.federation_root_key else {
            return Err(GospelError::InvalidSignature);
        };

        let signature_bytes = Self::decode_signature(&cert.signature)?;
        let signature =
            Signature::from_slice(&signature_bytes).map_err(|_| GospelError::InvalidSignature)?;

        let message = Self::signature_message(cert);
        public_key
            .verify(&message, &signature)
            .map_err(|_| GospelError::InvalidSignature)
    }

    fn decode_signature(signature: &str) -> Result<[u8; 64], GospelError> {
        let decoded = hex::decode(signature)
            .or_else(|_| base64::engine::general_purpose::STANDARD.decode(signature))
            .map_err(|_| GospelError::InvalidSignature)?;

        decoded
            .try_into()
            .map_err(|_| GospelError::InvalidSignature)
    }

    /// Deterministic signed payload builder.
    fn signature_message(cert: &RevocationCertificate) -> Vec<u8> {
        format!(
            "node_id={}\nrevocation_reason={}\nissuer_id={}\ntimestamp_ns={}",
            cert.node_id,
            cert.revocation_reason.as_signing_tag(),
            cert.issuer_id,
            cert.timestamp_ns,
        )
        .into_bytes()
    }

    /// Load trusted root key from config/secure storage.
    ///
    /// Resolution order:
    /// 1) `AETHERCORE_FEDERATION_ROOT_PUBKEY_HEX` as hex-encoded 32-byte Ed25519 public key.
    /// 2) `AETHERCORE_FEDERATION_ROOT_PUBKEY_PATH` path to a file containing either hex or base64 key.
    fn load_trusted_federation_root_key() -> Option<VerifyingKey> {
        if let Ok(pubkey_hex) = std::env::var("AETHERCORE_FEDERATION_ROOT_PUBKEY_HEX") {
            return Self::decode_verifying_key(pubkey_hex.trim());
        }

        if let Ok(path) = std::env::var("AETHERCORE_FEDERATION_ROOT_PUBKEY_PATH") {
            let file_contents = fs::read_to_string(path).ok()?;
            return Self::decode_verifying_key(file_contents.trim());
        }

        None
    }

    fn decode_verifying_key(encoded: &str) -> Option<VerifyingKey> {
        let bytes = hex::decode(encoded)
            .or_else(|_| base64::engine::general_purpose::STANDARD.decode(encoded))
            .ok()?;

        let arr: [u8; 32] = bytes.try_into().ok()?;
        VerifyingKey::from_bytes(&arr).ok()
    }

    /// Check if node is revoked
    pub async fn is_revoked(&self, node_id: &str) -> bool {
        let state = self.state.read().await;
        state.revoked_nodes.contains_key(node_id)
    }

    /// Get revocation certificate for node
    pub async fn get_revocation(&self, node_id: &str) -> Option<RevocationCertificate> {
        let state = self.state.read().await;
        state.revoked_nodes.get(node_id).cloned()
    }

    /// Get all revoked nodes
    pub async fn get_all_revocations(&self) -> HashMap<String, RevocationCertificate> {
        let state = self.state.read().await;
        state.revoked_nodes.clone()
    }

    /// Get current Gospel state
    pub async fn get_state(&self) -> GospelState {
        let state = self.state.read().await;
        state.clone()
    }

    /// Compute Merkle root after adding a revocation
    fn compute_merkle_root(
        &self,
        state: &GospelState,
        new_cert: &RevocationCertificate,
    ) -> [u8; 32] {
        // Collect all node IDs (sorted for determinism)
        let mut node_ids: Vec<String> = state.revoked_nodes.keys().cloned().collect();
        node_ids.push(new_cert.node_id.clone());
        node_ids.sort();

        // Hash each node ID with BLAKE3
        let mut hashes: Vec<[u8; 32]> = node_ids
            .iter()
            .map(|id| *blake3::hash(id.as_bytes()).as_bytes())
            .collect();

        // Build Merkle tree (simple binary tree)
        while hashes.len() > 1 {
            let mut next_level = Vec::new();

            for chunk in hashes.chunks(2) {
                if chunk.len() == 2 {
                    // Hash pair
                    let mut combined = Vec::new();
                    combined.extend_from_slice(&chunk[0]);
                    combined.extend_from_slice(&chunk[1]);
                    next_level.push(*blake3::hash(&combined).as_bytes());
                } else {
                    // Odd node, promote to next level
                    next_level.push(chunk[0]);
                }
            }

            hashes = next_level;
        }

        hashes.first().copied().unwrap_or([0u8; 32])
    }

    /// Get current timestamp in nanoseconds
    fn current_timestamp_ns() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("System time before Unix epoch")
            .as_nanos() as u64
    }
}

impl Default for GospelLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl RevocationReason {
    fn as_signing_tag(&self) -> &'static str {
        match self {
            Self::AttestationFailure => "AttestationFailure",
            Self::ByzantineDetection => "ByzantineDetection",
            Self::OperatorOverride => "OperatorOverride",
            Self::IdentityCollapse => "IdentityCollapse",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::RngCore;

    fn random_signing_key() -> SigningKey {
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        SigningKey::from_bytes(&secret)
    }

    fn create_test_cert(
        node_id: &str,
        signing_key: &SigningKey,
        reason: RevocationReason,
    ) -> RevocationCertificate {
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let state = GospelState::default();

        let mut temp_cert = RevocationCertificate {
            node_id: node_id.to_string(),
            revocation_reason: reason,
            issuer_id: "test-authority".to_string(),
            timestamp_ns: GospelLedger::current_timestamp_ns(),
            signature: String::new(),
            merkle_root: String::new(), // Will be computed
        };

        let payload = GospelLedger::signature_message(&temp_cert);
        let signature = signing_key.sign(&payload);
        temp_cert.signature = hex::encode(signature.to_bytes());

        let root = ledger.compute_merkle_root(&state, &temp_cert);
        temp_cert.merkle_root = hex::encode(root);

        temp_cert
    }

    #[tokio::test]
    async fn test_gospel_ledger_creation() {
        let ledger = GospelLedger::new();
        let state = ledger.get_state().await;

        assert_eq!(state.revoked_nodes.len(), 0);
        assert_eq!(state.current_root, [0u8; 32]);
    }

    #[tokio::test]
    async fn test_add_revocation() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert = create_test_cert("node-1", &signing_key, RevocationReason::OperatorOverride);

        // Add revocation
        let result = ledger.add_revocation(cert).await;
        assert!(result.is_ok());

        // Verify node is revoked
        assert!(ledger.is_revoked("node-1").await);
    }

    #[tokio::test]
    async fn test_duplicate_revocation() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert1 = create_test_cert("node-1", &signing_key, RevocationReason::OperatorOverride);

        // Add first revocation
        ledger.add_revocation(cert1.clone()).await.unwrap();

        // Try to add duplicate
        let result = ledger.add_revocation(cert1).await;
        assert!(matches!(result, Err(GospelError::NodeAlreadyRevoked(_))));
    }

    #[tokio::test]
    async fn test_get_revocation() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert = create_test_cert("node-1", &signing_key, RevocationReason::ByzantineDetection);

        // Add revocation
        ledger.add_revocation(cert.clone()).await.unwrap();

        // Retrieve revocation
        let retrieved = ledger.get_revocation("node-1").await;
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.node_id, "node-1");
        assert_eq!(
            retrieved.revocation_reason,
            RevocationReason::ByzantineDetection
        );
    }

    #[tokio::test]
    async fn test_merkle_root_computation() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert1 = create_test_cert("node-1", &signing_key, RevocationReason::OperatorOverride);
        let root1 = cert1.merkle_root.clone();

        ledger.add_revocation(cert1).await.unwrap();

        // Add second node
        let mut cert2 =
            create_test_cert("node-2", &signing_key, RevocationReason::OperatorOverride);
        let current_state = ledger.get_state().await;
        let root2_expected = ledger.compute_merkle_root(&current_state, &cert2);
        cert2.merkle_root = hex::encode(root2_expected);
        let root2 = cert2.merkle_root.clone();

        ledger.add_revocation(cert2).await.unwrap();

        // Roots should be different
        assert_ne!(root1, root2);

        // Final state should have root2
        let final_state = ledger.get_state().await;
        assert_eq!(hex::encode(final_state.current_root), root2);
    }

    #[tokio::test]
    async fn test_valid_signature_accepted() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert = create_test_cert(
            "node-valid",
            &signing_key,
            RevocationReason::OperatorOverride,
        );

        let result = ledger.add_revocation(cert).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_invalid_signature_rejected() {
        let signing_key = random_signing_key();
        let other_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let cert = create_test_cert(
            "node-invalid-signature",
            &other_key,
            RevocationReason::OperatorOverride,
        );

        let result = ledger.add_revocation(cert).await;
        assert!(matches!(result, Err(GospelError::InvalidSignature)));
    }

    #[tokio::test]
    async fn test_tampered_field_rejected_even_with_matching_merkle_root() {
        let signing_key = random_signing_key();
        let ledger = GospelLedger::new_with_trusted_root_key(signing_key.verifying_key());
        let mut cert = create_test_cert(
            "node-tamper",
            &signing_key,
            RevocationReason::OperatorOverride,
        );

        cert.revocation_reason = RevocationReason::ByzantineDetection;
        // Keep merkle root unchanged and still valid for this state transition;
        // signature must fail due to tampered signed field.

        let result = ledger.add_revocation(cert).await;
        assert!(matches!(result, Err(GospelError::InvalidSignature)));
    }
}
