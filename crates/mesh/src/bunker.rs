//! Bunker Mode - Offline-First Persistence for Network Isolation
//!
//! Handles total network isolation by storing data locally and syncing when
//! connectivity is restored.

use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Bunker mode manager for offline-first operation
#[derive(Debug)]
pub struct BunkerMode {
    /// SQLite connection for local storage
    db: Connection,
    /// Current operational state
    state: BunkerState,
}

/// Bunker operational state
#[derive(Debug, Clone, PartialEq)]
pub enum BunkerState {
    /// Normal operation - connected to mesh
    Connected,
    /// Bunker mode - isolated, storing locally
    Isolated,
    /// Syncing state - reconnected, uploading local data
    Syncing,
}

/// Stored chain block for offline operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredBlock {
    /// Block hash
    pub hash: Vec<u8>,
    /// Block height / sequence number
    pub height: u64,
    /// Block data
    pub data: Vec<u8>,
    /// Timestamp of creation
    pub timestamp: u64,
    /// Synced to network flag
    pub synced: bool,
}

/// Stored telemetry or C2 command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    /// Event ID
    pub id: String,
    /// Event type
    pub event_type: String,
    /// Event payload
    pub payload: Vec<u8>,
    /// Timestamp of creation
    pub timestamp: u64,
    /// Synced to network flag
    pub synced: bool,
}

impl BunkerMode {
    /// Create a new bunker mode instance
    pub fn new<P: AsRef<Path>>(db_path: P) -> SqliteResult<Self> {
        let db = Connection::open(db_path)?;

        // Initialize schema
        db.execute(
            "CREATE TABLE IF NOT EXISTS chain_store (
                hash BLOB PRIMARY KEY,
                height INTEGER NOT NULL,
                data BLOB NOT NULL,
                timestamp INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS event_store (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload BLOB NOT NULL,
                timestamp INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_chain_height ON chain_store(height)",
            [],
        )?;

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_store(timestamp)",
            [],
        )?;

        Ok(Self {
            db,
            state: BunkerState::Connected,
        })
    }

    /// Transition to bunker mode (peer_count == 0)
    pub fn enter_bunker_mode(&mut self) {
        self.state = BunkerState::Isolated;
    }

    /// Exit bunker mode (reconnected to mesh)
    pub fn exit_bunker_mode(&mut self) {
        self.state = BunkerState::Syncing;
    }

    /// Return to normal connected state
    pub fn enter_connected_state(&mut self) {
        self.state = BunkerState::Connected;
    }

    /// Get current state
    pub fn state(&self) -> &BunkerState {
        &self.state
    }

