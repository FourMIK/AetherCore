//! Integrity event trait for Merkle Vine streaming verification.
//!
//! This module defines the interface for events that participate in the
//! integrity chain. Events implement this trait to provide canonical
//! representations and chain continuity via prev_hash links.
//!
//! # Design
//! - Events produce canonical byte representations
//! - Events reference previous event via hash
//! - Chain can be verified independently
//! - No enforcement yet - prepare interface only
//!
//! # Future: Merkle Vine Integration
//! When full Merkle Vine is implemented, this trait will be used to:
//! - Build event chains with exponential back pointers (skip links)
//! - Detect broken chains (Byzantine faults)
//! - Enable efficient chain verification
//! - Support historical integrity proofs

/// Trait for events that participate in integrity verification chains.
///
/// Events implementing this trait can be included in Merkle Vine chains
/// with cryptographic continuity verification.
pub trait IntegrityEvent {
    /// Get the canonical byte representation of this event.
    ///
    /// This representation must be:
    /// - Deterministic: Same event always produces same bytes
    /// - Complete: Includes all integrity-relevant fields
    /// - Sorted: Fields in canonical order
    ///
    /// The canonical bytes are used for:
    /// - Computing event hash
    /// - Verifying signatures
    /// - Chain continuity validation
    fn canonical_bytes(&self) -> &[u8];

    /// Get the hash of the previous event in the chain.
    ///
    /// Returns:
    /// - Some(hash): This event links to a previous event
    /// - None: This is the first event (genesis)
    ///
    /// # Chain Continuity
    /// The prev_hash creates a tamper-evident chain:
    /// ```text
    /// Event_0 (genesis) -> Event_1 -> Event_2 -> Event_3
    ///         prev=None     prev=H0    prev=H1    prev=H2
    /// ```
    ///
    /// Any modification to Event_1 changes its hash, breaking the link
    /// from Event_2, making tampering detectable.
    fn prev_hash(&self) -> Option<&[u8; 32]>;

    /// Compute the hash of this event's canonical bytes.
    ///
    /// Default implementation uses BLAKE3.
    /// Override for custom hash functions.
    fn compute_hash(&self) -> [u8; 32] {
        let hash_output = blake3::hash(self.canonical_bytes());
        *hash_output.as_bytes()
    }

    /// Verify chain continuity with the previous event.
    ///
    /// Checks that this event's prev_hash matches the provided previous event's hash.
    ///
    /// # Arguments
    /// * `previous` - The event that should precede this one
    ///
    /// # Returns
    /// - true: Chain link is valid
    /// - false: Chain is broken (Byzantine fault)
    fn verify_chain_link(&self, previous: &dyn IntegrityEvent) -> bool {
        match self.prev_hash() {
            Some(expected_hash) => {
                let actual_hash = previous.compute_hash();
                expected_hash == &actual_hash
            }
            None => false, // Current event claims to be genesis, but previous provided
        }
    }

    /// Check if this is a genesis event (no predecessor).
    fn is_genesis(&self) -> bool {
        self.prev_hash().is_none()
    }
}

/// Chain verification result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainVerificationResult {
    /// Chain is valid
    Valid,
    /// Chain is broken at the specified event index
    BrokenChain { 
        broken_at_index: usize,
        expected_hash: [u8; 32],
        actual_hash: [u8; 32],
    },
    /// Genesis event is not first
    InvalidGenesis,
}

/// Verify a sequence of integrity events forms a valid chain.
///
/// # Arguments
/// * `events` - Ordered sequence of events (oldest first)
///
/// # Returns
/// ChainVerificationResult indicating validity or break point
///
/// # Example
/// ```ignore
/// let events: Vec<Box<dyn IntegrityEvent>> = ...;
/// match verify_event_chain(&events) {
///     ChainVerificationResult::Valid => println!("Chain is valid"),
///     ChainVerificationResult::BrokenChain { broken_at_index, .. } => {
///         println!("Chain broken at event {}", broken_at_index);
///     }
///     ChainVerificationResult::InvalidGenesis => {
///         println!("First event is not genesis");
///     }
/// }
/// ```
pub fn verify_event_chain(events: &[&dyn IntegrityEvent]) -> ChainVerificationResult {
    if events.is_empty() {
        return ChainVerificationResult::Valid;
    }

    // First event must be genesis
    if !events[0].is_genesis() {
        return ChainVerificationResult::InvalidGenesis;
    }

    // Verify each subsequent event links to previous
    for i in 1..events.len() {
        let current = events[i];
        let previous = events[i - 1];

        if !current.verify_chain_link(previous) {
            let expected_hash = current.prev_hash().copied().unwrap_or([0u8; 32]);
            let actual_hash = previous.compute_hash();

            return ChainVerificationResult::BrokenChain {
                broken_at_index: i,
                expected_hash,
                actual_hash,
            };
        }
    }

    ChainVerificationResult::Valid
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestEvent {
        data: Vec<u8>,
        prev: Option<[u8; 32]>,
    }

    impl IntegrityEvent for TestEvent {
        fn canonical_bytes(&self) -> &[u8] {
            &self.data
        }

        fn prev_hash(&self) -> Option<&[u8; 32]> {
            self.prev.as_ref()
        }
    }

    #[test]
    fn test_genesis_event() {
        let genesis = TestEvent {
            data: b"genesis".to_vec(),
            prev: None,
        };

        assert!(genesis.is_genesis());
    }

    #[test]
    fn test_chain_link_valid() {
        let event0 = TestEvent {
            data: b"event0".to_vec(),
            prev: None,
        };

        let hash0 = event0.compute_hash();

        let event1 = TestEvent {
            data: b"event1".to_vec(),
            prev: Some(hash0),
        };

        assert!(event1.verify_chain_link(&event0));
    }

    #[test]
    fn test_chain_link_broken() {
        let event0 = TestEvent {
            data: b"event0".to_vec(),
            prev: None,
        };

        let wrong_hash = [0u8; 32];

        let event1 = TestEvent {
            data: b"event1".to_vec(),
            prev: Some(wrong_hash),
        };

        assert!(!event1.verify_chain_link(&event0));
    }

    #[test]
    fn test_chain_verification() {
        let event0 = TestEvent {
            data: b"event0".to_vec(),
            prev: None,
        };

        let hash0 = event0.compute_hash();

        let event1 = TestEvent {
            data: b"event1".to_vec(),
            prev: Some(hash0),
        };

        let hash1 = event1.compute_hash();

        let event2 = TestEvent {
            data: b"event2".to_vec(),
            prev: Some(hash1),
        };

        let events: Vec<&dyn IntegrityEvent> = vec![&event0, &event1, &event2];

        assert_eq!(verify_event_chain(&events), ChainVerificationResult::Valid);
    }
}
