//! Spectral Agility - Coordinated Frequency Hopping for EW Hardening
//!
//! Implements coordinated frequency hopping to evade jamming attacks.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Frequency channel identifier
pub type ChannelId = u32;

/// Frequency hopping pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoppingPattern {
    /// Sequence of channels to hop through
    pub channels: Vec<ChannelId>,
    /// Dwell time per channel in milliseconds
    pub dwell_time_ms: u64,
    /// Pattern identifier
    pub pattern_id: String,
    /// Cryptographic seed for pattern generation
    pub seed: Vec<u8>,
}

/// Frequency hopping state machine
#[derive(Debug)]
pub struct FrequencyHopper {
    /// Current hopping pattern
    pattern: Option<HoppingPattern>,
    /// Current channel index in pattern
    current_index: usize,
    /// Timestamp of last hop
    last_hop_time: u64,
    /// Packet Error Rate threshold for triggering hop
    per_threshold: f64,
    /// Current measured PER
    current_per: f64,
    /// Is jamming detected?
    jamming_detected: bool,
}

impl FrequencyHopper {
    /// Create a new frequency hopper
    pub fn new(per_threshold: f64) -> Self {
        Self {
            pattern: None,
            current_index: 0,
            last_hop_time: current_timestamp(),
            per_threshold,
            current_per: 0.0,
            jamming_detected: false,
        }
    }

    /// Set a new hopping pattern
    pub fn set_pattern(&mut self, pattern: HoppingPattern) {
        self.pattern = Some(pattern);
        self.current_index = 0;
        self.last_hop_time = current_timestamp();
    }

    /// Get the current channel
    pub fn current_channel(&self) -> Option<ChannelId> {
        self.pattern
            .as_ref()
            .and_then(|p| p.channels.get(self.current_index).copied())
    }

    /// Update Packet Error Rate measurement
    pub fn update_per(&mut self, per: f64) {
        self.current_per = per;

        // Detect jamming
        if per > self.per_threshold {
            self.jamming_detected = true;
        } else {
            self.jamming_detected = false;
        }
    }

    /// Check if it's time to hop to next channel
    pub fn should_hop(&self) -> bool {
        if let Some(pattern) = &self.pattern {
            let now = current_timestamp();
            let time_since_last_hop = now - self.last_hop_time;

            // Hop if dwell time exceeded OR jamming detected
            time_since_last_hop >= pattern.dwell_time_ms || self.jamming_detected
        } else {
            false
        }
    }

    /// Perform frequency hop to next channel
    pub fn hop(&mut self) -> HopResult {
        if let Some(pattern) = &self.pattern {
            self.current_index = (self.current_index + 1) % pattern.channels.len();
            self.last_hop_time = current_timestamp();

            let new_channel = pattern.channels[self.current_index];

            HopResult::Success {
                new_channel,
                reason: if self.jamming_detected {
                    HopReason::JammingDetected
                } else {
                    HopReason::ScheduledHop
                },
            }
        } else {
            HopResult::NoPattern
        }
    }

    /// Get hop at specific epoch (for cryptographic synchronization)
    pub fn hop_at_epoch(&mut self, epoch: u64) -> HopResult {
        if let Some(pattern) = &self.pattern {
            // Calculate which channel to be on at this epoch
            let index = (epoch % pattern.channels.len() as u64) as usize;
            self.current_index = index;
            self.last_hop_time = epoch;

            HopResult::Success {
                new_channel: pattern.channels[index],
                reason: HopReason::EpochSync,
            }
        } else {
            HopResult::NoPattern
        }
    }

    /// Check if jamming is currently detected
    pub fn is_jamming_detected(&self) -> bool {
        self.jamming_detected
    }

    /// Get current PER
    pub fn get_current_per(&self) -> f64 {
        self.current_per
    }
}

/// Result of a frequency hop
#[derive(Debug, PartialEq)]
pub enum HopResult {
    /// Hop successful
    Success {
        /// New channel
        new_channel: ChannelId,
        /// Reason for hop
        reason: HopReason,
    },
    /// No pattern configured
    NoPattern,
}

/// Reason for frequency hop
#[derive(Debug, PartialEq)]
pub enum HopReason {
    /// Scheduled hop (dwell time expired)
    ScheduledHop,
    /// Jamming detected (PER exceeded threshold)
    JammingDetected,
    /// Synchronized to specific epoch
    EpochSync,
}

