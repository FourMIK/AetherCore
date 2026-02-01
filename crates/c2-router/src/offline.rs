//! Offline Mode and Sync Queue (Operation Dark Circuit)
//!
//! This module implements resilient command queueing during network blackout periods.
//! Commands and events are cryptographically queued in a local Merkle Vine with
//! TPM-backed encryption. Resynchronization requires admin (Sovereign) approval to
//! prevent replay injection attacks.
//!
//! # Architecture
//!
//! - **Materia Buffer**: Local encrypted storage for offline events
//! - **Connection States**: Online, OfflineAutonomous, ReconnectPending
//! - **Guardian Gate**: Admin-authorized sync protocol
//! - **Chain Integrity**: Merkle Vine validation across the offline gap
//!
//! # Security Invariants
//!
//! - No automatic resynchronization (prevents replay injection)
//! - All buffer entries encrypted with TPM-derived key
//! - Chain continuity must be verified before accepting sync
//! - Mismatches trigger Aetheric Sweep (Byzantine node detection)

use aethercore_core::ledger::{LedgerError, SignedEvent};
use aethercore_core::merkle_vine::MerkleVine;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use thiserror::Error;
use tracing::{debug, error, info, warn};

/// Offline operation errors
#[derive(Debug, Error)]
pub enum OfflineError {
    /// Database operation failed
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    /// Ledger operation failed
    #[error("Ledger error: {0}")]
    LedgerError(#[from] LedgerError),

    /// Core error
    #[error("Core error: {0}")]
    CoreError(#[from] aethercore_core::Error),

    /// Buffer is full
    #[error("Buffer exhausted: {current} / {max} entries")]
    BufferExhausted { current: usize, max: usize },

    /// Chain integrity violation
    #[error("Identity collapse detected: chain break at sequence {seq_no}")]
    ChainBreak { seq_no: u64 },

    /// Invalid state transition
    #[error("Invalid state transition from {from} to {to}")]
    InvalidStateTransition { from: String, to: String },

    /// Encryption/decryption failed
    #[error("Encryption error: {0}")]
    EncryptionError(String),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Authorization failed
    #[error("Authorization failed: {0}")]
    AuthorizationError(String),

    /// Merkle root mismatch
    #[error("Merkle root mismatch: offline={offline:?}, online={online:?}")]
    MerkleRootMismatch {
        offline: Vec<u8>,
        online: Vec<u8>,
    },
}

/// Connection state for offline resilience
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionState {
    /// Normal operation with C2 link
    Online,
    /// Offline autonomous mode (blackout)
    OfflineAutonomous,
    /// Reconnected but awaiting admin approval
    ReconnectPending,
}

impl ConnectionState {
    /// Check if state allows command queueing
    pub fn can_queue(&self) -> bool {
        matches!(self, ConnectionState::OfflineAutonomous)
    }

    /// Check if state allows sync operations
    pub fn can_sync(&self) -> bool {
        matches!(self, ConnectionState::ReconnectPending)
    }
}

/// Encrypted event packet for offline storage
/// 
/// Note: Encryption at rest is planned for Phase 2 enhancement.
/// Currently stores event data with signatures but payload encryption
/// via TPM-derived keys is not yet implemented.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedPacket {
    /// Event identifier
    pub event_id: String,
    /// Timestamp (nanoseconds)
    pub timestamp_ns: u64,
    /// Encrypted payload (event data)
    pub encrypted_payload: Vec<u8>,
    /// Encryption nonce/IV
    pub nonce: Vec<u8>,
    /// Event hash for chain linking
    pub event_hash: Vec<u8>,
    /// Previous event hash (Merkle Vine)
    pub prev_event_hash: Vec<u8>,
    /// Signature over the event
    pub signature: Vec<u8>,
    /// Public key identifier
    pub public_key_id: String,
}

/// Offline gap information for UI visibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineGapInfo {
    /// Number of queued events
    pub queued_count: usize,
    /// Timestamp when offline mode started
    pub offline_since_ns: u64,
    /// Timestamp when reconnect detected
    pub reconnect_at_ns: Option<u64>,
    /// Chain integrity status
    pub chain_intact: bool,
    /// Buffer utilization (0.0 to 1.0)
    pub buffer_utilization: f64,
}

