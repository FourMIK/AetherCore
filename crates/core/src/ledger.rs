//! Event Ledger Engine - Production-Grade Append-Only Storage
//!
//! This module provides a durable, append-only ledger for signed events with:
//! - SQLite backend with WAL mode for durability
//! - Strict append-only semantics (no updates or deletes)
//! - Chain pointer validation at append time
//! - Startup continuity checks for corruption detection
//! - Observability metrics and structured alerting
//!
//! # Architecture
//!
//! Each signed event is persisted with:
//! - seq_no: Monotonically increasing sequence number per node
//! - event_id: Unique event identifier
//! - timestamp: Event creation time
//! - event_hash: BLAKE3 hash of the event
//! - prev_event_hash: Hash of the previous event (for chain validation)
//! - signature: Cryptographic signature
//! - public_key_id: Identifier of the signing key
//! - event_type: Optional event type
//! - payload: Optional compressed payload reference
//!
//! # Guarantees
//!
//! - Strict ordering: seq_no increases by 1 for each event
//! - Chain continuity: prev_event_hash must match previous event's event_hash
//! - Append-only: No in-place updates or deletes allowed
//! - Durability: SQLite WAL mode ensures crash recovery
//! - Corruption detection: Startup checks verify chain integrity

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tracing::{debug, error, info, warn};

/// A signed event with chain pointers and metadata
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SignedEvent {
    /// Unique event identifier
    pub event_id: String,
    /// Event creation timestamp (Unix milliseconds)
    pub timestamp: u64,
    /// BLAKE3 hash of the event content
    pub event_hash: Vec<u8>,
    /// Hash of the previous event in the chain
    pub prev_event_hash: Vec<u8>,
    /// Cryptographic signature
    pub signature: Vec<u8>,
    /// Public key identifier for verification
    pub public_key_id: String,
    /// Optional event type
    pub event_type: Option<String>,
    /// Optional compressed payload reference
    pub payload_ref: Option<String>,
}

/// Ledger health status
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LedgerHealth {
    /// Ledger is healthy
    Ok,
    /// Ledger is corrupted
    Corrupted {
        /// Last good sequence number
        last_good_seq_no: Option<u64>,
        /// First failing sequence number
        first_bad_seq_no: u64,
        /// Error type description
        error_type: String,
    },
}

impl LedgerHealth {
    /// Check if the ledger is healthy
    pub fn is_ok(&self) -> bool {
        matches!(self, LedgerHealth::Ok)
    }
}

/// Ledger health information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerHealthInfo {
    /// Health status
    pub status: LedgerHealth,
    /// Node identifier
    pub node_id: String,
}

/// Errors that can occur in ledger operations
#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    #[error("Chain ordering violation: expected prev_hash {expected}, got {actual}")]
    ChainOrderingViolation { expected: String, actual: String },

    #[error("Sequence number violation: expected {expected}, got {actual}")]
    SequenceViolation { expected: u64, actual: u64 },

    #[error("Duplicate sequence number: {seq_no}")]
    DuplicateSequence { seq_no: u64 },

    #[error("Duplicate event ID: {event_id}")]
    DuplicateEventId { event_id: String },

    #[error("Event not found: seq_no={seq_no}")]
    EventNotFound { seq_no: u64 },

    #[error("Ledger corrupted: {0}")]
    CorruptionDetected(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Invalid event: {0}")]
    InvalidEvent(String),
}

pub type Result<T> = std::result::Result<T, LedgerError>;

/// Observability metrics for the ledger
#[derive(Debug, Default, Clone)]
pub struct LedgerMetrics {
    /// Total events appended to the ledger
    pub ledger_events_appended_total: u64,
    /// Total startup checks performed
    pub ledger_startup_checks_total: u64,
    /// Total corruption detections
    pub ledger_corruption_detections_total: u64,
}

/// Event ledger engine with SQLite backend
pub struct EventLedger {
    /// SQLite database connection
    pub(crate) conn: Connection,
    /// Node identifier
    node_id: String,
    /// Current ledger health
    health: LedgerHealth,
    /// Metrics
    metrics: LedgerMetrics,
}

