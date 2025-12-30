//! Cryptographic key management

use serde::{Deserialize, Serialize};

/// Public key type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKey {
    /// Key data
    pub data: Vec<u8>,
}
