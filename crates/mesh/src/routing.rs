//! Weaver Ant Routing - Multi-hop mesh routing with resilience
//!
//! Implements cost-based routing where nodes can act as bridges when
//! direct links are unavailable.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Route entry in the routing table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteEntry {
    /// Destination node ID
    pub destination: String,
    /// Next hop node ID
    pub next_hop: String,
    /// Cost metric (lower is better)
    pub cost: f64,
    /// Number of hops to destination
    pub hop_count: u8,
    /// Last update timestamp
    pub last_update: u64,
}

/// Routing table with multi-hop capability
#[derive(Debug)]
pub struct RoutingTable {
    /// Local node ID
    node_id: String,
    /// Routes: destination -> RouteEntry
    routes: HashMap<String, RouteEntry>,
    /// Direct neighbors with their link quality
    neighbors: HashMap<String, LinkQuality>,
    /// Maximum route age before considered stale (milliseconds)
    max_route_age_ms: u64,
}

/// Link quality metrics for a neighbor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkQuality {
    /// Signal-to-Noise Ratio (dB)
    pub snr_db: f64,
    /// Trust score (0.0 to 1.0)
    pub trust_score: f64,
    /// Latency in milliseconds
    pub latency_ms: u64,
    /// Packet Error Rate (0.0 to 1.0)
    pub packet_error_rate: f64,
    /// Last measurement timestamp
    pub last_measured: u64,
}

impl LinkQuality {
    /// Calculate routing cost based on link quality
    pub fn compute_cost(&self) -> f64 {
        // Cost formula: inverse of quality metrics
        // Lower SNR, lower trust, higher latency, higher PER = higher cost
        let snr_factor = if self.snr_db > 0.0 {
            1.0 / (1.0 + self.snr_db)
        } else {
            10.0
        };
        let trust_factor = 1.0 / (0.1 + self.trust_score);
        let latency_factor = (self.latency_ms as f64) / 100.0;
        let per_factor = 1.0 + (self.packet_error_rate * 10.0);

        snr_factor + trust_factor + latency_factor + per_factor
    }
}

impl RoutingTable {
    /// Create a new routing table
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            routes: HashMap::new(),
            neighbors: HashMap::new(),
            max_route_age_ms: 30000, // 30 seconds
        }
    }

    /// Update or add a neighbor with link quality
    pub fn update_neighbor(&mut self, neighbor_id: String, link_quality: LinkQuality) {
        self.neighbors
            .insert(neighbor_id.clone(), link_quality.clone());

        // Update direct route
        let cost = link_quality.compute_cost();
        self.routes.insert(
            neighbor_id.clone(),
            RouteEntry {
                destination: neighbor_id.clone(),
                next_hop: neighbor_id,
                cost,
                hop_count: 1,
                last_update: current_timestamp(),
            },
        );
    }

    /// Remove a neighbor (link failed)
    pub fn remove_neighbor(&mut self, neighbor_id: &str) {
        self.neighbors.remove(neighbor_id);
        // Remove direct route
        self.routes.remove(neighbor_id);
        // Remove routes through this neighbor
        self.routes.retain(|_, route| route.next_hop != neighbor_id);
    }

    /// Update route from routing advertisement
    pub fn update_route(&mut self, route: RouteEntry) -> RouteUpdateResult {
        // Validate route
        if route.destination == self.node_id {
            return RouteUpdateResult::Rejected("Route to self".to_string());
        }

        // Check if neighbor exists
        if !self.neighbors.contains_key(&route.next_hop) {
            return RouteUpdateResult::Rejected("Next hop not a neighbor".to_string());
        }

        // Check if this is a better route
        if let Some(existing) = self.routes.get(&route.destination) {
            if route.cost >= existing.cost && route.last_update <= existing.last_update {
                return RouteUpdateResult::Ignored;
            }
        }

        let is_new = !self.routes.contains_key(&route.destination);
        self.routes.insert(route.destination.clone(), route);

        if is_new {
            RouteUpdateResult::NewRoute
        } else {
            RouteUpdateResult::UpdatedRoute
        }
    }

    /// Find the next hop for a destination
    pub fn find_next_hop(&self, destination: &str) -> Option<String> {
        // Check for stale routes
        let now = current_timestamp();
        self.routes
            .get(destination)
            .filter(|route| (now - route.last_update) <= self.max_route_age_ms)
            .map(|route| route.next_hop.clone())
    }

    /// Get all valid routes
    pub fn get_routes(&self) -> Vec<&RouteEntry> {
        let now = current_timestamp();
        self.routes
            .values()
            .filter(|route| (now - route.last_update) <= self.max_route_age_ms)
            .collect()
    }

    /// Prune stale routes
    pub fn prune_stale_routes(&mut self) -> usize {
        let now = current_timestamp();
        let initial_count = self.routes.len();

        self.routes
            .retain(|_, route| (now - route.last_update) <= self.max_route_age_ms);

        initial_count - self.routes.len()
    }

    /// Check if a node is a direct neighbor
    pub fn is_neighbor(&self, node_id: &str) -> bool {
        self.neighbors.contains_key(node_id)
    }

    /// Get neighbor link quality
    pub fn get_neighbor_link_quality(&self, node_id: &str) -> Option<&LinkQuality> {
        self.neighbors.get(node_id)
    }

    /// Detect if rerouting is needed due to link degradation
    pub fn needs_reroute(&self, destination: &str, per_threshold: f64) -> bool {
        if let Some(route) = self.routes.get(destination) {
            if let Some(link_quality) = self.neighbors.get(&route.next_hop) {
                return link_quality.packet_error_rate > per_threshold;
            }
        }
        false
    }
}

