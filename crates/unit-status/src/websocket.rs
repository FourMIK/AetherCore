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
    Ack { message: String },
}

/// Mesh health message format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshHealthMessage {
    pub node_id: String,
    pub status: String, // "HEALTHY", "DEGRADED", "COMPROMISED", "UNKNOWN"
    pub trust_score: f32,
    pub last_seen_ns: u64,
    pub metrics: HealthMetrics,
}

/// Health metrics from trust_mesh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthMetrics {
    pub root_agreement_ratio: f64,
    pub chain_break_count: u64,
    pub signature_failure_count: u64,
}

/// Revocation certificate (matches docs/trust-mesh-design.md)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevocationCertificate {
    pub node_id: String,
    pub revocation_reason: RevocationReason,
    pub issuer_id: String,
    pub timestamp_ns: u64,
    pub signature: String, // Hex-encoded Ed25519 signature
    pub merkle_root: String, // Hex-encoded BLAKE3 root
}

/// Revocation reasons
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RevocationReason {
    AttestationFailure,
    ByzantineDetection,
    OperatorOverride,
    IdentityCollapse,
}

/// WebSocket server state
pub struct WsServer {
    /// Broadcast channel for mesh health updates
    health_tx: broadcast::Sender<WsMessage>,
    
    /// Active node statuses
    node_statuses: Arc<RwLock<HashMap<String, UnitStatus>>>,
    
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
        // Store status
        {
            let mut statuses = self.node_statuses.write().await;
            statuses.insert(status.platform_id.id.clone(), status.clone());
        }
        
        // Broadcast health update
        // TODO: Integrate with trust_mesh NodeHealthComputer to get real metrics
        let health_msg = WsMessage::MeshHealth(MeshHealthMessage {
            node_id: status.platform_id.id.clone(),
            status: format!("{:?}", Self::map_trust_to_health(status.trust_score)),
            trust_score: status.trust_score,
            last_seen_ns: status.last_seen_ns,
            metrics: HealthMetrics {
                root_agreement_ratio: 0.95, // TODO: Get from trust_mesh::NodeHealthComputer
                chain_break_count: 0,        // TODO: Get from trust_mesh::NodeHealthComputer
                signature_failure_count: 0,  // TODO: Get from trust_mesh::NodeHealthComputer
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
    
    /// Map trust score to health status
    fn map_trust_to_health(trust_score: f32) -> &'static str {
        if trust_score > 0.8 {
            "HEALTHY"
        } else if trust_score > 0.5 {
            "DEGRADED"
        } else if trust_score > 0.1 {
            "COMPROMISED"
        } else {
            "UNKNOWN"
        }
    }
    
    /// Get all active node statuses
    pub async fn get_all_statuses(&self) -> HashMap<String, UnitStatus> {
        self.node_statuses.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    
    #[tokio::test]
    async fn test_ws_server_creation() {
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let server = WsServer::new(addr);
        
        assert_eq!(server.addr, addr);
    }
    
    #[tokio::test]
    async fn test_map_trust_to_health() {
        assert_eq!(WsServer::map_trust_to_health(0.9), "HEALTHY");
        assert_eq!(WsServer::map_trust_to_health(0.6), "DEGRADED");
        assert_eq!(WsServer::map_trust_to_health(0.3), "COMPROMISED");
        assert_eq!(WsServer::map_trust_to_health(0.05), "UNKNOWN");
    }
}