    /// Store a block locally
    pub fn store_block(&mut self, block: StoredBlock) -> SqliteResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO chain_store (hash, height, data, timestamp, synced) 
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![block.hash, block.height, block.data, block.timestamp, block.synced as i32],
        )?;
        Ok(())
    }

    /// Store an event locally
    pub fn store_event(&mut self, event: StoredEvent) -> SqliteResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO event_store (id, event_type, payload, timestamp, synced) 
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                event.id,
                event.event_type,
                event.payload,
                event.timestamp,
                event.synced as i32
            ],
        )?;
        Ok(())
    }

    /// Get unsynced blocks for deferred sync
    pub fn get_unsynced_blocks(&self) -> SqliteResult<Vec<StoredBlock>> {
        let mut stmt = self
            .db
            .prepare("SELECT hash, height, data, timestamp, synced FROM chain_store WHERE synced = 0 ORDER BY height")?;

        let blocks = stmt
            .query_map([], |row| {
                Ok(StoredBlock {
                    hash: row.get(0)?,
                    height: row.get(1)?,
                    data: row.get(2)?,
                    timestamp: row.get(3)?,
                    synced: row.get::<_, i32>(4)? != 0,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(blocks)
    }

    /// Get unsynced events for deferred sync
    pub fn get_unsynced_events(&self) -> SqliteResult<Vec<StoredEvent>> {
        let mut stmt = self
            .db
            .prepare("SELECT id, event_type, payload, timestamp, synced FROM event_store WHERE synced = 0 ORDER BY timestamp")?;

        let events = stmt
            .query_map([], |row| {
                Ok(StoredEvent {
                    id: row.get(0)?,
                    event_type: row.get(1)?,
                    payload: row.get(2)?,
                    timestamp: row.get(3)?,
                    synced: row.get::<_, i32>(4)? != 0,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(events)
    }

    /// Mark a block as synced
    pub fn mark_block_synced(&mut self, hash: &[u8]) -> SqliteResult<()> {
        self.db.execute(
            "UPDATE chain_store SET synced = 1 WHERE hash = ?1",
            [hash],
        )?;
        Ok(())
    }

    /// Mark an event as synced
    pub fn mark_event_synced(&mut self, id: &str) -> SqliteResult<()> {
        self.db.execute(
            "UPDATE event_store SET synced = 1 WHERE id = ?1",
            [id],
        )?;
        Ok(())
    }

    /// Get total number of unsynced items
    pub fn get_unsynced_count(&self) -> SqliteResult<(usize, usize)> {
        let block_count: i64 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM chain_store WHERE synced = 0",
                [],
                |row| row.get(0),
            )?;

        let event_count: i64 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM event_store WHERE synced = 0",
                [],
                |row| row.get(0),
            )?;

        Ok((block_count as usize, event_count as usize))
    }

    /// Get latest block height from local store
    pub fn get_latest_height(&self) -> SqliteResult<Option<u64>> {
        let result: Option<u64> = self
            .db
            .query_row(
                "SELECT MAX(height) FROM chain_store",
                [],
                |row| row.get(0),
            )
            .ok();

        Ok(result)
    }
}

/// Get current timestamp in milliseconds
#[allow(dead_code)]
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_block(height: u64) -> StoredBlock {
        StoredBlock {
            hash: vec![height as u8; 32],
            height,
            data: vec![1, 2, 3],
            timestamp: current_timestamp(),
            synced: false,
        }
    }

    fn create_test_event(id: &str) -> StoredEvent {
        StoredEvent {
            id: id.to_string(),
            event_type: "telemetry".to_string(),
            payload: vec![4, 5, 6],
            timestamp: current_timestamp(),
            synced: false,
        }
    }

    #[test]
    fn test_bunker_mode_creation() {
        let bunker = BunkerMode::new(":memory:").unwrap();
        assert_eq!(bunker.state(), &BunkerState::Connected);
    }

    #[test]
    fn test_state_transitions() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();

        assert_eq!(bunker.state(), &BunkerState::Connected);

        bunker.enter_bunker_mode();
        assert_eq!(bunker.state(), &BunkerState::Isolated);

        bunker.exit_bunker_mode();
        assert_eq!(bunker.state(), &BunkerState::Syncing);

        bunker.enter_connected_state();
        assert_eq!(bunker.state(), &BunkerState::Connected);
    }

    #[test]
    fn test_store_block() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();
        let block = create_test_block(100);

        bunker.store_block(block.clone()).unwrap();

        let unsynced = bunker.get_unsynced_blocks().unwrap();
        assert_eq!(unsynced.len(), 1);
        assert_eq!(unsynced[0].height, 100);
    }

    #[test]
    fn test_store_event() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();
        let event = create_test_event("event1");

        bunker.store_event(event.clone()).unwrap();

        let unsynced = bunker.get_unsynced_events().unwrap();
        assert_eq!(unsynced.len(), 1);
        assert_eq!(unsynced[0].id, "event1");
    }

    #[test]
    fn test_mark_block_synced() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();
        let block = create_test_block(100);
        let hash = block.hash.clone();

        bunker.store_block(block).unwrap();
        assert_eq!(bunker.get_unsynced_blocks().unwrap().len(), 1);

        bunker.mark_block_synced(&hash).unwrap();
        assert_eq!(bunker.get_unsynced_blocks().unwrap().len(), 0);
    }

    #[test]
    fn test_mark_event_synced() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();
        let event = create_test_event("event1");

        bunker.store_event(event).unwrap();
        assert_eq!(bunker.get_unsynced_events().unwrap().len(), 1);

        bunker.mark_event_synced("event1").unwrap();
        assert_eq!(bunker.get_unsynced_events().unwrap().len(), 0);
    }

    #[test]
    fn test_get_unsynced_count() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();

        bunker.store_block(create_test_block(100)).unwrap();
        bunker.store_block(create_test_block(101)).unwrap();
        bunker.store_event(create_test_event("event1")).unwrap();

        let (block_count, event_count) = bunker.get_unsynced_count().unwrap();
        assert_eq!(block_count, 2);
        assert_eq!(event_count, 1);
    }

    #[test]
    fn test_get_latest_height() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();

        assert_eq!(bunker.get_latest_height().unwrap(), None);

        bunker.store_block(create_test_block(100)).unwrap();
        bunker.store_block(create_test_block(150)).unwrap();
        bunker.store_block(create_test_block(120)).unwrap();

        assert_eq!(bunker.get_latest_height().unwrap(), Some(150));
    }

    #[test]
    fn test_deferred_sync_scenario() {
        let mut bunker = BunkerMode::new(":memory:").unwrap();

        // Enter bunker mode
        bunker.enter_bunker_mode();
        assert_eq!(bunker.state(), &BunkerState::Isolated);

        // Store data while isolated
        bunker.store_block(create_test_block(100)).unwrap();
        bunker.store_event(create_test_event("event1")).unwrap();

        // Reconnect
        bunker.exit_bunker_mode();
        assert_eq!(bunker.state(), &BunkerState::Syncing);

        // Get unsynced data
        let blocks = bunker.get_unsynced_blocks().unwrap();
        let events = bunker.get_unsynced_events().unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(events.len(), 1);

        // Sync data
        for block in blocks {
            bunker.mark_block_synced(&block.hash).unwrap();
        }
        for event in events {
            bunker.mark_event_synced(&event.id).unwrap();
        }

        // Verify all synced
        let (block_count, event_count) = bunker.get_unsynced_count().unwrap();
        assert_eq!(block_count, 0);
        assert_eq!(event_count, 0);

        // Return to connected state
        bunker.enter_connected_state();
        assert_eq!(bunker.state(), &BunkerState::Connected);
    }
}