/// Result of route update
#[derive(Debug, PartialEq)]
pub enum RouteUpdateResult {
    /// New route added
    NewRoute,
    /// Existing route updated
    UpdatedRoute,
    /// Route ignored (not better than existing)
    Ignored,
    /// Route rejected (invalid)
    Rejected(String),
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

    fn create_test_link_quality() -> LinkQuality {
        LinkQuality {
            snr_db: 20.0,
            trust_score: 0.9,
            latency_ms: 50,
            packet_error_rate: 0.01,
            last_measured: current_timestamp(),
        }
    }

    #[test]
    fn test_routing_table_creation() {
        let table = RoutingTable::new("node1".to_string());
        assert_eq!(table.node_id, "node1");
        assert_eq!(table.routes.len(), 0);
    }

    #[test]
    fn test_update_neighbor() {
        let mut table = RoutingTable::new("node1".to_string());
        let link_quality = create_test_link_quality();

        table.update_neighbor("node2".to_string(), link_quality);

        assert!(table.is_neighbor("node2"));
        assert!(table.find_next_hop("node2").is_some());
    }

    #[test]
    fn test_remove_neighbor() {
        let mut table = RoutingTable::new("node1".to_string());
        table.update_neighbor("node2".to_string(), create_test_link_quality());

        table.remove_neighbor("node2");

        assert!(!table.is_neighbor("node2"));
        assert!(table.find_next_hop("node2").is_none());
    }

    #[test]
    fn test_multi_hop_routing() {
        let mut table = RoutingTable::new("node1".to_string());

        // Add neighbor node2
        table.update_neighbor("node2".to_string(), create_test_link_quality());

        // Add route to node3 via node2
        let route = RouteEntry {
            destination: "node3".to_string(),
            next_hop: "node2".to_string(),
            cost: 2.0,
            hop_count: 2,
            last_update: current_timestamp(),
        };

        let result = table.update_route(route);
        assert_eq!(result, RouteUpdateResult::NewRoute);

        // Should route to node3 via node2
        assert_eq!(table.find_next_hop("node3").unwrap(), "node2");
    }

    #[test]
    fn test_reject_route_to_self() {
        let mut table = RoutingTable::new("node1".to_string());

        let route = RouteEntry {
            destination: "node1".to_string(),
            next_hop: "node2".to_string(),
            cost: 1.0,
            hop_count: 1,
            last_update: current_timestamp(),
        };

        match table.update_route(route) {
            RouteUpdateResult::Rejected(_) => {}
            _ => panic!("Expected Rejected"),
        }
    }

    #[test]
    fn test_reject_route_through_non_neighbor() {
        let mut table = RoutingTable::new("node1".to_string());

        let route = RouteEntry {
            destination: "node3".to_string(),
            next_hop: "node2".to_string(), // node2 is not a neighbor
            cost: 1.0,
            hop_count: 2,
            last_update: current_timestamp(),
        };

        match table.update_route(route) {
            RouteUpdateResult::Rejected(_) => {}
            _ => panic!("Expected Rejected"),
        }
    }

    #[test]
    fn test_cost_calculation() {
        let good_link = LinkQuality {
            snr_db: 30.0,
            trust_score: 0.95,
            latency_ms: 20,
            packet_error_rate: 0.001,
            last_measured: current_timestamp(),
        };

        let bad_link = LinkQuality {
            snr_db: 5.0,
            trust_score: 0.5,
            latency_ms: 200,
            packet_error_rate: 0.1,
            last_measured: current_timestamp(),
        };

        assert!(good_link.compute_cost() < bad_link.compute_cost());
    }

    #[test]
    fn test_needs_reroute_on_high_per() {
        let mut table = RoutingTable::new("node1".to_string());

        let bad_link = LinkQuality {
            snr_db: 10.0,
            trust_score: 0.8,
            latency_ms: 50,
            packet_error_rate: 0.3, // High PER
            last_measured: current_timestamp(),
        };

        table.update_neighbor("node2".to_string(), bad_link);

        assert!(table.needs_reroute("node2", 0.2));
    }

    #[test]
    fn test_prune_stale_routes() {
        let mut table = RoutingTable::new("node1".to_string());
        table.max_route_age_ms = 1000; // 1 second

        table.update_neighbor("node2".to_string(), create_test_link_quality());

        // Make route stale
        if let Some(route) = table.routes.get_mut("node2") {
            route.last_update = current_timestamp() - 2000;
        }

        let pruned = table.prune_stale_routes();
        assert_eq!(pruned, 1);
        assert_eq!(table.routes.len(), 0);
    }
}