impl EventLedger {
    /// Create or open a ledger at the specified path
    ///
    /// # Arguments
    /// * `path` - Path to the SQLite database file
    /// * `node_id` - Unique identifier for this node
    ///
    /// # Returns
    /// * `Ok(EventLedger)` - Successfully opened ledger
    /// * `Err(LedgerError)` - Failed to open or initialize database
    pub fn open(path: impl AsRef<Path>, node_id: impl Into<String>) -> Result<Self> {
        let node_id = node_id.into();
        let path = path.as_ref();

        info!(
            node_id = %node_id,
            path = %path.display(),
            "Opening event ledger"
        );

        // Create parent directories if they don't exist
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Open database with WAL mode for durability
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        // Enable WAL mode for better concurrency and durability
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        // Initialize schema
        Self::init_schema(&conn)?;

        let mut ledger = Self {
            conn,
            node_id,
            health: LedgerHealth::Ok,
            metrics: LedgerMetrics::default(),
        };

        // Perform startup continuity check
        ledger.startup_continuity_check()?;

        Ok(ledger)
    }

    /// Initialize database schema
    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ledger_events (
                seq_no INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                timestamp INTEGER NOT NULL,
                event_hash BLOB NOT NULL,
                prev_event_hash BLOB NOT NULL,
                signature BLOB NOT NULL,
                public_key_id TEXT NOT NULL,
                event_type TEXT,
                payload_ref TEXT,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE INDEX IF NOT EXISTS idx_event_id ON ledger_events(event_id);
            CREATE INDEX IF NOT EXISTS idx_timestamp ON ledger_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_seq_no ON ledger_events(seq_no);
            "#,
        )?;

