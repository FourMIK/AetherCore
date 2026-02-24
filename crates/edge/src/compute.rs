//! Edge computing types

use serde::{Deserialize, Serialize};

/// Edge node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeNode {
    /// Node ID
    pub id: String,
}

impl EdgeNode {
    /// Create a new edge node
    pub fn new(id: String) -> Self {
        tracing::info!(node_id = %id, "Creating edge node");
        Self { id }
    }
}