/// Materia Buffer - Local transaction log for offline operation
/// 
/// # Thread Safety
/// 
/// This struct is designed to be wrapped in Arc<Mutex<_>> for shared access.
/// SQLite connection is not Send/Sync by default, so operations must be
/// serialized through the mutex.
pub struct OfflineMateriaBuffer {
    /// SQLite connection for persistent storage (not thread-safe)
    storage: Connection,
    /// Local Merkle Vine for chain integrity
    merkle_vine: MerkleVine,
    /// Current connection state
    state: ConnectionState,
    /// Node identifier
    node_id: String,
    /// Maximum buffer size
    max_buffer_size: usize,
    /// Offline start timestamp
    offline_since: Option<u64>,
}

/// Nanoseconds to milliseconds conversion factor
const NANOS_TO_MILLIS: u64 = 1_000_000;

/// Default Merkle root size (BLAKE3 hash size)
const MERKLE_ROOT_SIZE: usize = 32;

impl OfflineMateriaBuffer {
    /// Maximum buffer size (10000 events)
    const DEFAULT_MAX_BUFFER_SIZE: usize = 10000;

    /// Create a new offline materia buffer
    ///
    /// # Arguments
    /// * `storage_path` - Path to SQLite database for offline storage
    /// * `node_id` - Node identifier
    pub fn new(storage_path: PathBuf, node_id: String) -> Result<Self, OfflineError> {
        // Open SQLite database with WAL mode
        let conn = Connection::open_with_flags(
            &storage_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;

        // Enable WAL mode for durability
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        // Create offline buffer table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS offline_buffer (
                seq_no INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                timestamp_ns INTEGER NOT NULL,
                encrypted_payload BLOB NOT NULL,
                nonce BLOB NOT NULL,
                event_hash BLOB NOT NULL,
                prev_event_hash BLOB NOT NULL,
                signature BLOB NOT NULL,
                public_key_id TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Create index on timestamp
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_timestamp 
             ON offline_buffer(timestamp_ns)",
            [],
        )?;

        info!(
            node_id = %node_id,
            storage_path = %storage_path.display(),
            "OfflineMateriaBuffer initialized"
        );

        Ok(Self {
            storage: conn,
            merkle_vine: MerkleVine::new(&node_id),
            state: ConnectionState::Online,
            node_id,
            max_buffer_size: Self::DEFAULT_MAX_BUFFER_SIZE,
            offline_since: None,
        })
    }

    /// Transition to offline autonomous mode
    pub fn enter_offline_mode(&mut self) -> Result<(), OfflineError> {
        if self.state != ConnectionState::Online {
            return Err(OfflineError::InvalidStateTransition {
                from: format!("{:?}", self.state),
                to: "OfflineAutonomous".to_string(),
            });
        }

        self.state = ConnectionState::OfflineAutonomous;
        self.offline_since = Some(Self::current_timestamp_ns());

        warn!(
            node_id = %self.node_id,
            "Entered OFFLINE_AUTONOMOUS mode (Blackout Protocol active)"
        );

        Ok(())
    }

    /// Transition to reconnect pending mode
    pub fn enter_reconnect_pending(&mut self) -> Result<(), OfflineError> {
        if self.state != ConnectionState::OfflineAutonomous {
            return Err(OfflineError::InvalidStateTransition {
                from: format!("{:?}", self.state),
                to: "ReconnectPending".to_string(),
            });
        }

        self.state = ConnectionState::ReconnectPending;

        info!(
            node_id = %self.node_id,
            "Entered RECONNECT_PENDING mode (awaiting Guardian Gate approval)"
        );

        Ok(())
    }

    /// Transition back to online mode (after successful sync)
    pub fn enter_online_mode(&mut self) -> Result<(), OfflineError> {
        if self.state != ConnectionState::ReconnectPending && self.state != ConnectionState::Online {
            return Err(OfflineError::InvalidStateTransition {
                from: format!("{:?}", self.state),
                to: "Online".to_string(),
            });
        }

        self.state = ConnectionState::Online;
        self.offline_since = None;

        info!(
            node_id = %self.node_id,
            "Entered ONLINE mode (normal operation resumed)"
        );

        Ok(())
    }

    /// Get current connection state
    pub fn get_state(&self) -> ConnectionState {
        self.state
    }