/// Generate a pseudo-random hopping pattern from a seed
///
/// Uses BLAKE3 to expand short seeds to full 32-byte entropy before
/// initializing the PRNG for deterministic pattern generation.
pub fn generate_hopping_pattern(
    seed: Vec<u8>,
    num_channels: usize,
    channel_range: (ChannelId, ChannelId),
    dwell_time_ms: u64,
) -> HoppingPattern {
    use rand::{Rng, SeedableRng};
    use rand::rngs::StdRng;

    // Use BLAKE3 to properly expand seed to 32 bytes
    let seed_hash = blake3::hash(&seed);
    let seed_array = seed_hash.as_bytes();
    
    let mut rng = StdRng::from_seed(*seed_array);

    // Generate random channel sequence
    let channels: Vec<ChannelId> = (0..num_channels)
        .map(|_| rng.gen_range(channel_range.0..=channel_range.1))
        .collect();

    HoppingPattern {
        channels,
        dwell_time_ms,
        pattern_id: format!("pattern-{}", current_timestamp()),
        seed,
    }
}

/// Get current timestamp in milliseconds
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_pattern() -> HoppingPattern {
        HoppingPattern {
            channels: vec![10, 20, 30, 40, 50],
            dwell_time_ms: 100,
            pattern_id: "test-pattern".to_string(),
            seed: vec![1, 2, 3, 4],
        }
    }

    #[test]
    fn test_frequency_hopper_creation() {
        let hopper = FrequencyHopper::new(0.1);
        assert_eq!(hopper.current_per, 0.0);
        assert!(!hopper.jamming_detected);
    }

    #[test]
    fn test_set_pattern() {
        let mut hopper = FrequencyHopper::new(0.1);
        let pattern = create_test_pattern();

        hopper.set_pattern(pattern.clone());
        assert_eq!(hopper.current_channel(), Some(10));
    }

    #[test]
    fn test_jamming_detection() {
        let mut hopper = FrequencyHopper::new(0.1);
        hopper.set_pattern(create_test_pattern());

        // Low PER - no jamming
        hopper.update_per(0.05);
        assert!(!hopper.is_jamming_detected());

        // High PER - jamming detected
        hopper.update_per(0.15);
        assert!(hopper.is_jamming_detected());
    }

    #[test]
    fn test_scheduled_hop() {
        let mut hopper = FrequencyHopper::new(0.1);
        let mut pattern = create_test_pattern();
        pattern.dwell_time_ms = 1; // Very short dwell time

        hopper.set_pattern(pattern);
        assert_eq!(hopper.current_channel(), Some(10));

        // Wait for dwell time
        std::thread::sleep(std::time::Duration::from_millis(2));

        assert!(hopper.should_hop());
        let result = hopper.hop();

        match result {
            HopResult::Success {
                new_channel,
                reason,
            } => {
                assert_eq!(new_channel, 20);
                assert_eq!(reason, HopReason::ScheduledHop);
            }
            _ => panic!("Expected Success"),
        }
    }

    #[test]
    fn test_jamming_triggered_hop() {
        let mut hopper = FrequencyHopper::new(0.1);
        hopper.set_pattern(create_test_pattern());

        // Trigger jamming
        hopper.update_per(0.5);

        assert!(hopper.should_hop());
        let result = hopper.hop();

        match result {
            HopResult::Success { reason, .. } => {
                assert_eq!(reason, HopReason::JammingDetected);
            }
            _ => panic!("Expected Success"),
        }
    }

    #[test]
    fn test_hop_wraps_around() {
        let mut hopper = FrequencyHopper::new(0.1);
        hopper.set_pattern(create_test_pattern());

        // Hop through all channels
        for _ in 0..5 {
            hopper.hop();
        }

        // Should wrap back to first channel
        assert_eq!(hopper.current_channel(), Some(10));
    }

    #[test]
    fn test_epoch_sync() {
        let mut hopper = FrequencyHopper::new(0.1);
        hopper.set_pattern(create_test_pattern());

        // Sync to epoch 3 (should be channel at index 3)
        let result = hopper.hop_at_epoch(3);

        match result {
            HopResult::Success {
                new_channel,
                reason,
            } => {
                assert_eq!(new_channel, 40); // Index 3 in pattern
                assert_eq!(reason, HopReason::EpochSync);
            }
            _ => panic!("Expected Success"),
        }
    }

    #[test]
    fn test_no_pattern_returns_error() {
        let mut hopper = FrequencyHopper::new(0.1);
        assert_eq!(hopper.hop(), HopResult::NoPattern);
    }

    #[test]
    fn test_generate_hopping_pattern() {
        let seed = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let pattern = generate_hopping_pattern(seed.clone(), 10, (100, 200), 50);

        assert_eq!(pattern.channels.len(), 10);
        assert_eq!(pattern.dwell_time_ms, 50);
        assert_eq!(pattern.seed, seed);

        // All channels should be in range
        for &channel in &pattern.channels {
            assert!(channel >= 100 && channel <= 200);
        }
    }

    #[test]
    fn test_deterministic_pattern_generation() {
        let seed = vec![42, 42, 42, 42];

        let pattern1 = generate_hopping_pattern(seed.clone(), 5, (1, 100), 50);
        let pattern2 = generate_hopping_pattern(seed.clone(), 5, (1, 100), 50);

        // Same seed should produce same pattern
        assert_eq!(pattern1.channels, pattern2.channels);
    }
}