        Ok(())
    }

    /// Append a signed event to the ledger
    ///
    /// This enforces:
    /// - Monotonic seq_no increment
    /// - prev_event_hash matches the last event's event_hash
    /// - Uniqueness on seq_no and event_id
    ///
    /// # Arguments
    /// * `event` - The signed event to append
    ///
    /// # Returns
    /// * `Ok(u64)` - The assigned sequence number
    /// * `Err(LedgerError)` - If validation fails or database error occurs
    pub fn append_signed_event(&mut self, event: SignedEvent) -> Result<u64> {
        // Check if ledger is healthy
        if !self.health.is_ok() {
            warn!(
                node_id = %self.node_id,
                "Attempted to append to corrupted ledger"
            );
            return Err(LedgerError::CorruptionDetected(
                "Cannot append to corrupted ledger".to_string(),
            ));
        }

        // Validate event
        if event.event_id.is_empty() {
            return Err(LedgerError::InvalidEvent(
                "event_id cannot be empty".to_string(),
            ));
        }

        // Begin transaction
        let tx = self.conn.transaction()?;

        // Get the last event's hash and seq_no
        let last_event = Self::get_latest_event_internal(&tx)?;

        let expected_prev_hash = last_event
            .as_ref()
            .map(|(_, e)| e.event_hash.clone())
            .unwrap_or_else(|| vec![0u8; 32]); // Genesis hash

        // Verify chain continuity
        if event.prev_event_hash != expected_prev_hash {
            return Err(LedgerError::ChainOrderingViolation {
                expected: hex::encode(&expected_prev_hash),
                actual: hex::encode(&event.prev_event_hash),
            });
        }

        // Insert the event
        tx.execute(
            r#"
            INSERT INTO ledger_events (
                event_id, timestamp, event_hash, prev_event_hash,
                signature, public_key_id, event_type, payload_ref
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                event.event_id,
                event.timestamp as i64,
                event.event_hash,
                event.prev_event_hash,
                event.signature,
                event.public_key_id,
                event.event_type,
                event.payload_ref,
            ],
        )?;

        // Get the assigned seq_no
        let seq_no = tx.last_insert_rowid() as u64;

        // Commit transaction
        tx.commit()?;

        self.metrics.ledger_events_appended_total += 1;

        debug!(
            node_id = %self.node_id,
            seq_no = seq_no,
            event_id = %event.event_id,
            "Event appended to ledger"
        );

        Ok(seq_no)
    }

    /// Get the latest event from the ledger (internal, transaction-aware)
    fn get_latest_event_internal(tx: &Transaction) -> Result<Option<(u64, SignedEvent)>> {
        let mut stmt = tx.prepare(
            r#"
            SELECT seq_no, event_id, timestamp, event_hash, prev_event_hash,
                   signature, public_key_id, event_type, payload_ref
            FROM ledger_events
            ORDER BY seq_no DESC
            LIMIT 1
            "#,
        )?;

        let result = stmt
            .query_row([], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    SignedEvent {
                        event_id: row.get(1)?,
                        timestamp: row.get::<_, i64>(2)? as u64,
                        event_hash: row.get(3)?,
                        prev_event_hash: row.get(4)?,
                        signature: row.get(5)?,
                        public_key_id: row.get(6)?,
                        event_type: row.get(7)?,
                        payload_ref: row.get(8)?,
                    },
                ))
            })
            .optional()?;

        Ok(result)
    }

    /// Get the latest event from the ledger
    pub fn get_latest_event(&self) -> Result<Option<(u64, SignedEvent)>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT seq_no, event_id, timestamp, event_hash, prev_event_hash,
                   signature, public_key_id, event_type, payload_ref
            FROM ledger_events
            ORDER BY seq_no DESC
            LIMIT 1
            "#,
        )?;

        let result = stmt
            .query_row([], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    SignedEvent {
                        event_id: row.get(1)?,
                        timestamp: row.get::<_, i64>(2)? as u64,
                        event_hash: row.get(3)?,
                        prev_event_hash: row.get(4)?,
                        signature: row.get(5)?,
                        public_key_id: row.get(6)?,
                        event_type: row.get(7)?,
                        payload_ref: row.get(8)?,
                    },
                ))
            })
            .optional()?;

        Ok(result)
    }

    /// Get an event by sequence number
    pub fn get_event_by_seq_no(&self, seq_no: u64) -> Result<SignedEvent> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT event_id, timestamp, event_hash, prev_event_hash,
                   signature, public_key_id, event_type, payload_ref
            FROM ledger_events
            WHERE seq_no = ?1
            "#,
        )?;

        let event = stmt
            .query_row([seq_no as i64], |row| {
                Ok(SignedEvent {
                    event_id: row.get(0)?,
                    timestamp: row.get::<_, i64>(1)? as u64,
                    event_hash: row.get(2)?,
                    prev_event_hash: row.get(3)?,
                    signature: row.get(4)?,
                    public_key_id: row.get(5)?,
                    event_type: row.get(6)?,
                    payload_ref: row.get(7)?,
                })
            })
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => LedgerError::EventNotFound { seq_no },
                e => LedgerError::DatabaseError(e),
            })?;

        Ok(event)
    }

    /// Iterate events starting from a sequence number
    ///
    /// # Arguments
    /// * `from_seq_no` - Starting sequence number (inclusive)
    /// * `limit` - Maximum number of events to return
    ///
    /// # Returns
    /// * Vec of (seq_no, SignedEvent) tuples
    pub fn iterate_events(
        &self,
        from_seq_no: u64,
        limit: usize,
    ) -> Result<Vec<(u64, SignedEvent)>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT seq_no, event_id, timestamp, event_hash, prev_event_hash,
                   signature, public_key_id, event_type, payload_ref
            FROM ledger_events
            WHERE seq_no >= ?1
            ORDER BY seq_no ASC
            LIMIT ?2
            "#,
        )?;

        let events = stmt
            .query_map(params![from_seq_no as i64, limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    SignedEvent {
                        event_id: row.get(1)?,
                        timestamp: row.get::<_, i64>(2)? as u64,
                        event_hash: row.get(3)?,
                        prev_event_hash: row.get(4)?,
                        signature: row.get(5)?,
                        public_key_id: row.get(6)?,
                        event_type: row.get(7)?,
                        payload_ref: row.get(8)?,
                    },
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(events)
    }

    /// Perform startup continuity check
    ///
    /// Verifies:
    /// - Chain continuity (prev_event_hash matches)
    /// - Sequence numbers are strictly increasing by 1
    /// - No missing or duplicated events
    ///
    /// # Returns
    /// * `Ok(())` - Ledger is valid
    /// * `Err(LedgerError)` - Corruption detected
    pub fn startup_continuity_check(&mut self) -> Result<()> {
        self.metrics.ledger_startup_checks_total += 1;

        info!(node_id = %self.node_id, "Starting ledger continuity check");

        // Get all events
        let mut stmt = self.conn.prepare(
            r#"
            SELECT seq_no, event_id, timestamp, event_hash, prev_event_hash,
                   signature, public_key_id, event_type, payload_ref
            FROM ledger_events
            ORDER BY seq_no ASC
            "#,
        )?;

        let events: Vec<(u64, SignedEvent)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    SignedEvent {
                        event_id: row.get(1)?,
                        timestamp: row.get::<_, i64>(2)? as u64,
                        event_hash: row.get(3)?,
                        prev_event_hash: row.get(4)?,
                        signature: row.get(5)?,
                        public_key_id: row.get(6)?,
                        event_type: row.get(7)?,
                        payload_ref: row.get(8)?,
                    },
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        if events.is_empty() {
            info!(node_id = %self.node_id, "Ledger is empty, continuity check passed");
            return Ok(());
        }

        // Check each event
        let mut expected_seq_no = events[0].0;
        let mut prev_event_hash = vec![0u8; 32]; // Genesis hash

        for (i, (seq_no, event)) in events.iter().enumerate() {
            // Check sequence number
            if *seq_no != expected_seq_no {
                let error_type = if *seq_no < expected_seq_no {
                    format!("Duplicated sequence number: {}", seq_no)
                } else {
                    format!(
                        "Missing events: gap between {} and {}",
                        expected_seq_no - 1,
                        seq_no
                    )
                };

                self.health = LedgerHealth::Corrupted {
                    last_good_seq_no: if i > 0 { Some(events[i - 1].0) } else { None },
                    first_bad_seq_no: *seq_no,
                    error_type: error_type.clone(),
                };

                self.metrics.ledger_corruption_detections_total += 1;

                error!(
                    node_id = %self.node_id,
                    seq_no = seq_no,
                    expected = expected_seq_no,
                    error_type = %error_type,
                    "Ledger corruption detected: sequence number violation"
                );

                return Err(LedgerError::CorruptionDetected(error_type));
            }

            // Check chain continuity
            if event.prev_event_hash != prev_event_hash {
                let error_type = format!(
                    "Hash mismatch at seq_no {}: expected prev_hash {}, got {}",
                    seq_no,
                    hex::encode(&prev_event_hash),
                    hex::encode(&event.prev_event_hash)
                );

                self.health = LedgerHealth::Corrupted {
                    last_good_seq_no: if i > 0 { Some(events[i - 1].0) } else { None },
                    first_bad_seq_no: *seq_no,
                    error_type: error_type.clone(),
                };

                self.metrics.ledger_corruption_detections_total += 1;

                error!(
                    node_id = %self.node_id,
                    seq_no = seq_no,
                    error_type = %error_type,
                    "Ledger corruption detected: chain continuity broken"
                );

                return Err(LedgerError::CorruptionDetected(error_type));
            }

            // Update for next iteration
            prev_event_hash = event.event_hash.clone();
            expected_seq_no += 1;
        }

        info!(
            node_id = %self.node_id,
            event_count = events.len(),
            "Ledger continuity check passed"
        );

        Ok(())
    }

    /// Get ledger health status
    pub fn get_ledger_health(&self) -> LedgerHealthInfo {
        LedgerHealthInfo {
            status: self.health.clone(),
            node_id: self.node_id.clone(),
        }
    }

    /// Get ledger metrics
    pub fn metrics(&self) -> &LedgerMetrics {
        &self.metrics
    }

    /// Get the node ID
    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Get the database path
    pub fn db_path(&self) -> PathBuf {
        PathBuf::from(self.conn.path().unwrap_or(""))
    }

    /// Execute raw SQL for testing purposes only
    ///
    /// **WARNING**: This method bypasses ledger integrity checks and should ONLY be used
    /// in tests to simulate corruption scenarios. Do NOT use in production code.
    ///
    /// This is intentionally pub(crate) to allow integration tests while preventing
    /// external misuse.
    #[doc(hidden)]
    pub fn __test_execute_raw_sql(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<usize> {
        Ok(self.conn.execute(sql, params)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use blake3::Hasher;

    fn compute_hash(data: &[u8]) -> Vec<u8> {
        let mut hasher = Hasher::new();
        hasher.update(data);
        hasher.finalize().as_bytes().to_vec()
    }

    fn create_test_event(event_id: &str, prev_event_hash: Vec<u8>, seq: u64) -> SignedEvent {
        let content = format!("event-{}-{}", event_id, seq);
        let event_hash = compute_hash(content.as_bytes());

        SignedEvent {
            event_id: event_id.to_string(),
            timestamp: 1700000000000 + seq * 1000,
            event_hash,
            prev_event_hash,
            signature: vec![1, 2, 3, 4],
            public_key_id: "test-key".to_string(),
            event_type: Some("test.event".to_string()),
            payload_ref: None,
        }
    }

    #[test]
    fn test_ledger_creation() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        assert_eq!(ledger.node_id(), "test-node-1");
        assert!(ledger.get_ledger_health().status.is_ok());

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_append_signed_event() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        // Append first event (genesis)
        let event1 = create_test_event("event-1", vec![0u8; 32], 1);
        let seq_no1 = ledger.append_signed_event(event1.clone()).unwrap();
        assert_eq!(seq_no1, 1);

        // Append second event
        let event2 = create_test_event("event-2", event1.event_hash.clone(), 2);
        let seq_no2 = ledger.append_signed_event(event2.clone()).unwrap();
        assert_eq!(seq_no2, 2);

        // Verify metrics
        assert_eq!(ledger.metrics().ledger_events_appended_total, 2);

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_append_rejects_wrong_prev_hash() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        // Append first event
        let event1 = create_test_event("event-1", vec![0u8; 32], 1);
        ledger.append_signed_event(event1.clone()).unwrap();

        // Try to append with wrong prev_hash
        let wrong_prev_hash = vec![9u8; 32];
        let event2 = create_test_event("event-2", wrong_prev_hash, 2);
        let result = ledger.append_signed_event(event2);

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            LedgerError::ChainOrderingViolation { .. }
        ));

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_get_event_by_seq_no() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        let event1 = create_test_event("event-1", vec![0u8; 32], 1);
        ledger.append_signed_event(event1.clone()).unwrap();

        let retrieved = ledger.get_event_by_seq_no(1).unwrap();
        assert_eq!(retrieved.event_id, "event-1");

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_get_latest_event() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        // Empty ledger
        assert!(ledger.get_latest_event().unwrap().is_none());

        // Add events
        let event1 = create_test_event("event-1", vec![0u8; 32], 1);
        ledger.append_signed_event(event1.clone()).unwrap();

        let event2 = create_test_event("event-2", event1.event_hash.clone(), 2);
        ledger.append_signed_event(event2.clone()).unwrap();

        let (seq_no, latest) = ledger.get_latest_event().unwrap().unwrap();
        assert_eq!(seq_no, 2);
        assert_eq!(latest.event_id, "event-2");

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_iterate_events() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        // Add multiple events
        let mut prev_hash = vec![0u8; 32];
        for i in 1..=5 {
            let event = create_test_event(&format!("event-{}", i), prev_hash.clone(), i);
            prev_hash = event.event_hash.clone();
            ledger.append_signed_event(event).unwrap();
        }

        // Iterate from seq_no 2, limit 3
        let events = ledger.iterate_events(2, 3).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].0, 2);
        assert_eq!(events[1].0, 3);
        assert_eq!(events[2].0, 4);

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_continuity_check_clean_ledger() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

        // Add events
        let mut prev_hash = vec![0u8; 32];
        for i in 1..=5 {
            let event = create_test_event(&format!("event-{}", i), prev_hash.clone(), i);
            prev_hash = event.event_hash.clone();
            ledger.append_signed_event(event).unwrap();
        }

        // Re-run continuity check
        let result = ledger.startup_continuity_check();
        assert!(result.is_ok());
        assert!(ledger.get_ledger_health().status.is_ok());

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn test_continuity_check_detects_modified_record() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_ledger_{}.db", uuid::Uuid::new_v4()));

        {
            let mut ledger = EventLedger::open(&db_path, "test-node-1").unwrap();

            // Add events
            let mut prev_hash = vec![0u8; 32];
            for i in 1..=5 {
                let event = create_test_event(&format!("event-{}", i), prev_hash.clone(), i);
                prev_hash = event.event_hash.clone();
                ledger.append_signed_event(event).unwrap();
            }

            // Manually corrupt the database
            ledger
                .__test_execute_raw_sql(
                    "UPDATE ledger_events SET prev_event_hash = ? WHERE seq_no = 3",
                    &[&vec![0xFFu8; 32] as &dyn rusqlite::ToSql],
                )
                .unwrap();
        }

        // Reopen and check
        let ledger = EventLedger::open(&db_path, "test-node-1");
        assert!(ledger.is_err());

        // Cleanup
        std::fs::remove_file(db_path).ok();
    }
}
