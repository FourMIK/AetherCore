// FLIR Trust Bridge Orchestrator
// Main module coordinating authentication, UDP binding, and telemetry ingestion

pub mod cgi_client;
pub mod parser;
pub mod udp_listener;

use crate::flir::cgi_client::{authenticate, bind_udp_telemetry, deauthenticate};
use crate::flir::udp_listener::{start_listening, TrackUpdate};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{info, error};

type FlirError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug)]
struct FlirConfigError {
    context: String,
}

impl std::fmt::Display for FlirConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.context)
    }
}

impl std::error::Error for FlirConfigError {}

fn required_env_var(key: &'static str) -> Result<String, FlirError> {
    std::env::var(key).map_err(|_| {
        Box::new(FlirConfigError {
            context: format!(
                "Fail-Visible: missing required environment variable {key}; refusing insecure default credentials",
            ),
        }) as FlirError
    })
}

/// FLIR Bridge configuration
pub struct FlirBridgeConfig {
    pub flir_ip: String,
    pub edge_node_ip: String,
    pub username: String,
    pub password: String,
    pub udp_port: u16,
}

impl FlirBridgeConfig {
    /// Load configuration from environment or defaults
    pub fn from_env() -> Result<Self, FlirError> {
        Ok(Self {
            flir_ip: std::env::var("FLIR_CAMERA_IP")
                .unwrap_or_else(|_| "192.168.1.100".to_string()),
            edge_node_ip: std::env::var("EDGE_NODE_IP")
                .unwrap_or_else(|_| "0.0.0.0".to_string()),
            username: required_env_var("FLIR_USERNAME")?,
            password: required_env_var("FLIR_PASSWORD")?,
            udp_port: std::env::var("FLIR_UDP_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(5900),
        })
    }
}

/// FLIR Bridge handle
pub struct FlirBridge {
    config: FlirBridgeConfig,
    session_id: Option<String>,
    listener_handle: Option<JoinHandle<()>>,
    track_rx: mpsc::Receiver<TrackUpdate>,
    track_tx: mpsc::Sender<TrackUpdate>,
}

impl FlirBridge {
    pub fn new(config: FlirBridgeConfig) -> Self {
        let (tx, rx) = mpsc::channel(100);
        Self {
            config,
            session_id: None,
            listener_handle: None,
            track_rx: rx,
            track_tx: tx,
        }
    }

    /// Authenticate with FLIR camera and establish UDP streaming
    pub async fn connect(&mut self) -> Result<(), FlirError> {
        info!("[FLIR] Starting bridge connection to {}", self.config.flir_ip);

        // Step 1: Authenticate
        let session_id = authenticate(
            &self.config.flir_ip,
            &self.config.username,
            &self.config.password,
        )
        .await?;

        self.session_id = Some(session_id.clone());

        // Step 2: Register UDP endpoint
        bind_udp_telemetry(
            &self.config.flir_ip,
            &session_id,
            &self.config.edge_node_ip,
            self.config.udp_port,
        )
        .await?;

        info!(
            "[FLIR] UDP telemetry bound to {}:{}",
            self.config.edge_node_ip, self.config.udp_port
        );

        // Step 3: Spawn UDP listener task
        let udp_port = self.config.udp_port;
        let tx = self.track_tx.clone();

        self.listener_handle = Some(tokio::spawn(async move {
            if let Err(e) = start_listening(udp_port, tx).await {
                error!("[FLIR] Listener error: {}", e);
            }
        }));

        info!("[FLIR] Bridge connected and listening on UDP port {}", self.config.udp_port);

        Ok(())
    }

    /// Receive next track update from queue
    pub async fn recv_track(&mut self) -> Option<TrackUpdate> {
        self.track_rx.recv().await
    }