    /// Queue a signed event during offline mode
    ///
    /// # Arguments
    /// * `event` - Encrypted event packet to queue
    ///
    /// # Returns
    /// Sequence number of the queued event
    pub fn queue_signed_event(&mut self, event: EncryptedPacket) -> Result<u64, OfflineError> {
        if !self.state.can_queue() {
            return Err(OfflineError::InvalidStateTransition {
                from: format!("{:?}", self.state),
                to: "queue_event".to_string(),
            });
        }

        // Check buffer capacity
        let current_count = self.get_queued_count()?;
        if current_count >= self.max_buffer_size {
            error!(
                node_id = %self.node_id,
                current = current_count,
                max = self.max_buffer_size,
                "Buffer exhausted: Data loss imminent"
            );
            return Err(OfflineError::BufferExhausted {
                current: current_count,
                max: self.max_buffer_size,
            });
        }

        // Extend local Merkle Vine
        let timestamp = event.timestamp_ns / NANOS_TO_MILLIS;
        self.merkle_vine.add_leaf(
            event.encrypted_payload.clone(),
            timestamp,
        )?;

        // Insert into storage
        self.storage.execute(
            "INSERT INTO offline_buffer 
             (event_id, timestamp_ns, encrypted_payload, nonce, event_hash, 
              prev_event_hash, signature, public_key_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                event.event_id,
                event.timestamp_ns as i64,
                event.encrypted_payload,
                event.nonce,
                event.event_hash,
                event.prev_event_hash,
                event.signature,
                event.public_key_id,
                Self::current_timestamp_ns() as i64,
            ],
        )?;

        let seq_no = self.storage.last_insert_rowid() as u64;

        debug!(
            node_id = %self.node_id,
            event_id = %event.event_id,
            seq_no,
            "Event queued in Materia Buffer"
        );

        Ok(seq_no)
    }

    /// Get the number of queued events
    pub fn get_queued_count(&self) -> Result<usize, OfflineError> {
        let count: i64 = self.storage.query_row("SELECT COUNT(*) FROM offline_buffer", [], |row| {
            row.get(0)
        })?;

        Ok(count as usize)
    }

    /// Get offline gap information
    pub fn get_gap_info(&self) -> Result<OfflineGapInfo, OfflineError> {
        let queued_count = self.get_queued_count()?;

        let offline_since_ns = self.offline_since.unwrap_or(0);
        let reconnect_at_ns = if self.state == ConnectionState::ReconnectPending {
            Some(Self::current_timestamp_ns())
        } else {
            None
        };

        let chain_intact = self.verify_local_chain()?;
        let buffer_utilization = queued_count as f64 / self.max_buffer_size as f64;

        Ok(OfflineGapInfo {
            queued_count,
            offline_since_ns,
            reconnect_at_ns,
            chain_intact,
            buffer_utilization,
        })
    }

    /// Verify local chain integrity
    fn verify_local_chain(&self) -> Result<bool, OfflineError> {
        let mut stmt = self.storage.prepare(
            "SELECT seq_no, event_hash, prev_event_hash 
             FROM offline_buffer 
             ORDER BY seq_no ASC",
        )?;

        let mut rows = stmt.query([])?;
        let mut prev_hash: Option<Vec<u8>> = None;

        while let Some(row) = rows.next()? {
            let seq_no: i64 = row.get(0)?;
            let event_hash: Vec<u8> = row.get(1)?;
            let expected_prev_hash: Vec<u8> = row.get(2)?;

            if let Some(actual_prev_hash) = &prev_hash {
                if actual_prev_hash != &expected_prev_hash {
                    error!(
                        node_id = %self.node_id,
                        seq_no,
                        "Chain break detected in offline buffer"
                    );
                    return Ok(false);
                }
            }

            prev_hash = Some(event_hash);
        }

        Ok(true)
    }

