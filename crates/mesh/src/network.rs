//! Network mesh types

use serde::{Deserialize, Serialize};

/// Node in the mesh network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    /// Node ID
    pub id: String,
}