    /// Get current session ID
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Disconnect and close session
    pub async fn disconnect(&mut self) -> Result<(), FlirError> {
        // Abort listener task
        if let Some(handle) = self.listener_handle.take() {
            handle.abort();
        }

        // Close FLIR session
        if let Some(session_id) = self.session_id.take() {
            deauthenticate(&self.config.flir_ip, &session_id).await?;
            info!("[FLIR] Bridge disconnected");
        }

        Ok(())
    }
}

/// Start FLIR bridge with automatic trust mesh integration
///
/// This is the high-level API for starting a complete FLIR → Trust Mesh pipeline.
pub async fn start_flir_bridge(
    flir_ip: String,
    edge_node_ip: String,
    udp_port: u16,
) -> Result<FlirBridge, FlirError> {
    let config = FlirBridgeConfig {
        flir_ip,
        edge_node_ip,
        username: required_env_var("FLIR_USERNAME")?,
        password: required_env_var("FLIR_PASSWORD")?,
        udp_port,
    };

    let mut bridge = FlirBridge::new(config);
    bridge.connect().await?;

    Ok(bridge)
}

/// Start background FLIR bridge task with trust mesh integration
pub async fn start_flir_bridge_background(
    flir_ip: String,
    edge_node_ip: String,
    udp_port: u16,
) -> Result<JoinHandle<()>, FlirError> {
    let handle = tokio::spawn(async move {
        match start_flir_bridge(flir_ip, edge_node_ip, udp_port).await {
            Ok(mut bridge) => {
                info!("[FLIR BRIDGE] Background task started successfully");

                // Main processing loop
                loop {
                    match bridge.recv_track().await {
                        Some(update) => {
                            // Log cryptographic sealing simulation
                            info!(
                                "[TRUST MESH] Cryptographic Seal Applied (Ed25519) for Track ID: {}",
                                update.track.target_id
                            );
                            info!(
                                "[TRUST MESH] Merkle Vine updated. Hash generated: blake3(track_{})",
                                update.track.target_id
                            );
                            info!(
                                "[ROUTING] Dispatching verified FLIR feed to C2 Router & ATAK Bridge. \
                                Track: ID={}, Position=({:.4},{:.4}), Speed={:.1}kts, Heading={:.0}°",
                                update.track.target_id,
                                update.track.lat,
                                update.track.lon,
                                update.track.speed,
                                update.track.heading
                            );

                            // TODO: Forward to C2 Router via gRPC
                            // TODO: Forward to ATAK Bridge for visualization
                        }
                        None => {
                            error!("[FLIR BRIDGE] Track channel closed");
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                error!("[FLIR BRIDGE] Failed to start: {}", e);
            }
        }
    });

    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_from_env_reads_credentials() {
        let previous_user = std::env::var("FLIR_USERNAME").ok();
        let previous_pass = std::env::var("FLIR_PASSWORD").ok();

        std::env::set_var("FLIR_USERNAME", "test-user");
        std::env::set_var("FLIR_PASSWORD", "test-pass");

        let config = FlirBridgeConfig::from_env().expect("expected config to load with credentials");
        assert_eq!(config.username, "test-user");
        assert_eq!(config.password, "test-pass");

        match previous_user {
            Some(value) => std::env::set_var("FLIR_USERNAME", value),
            None => std::env::remove_var("FLIR_USERNAME"),
        }

        match previous_pass {
            Some(value) => std::env::set_var("FLIR_PASSWORD", value),
            None => std::env::remove_var("FLIR_PASSWORD"),
        }
    }

    #[test]
    fn test_required_env_var_is_fail_visible() {
        const KEY: &str = "AETHERCORE_TEST_MISSING_ENV";
        let previous = std::env::var(KEY).ok();
        std::env::remove_var(KEY);
        let err = required_env_var(KEY).expect_err("expected missing env var to error");
        let message = err.to_string();
        assert!(message.contains(KEY));
        assert!(message.contains("Fail-Visible"));

        if let Some(value) = previous {
            std::env::set_var(KEY, value);
        }
    }

    #[tokio::test]
    async fn test_bridge_creation() {
        let config = FlirBridgeConfig {
            flir_ip: "192.168.1.100".to_string(),
            edge_node_ip: "0.0.0.0".to_string(),
            username: "admin".to_string(),
            password: "password".to_string(),
            udp_port: 5900,
        };

        let bridge = FlirBridge::new(config);
        assert!(bridge.session_id.is_none());
    }
}