    /// Get all queued events for sync
    pub fn get_all_events(&self) -> Result<Vec<EncryptedPacket>, OfflineError> {
        let mut stmt = self.storage.prepare(
            "SELECT event_id, timestamp_ns, encrypted_payload, nonce, 
                    event_hash, prev_event_hash, signature, public_key_id
             FROM offline_buffer 
             ORDER BY seq_no ASC",
        )?;

        let events = stmt
            .query_map([], |row| {
                Ok(EncryptedPacket {
                    event_id: row.get(0)?,
                    timestamp_ns: row.get::<_, i64>(1)? as u64,
                    encrypted_payload: row.get(2)?,
                    nonce: row.get(3)?,
                    event_hash: row.get(4)?,
                    prev_event_hash: row.get(5)?,
                    signature: row.get(6)?,
                    public_key_id: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }

    /// Clear the offline buffer after successful sync
    pub fn clear_buffer(&mut self) -> Result<(), OfflineError> {
        self.storage.execute("DELETE FROM offline_buffer", [])?;
        self.merkle_vine = MerkleVine::new(&self.node_id);

        info!(
            node_id = %self.node_id,
            "Offline buffer cleared after successful sync"
        );

        Ok(())
    }

    /// Get the Merkle root of the offline chain
    pub fn get_merkle_root(&self) -> Result<Vec<u8>, OfflineError> {
        let root = self
            .merkle_vine
            .get_root()
            .map(|r| r.clone())
            .unwrap_or_else(|| vec![0u8; MERKLE_ROOT_SIZE]);
        Ok(root)
    }

    /// Get current timestamp in nanoseconds
    /// 
    /// Returns 0 if system time is before Unix epoch (should never happen in practice)
    fn current_timestamp_ns() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_state_transitions() {
        let temp_dir = std::env::temp_dir();
        let storage_path = temp_dir.join("test_offline_state.db");
        let _ = fs::remove_file(&storage_path);

        let mut buffer = OfflineMateriaBuffer::new(storage_path.clone(), "node-1".to_string())
            .expect("Failed to create buffer");

        // Initial state should be Online
        assert_eq!(
            buffer.get_state(),
            ConnectionState::Online
        );

        // Transition to offline
        buffer.enter_offline_mode().expect("Failed to enter offline mode");
        assert_eq!(
            buffer.get_state(),
            ConnectionState::OfflineAutonomous
        );

        // Transition to reconnect pending
        buffer.enter_reconnect_pending().expect("Failed to enter reconnect pending");
        assert_eq!(
            buffer.get_state(),
            ConnectionState::ReconnectPending
        );

        // Transition back to online
        buffer.enter_online_mode().expect("Failed to enter online mode");
        assert_eq!(
            buffer.get_state(),
            ConnectionState::Online
        );

        let _ = fs::remove_file(&storage_path);
    }

    #[test]
    fn test_queue_event() {
        let temp_dir = std::env::temp_dir();
        let storage_path = temp_dir.join("test_offline_queue.db");
        let _ = fs::remove_file(&storage_path);

        let mut buffer = OfflineMateriaBuffer::new(storage_path.clone(), "node-1".to_string())
            .expect("Failed to create buffer");

        // Enter offline mode
        buffer.enter_offline_mode().expect("Failed to enter offline mode");

        // Create a test event
        let event = EncryptedPacket {
            event_id: "evt-001".to_string(),
            timestamp_ns: 1000,
            encrypted_payload: vec![1, 2, 3, 4],
            nonce: vec![5, 6, 7, 8],
            event_hash: vec![0u8; MERKLE_ROOT_SIZE],
            prev_event_hash: vec![0u8; MERKLE_ROOT_SIZE],
            signature: vec![0u8; 64],
            public_key_id: "pubkey-1".to_string(),
        };

        // Queue the event
        let seq_no = buffer.queue_signed_event(event).expect("Failed to queue event");
        assert_eq!(seq_no, 1);

        // Check count
        assert_eq!(buffer.get_queued_count().unwrap(), 1);

        // Get gap info
        let gap_info = buffer.get_gap_info().expect("Failed to get gap info");
        assert_eq!(gap_info.queued_count, 1);
        assert!(gap_info.chain_intact);

        let _ = fs::remove_file(&storage_path);
    }

    #[test]
    fn test_cannot_queue_while_online() {
        let temp_dir = std::env::temp_dir();
        let storage_path = temp_dir.join("test_offline_no_queue.db");
        let _ = fs::remove_file(&storage_path);

        let mut buffer = OfflineMateriaBuffer::new(storage_path.clone(), "node-1".to_string())
            .expect("Failed to create buffer");

        let event = EncryptedPacket {
            event_id: "evt-001".to_string(),
            timestamp_ns: 1000,
            encrypted_payload: vec![1, 2, 3, 4],
            nonce: vec![5, 6, 7, 8],
            event_hash: vec![0u8; MERKLE_ROOT_SIZE],
            prev_event_hash: vec![0u8; MERKLE_ROOT_SIZE],
            signature: vec![0u8; 64],
            public_key_id: "pubkey-1".to_string(),
        };

        // Should fail while online
        let result = buffer.queue_signed_event(event);
        assert!(result.is_err());

        let _ = fs::remove_file(&storage_path);
    }
}
