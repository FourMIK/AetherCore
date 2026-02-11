//! WebSocket Server for Real-Time Mesh Health Telemetry
//!
//! Provides WSS endpoint for Tactical Glass dashboard to receive:
//! - Node health updates (1 Hz normal, 10 Hz during Aetheric Sweep)
//! - Revocation certificates (Great Gospel propagation)
//! - Byzantine detection alerts

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tracing::{error, info, warn};

use aethercore_trust_mesh::node_health::NodeHealthComputer;
use crate::types::UnitStatus;

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    /// Node health update
    #[serde(rename = "mesh_health")]
    MeshHealth(MeshHealthMessage),

    /// Revocation certificate (Aetheric Sweep)
    #[serde(rename = "revocation")]
    Revocation(RevocationCertificate),

    /// Connection acknowledgment
    #[serde(rename = "ack")]
    Ack {
        /// Human-readable status message
        message: String,
    },
}

/// Mesh health message format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshHealthMessage {
    /// Node identifier
    pub node_id: String,
    /// Mesh health state (HEALTHY, DEGRADED, COMPROMISED, UNKNOWN)
    pub status: String,
    /// Trust score emitted by trust mesh
    pub trust_score: f32,
    /// Last time the node was seen (ns)
    pub last_seen_ns: u64,
    /// Health metrics bundle
    pub metrics: HealthMetrics,
}

/// Health metrics from trust_mesh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthMetrics {
    /// Ratio of root hash agreement across nodes
    pub root_agreement_ratio: f64,
    /// Count of detected chain breaks
    pub chain_break_count: u64,
    /// Count of signature failures
    pub signature_failure_count: u64,
}

/// Revocation certificate (matches docs/trust-mesh-design.md)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevocationCertificate {
    /// Node being revoked
    pub node_id: String,
    /// Reason for revocation
    pub revocation_reason: RevocationReason,
    /// Authority issuing revocation
    pub issuer_id: String,
    /// Timestamp in nanoseconds
    pub timestamp_ns: u64,
    /// Hex-encoded Ed25519 signature
    pub signature: String,
    /// Hex-encoded BLAKE3 Merkle root
    pub merkle_root: String,
}

/// Revocation reasons
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RevocationReason {
    /// TPM attestation failed
    AttestationFailure,
    /// Byzantine detection triggered
    ByzantineDetection,
    /// Operator initiated override
    OperatorOverride,
    /// Duplicate or conflicting identity observed
    IdentityCollapse,
}

/// WebSocket server state
pub struct WsServer {
    /// Broadcast channel for mesh health updates
    health_tx: broadcast::Sender<WsMessage>,

    /// Active node statuses
    node_statuses: Arc<RwLock<HashMap<String, UnitStatus>>>,

    /// Node health computer for real-time integrity metrics
    health_computer: Arc<NodeHealthComputer>,

    /// Server address
    addr: SocketAddr,
}

impl WsServer {
    /// Create new WebSocket server
    pub fn new(addr: SocketAddr) -> Self {
        let (health_tx, _) = broadcast::channel(1000);

        Self {
            health_tx,
            node_statuses: Arc::new(RwLock::new(HashMap::new())),
            health_computer: Arc::new(NodeHealthComputer::new()),
            addr,
        }
    }

    /// Create new WebSocket server with custom health computer
    pub fn with_health_computer(addr: SocketAddr, health_computer: NodeHealthComputer) -> Self {
        let (health_tx, _) = broadcast::channel(1000);

        Self {
            health_tx,
            node_statuses: Arc::new(RwLock::new(HashMap::new())),
            health_computer: Arc::new(health_computer),
            addr,
        }
    }

    /// Start the WebSocket server
    pub async fn run(self: Arc<Self>) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(self.addr).await?;
        info!("WebSocket server listening on {}", self.addr);

        loop {
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    info!("New WebSocket connection from {}", peer_addr);
                    let server = Arc::clone(&self);

                    tokio::spawn(async move {
                        if let Err(e) = server.handle_connection(stream, peer_addr).await {
                            error!("WebSocket connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to accept connection: {}", e);
                }
            }
        }
    }

    /// Handle individual WebSocket connection
    async fn handle_connection(
        &self,
        stream: TcpStream,
        peer_addr: SocketAddr,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let ws_stream = accept_async(stream).await?;
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // Send acknowledgment
        let ack = WsMessage::Ack {
            message: "Connected to AetherCore Mesh Health Feed".to_string(),
        };
        let ack_json = serde_json::to_string(&ack)?;
        ws_sender.send(Message::Text(ack_json)).await?;

        // Subscribe to health updates
        let mut health_rx = self.health_tx.subscribe();

        // Handle bidirectional communication
        loop {
            tokio::select! {
                // Receive messages from client
                Some(msg) = ws_receiver.next() => {
                    match msg {
                        Ok(Message::Text(text)) => {
                            info!("Received from {}: {}", peer_addr, text);
                        }
                        Ok(Message::Close(_)) => {
                            info!("Client {} disconnected", peer_addr);
                            break;
                        }
                        Err(e) => {
                            warn!("Error receiving from {}: {}", peer_addr, e);
                            break;
                        }
                        _ => {}
                    }
                }

                // Send health updates to client
                Ok(health_msg) = health_rx.recv() => {
                    let json = serde_json::to_string(&health_msg)?;
                    if let Err(e) = ws_sender.send(Message::Text(json)).await {
                        warn!("Error sending to {}: {}", peer_addr, e);
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    /// Update node status and broadcast to all connected clients
    pub async fn update_node_status(&self, status: UnitStatus) {
        let node_id = status.platform_id.id.clone();

        // Store status
        {
            let mut statuses = self.node_statuses.write().await;
            statuses.insert(node_id.clone(), status.clone());
        }

        // Get real integrity metrics from NodeHealthComputer
        let node_health = self.health_computer.get_node_health(&node_id);

        // Broadcast health update with real metrics
        let health_msg = WsMessage::MeshHealth(MeshHealthMessage {
            node_id: node_id.clone(),
            status: format!("{:?}", node_health.status),
            trust_score: status.trust_score,
            last_seen_ns: status.last_seen_ns,
            metrics: HealthMetrics {
                root_agreement_ratio: node_health.metrics.root_agreement_ratio,
                chain_break_count: node_health.metrics.chain_break_count,
                signature_failure_count: node_health.metrics.signature_failure_count,
            },
        });

        // Broadcast (ignore errors if no receivers)
        let _ = self.health_tx.send(health_msg);
    }

    /// Broadcast revocation certificate (Aetheric Sweep)
    pub async fn broadcast_revocation(&self, cert: RevocationCertificate) {
        let revocation_msg = WsMessage::Revocation(cert);

        // Broadcast (ignore errors if no receivers)
        let _ = self.health_tx.send(revocation_msg);
    }

    /// Get all active node statuses
    pub async fn get_all_statuses(&self) -> HashMap<String, UnitStatus> {
        self.node_statuses.read().await.clone()
    }

    /// Get the health computer for recording integrity events
    pub fn health_computer(&self) -> &Arc<NodeHealthComputer> {
        &self.health_computer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ws_server_creation() {
        let addr: SocketAddr = "127.0.0.1:8080".parse().expect("Failed to parse address");
        let server = WsServer::new(addr);

        assert_eq!(server.addr, addr);
    }
}
