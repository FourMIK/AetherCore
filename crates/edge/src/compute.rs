//! Edge computing types

use serde::{Deserialize, Serialize};

/// Edge node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeNode {
    /// Node ID
    pub id: String,
}
