//! FLIR UDP Telemetry Stream Listener
//!
//! This module implements a real-time UDP receiver for FLIR Nexus camera telemetry.
//! It listens for NMEA-0183 formatted track data and forwards parsed tracks to the
//! AetherCore Trust Mesh for cryptographic sealing and distribution.
//!
//! # Network Architecture
//! - Binds to 0.0.0.0:<port> to accept telemetry from any FLIR device
//! - Uses a non-blocking async I/O model for high-throughput ingestion
//! - Implements graceful degradation in contested/congested network conditions
//!
//! # Data Flow
//! FLIR Device → UDP Socket → NMEA Parser → Cryptographic Seal → Trust Mesh → C2 Router

use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::parser::{parse_track_nmea, FlirTrack};

/// Maximum UDP datagram size for FLIR telemetry
/// NMEA-0183 messages are typically < 200 bytes, but we allocate extra headroom
const MAX_DATAGRAM_SIZE: usize = 2048;

/// Channel buffer size for parsed tracks awaiting dispatch
const TRACK_CHANNEL_SIZE: usize = 100;

/// Start listening for FLIR UDP telemetry on the specified bind address and port
///
/// This function creates a UDP socket and continuously receives telemetry datagrams
/// from FLIR devices. Valid track messages are parsed and sent to the provided channel
/// for cryptographic processing and mesh distribution.
///
/// # Arguments
/// * `bind_address` - IP address to bind (e.g., "0.0.0.0" for all interfaces, or specific IP for isolation)
/// * `port` - UDP port to bind (typically 5000 for FLIR telemetry)
/// * `track_tx` - Channel sender for forwarding parsed tracks
///
/// # Behavior
/// - Binds to <bind_address>:<port> to control interface exposure
/// - Runs indefinitely until the channel is closed or a fatal error occurs
/// - Invalid/corrupt datagrams are logged and discarded (Fail-Visible)
/// - Non-TRACK NMEA messages are ignored
///
/// # Error Handling
/// Socket bind failures are fatal and return immediately. Individual datagram
/// receive/parse errors are logged but do not stop the listener (resilience).
///
/// # Example
/// ```ignore
/// let (tx, rx) = mpsc::channel(100);
/// tokio::spawn(start_listening("0.0.0.0", 5000, tx));
/// ```
pub async fn start_listening(
    bind_address: &str,
    port: u16,
    track_tx: mpsc::Sender<FlirTrack>,
) -> Result<(), Box<dyn std::error::Error>> {
    let bind_addr = format!("{}:{}", bind_address, port);
    
    info!("[FLIR UDP] Binding listener to {}", bind_addr);
    
    // Bind UDP socket
    let socket = UdpSocket::bind(&bind_addr).await.map_err(|e| {
        error!("[FLIR UDP] Failed to bind socket: {}", e);
        e
    })?;
    
    info!("[FLIR UDP] Listener active on port {}", port);
    info!("[FLIR UDP] Awaiting telemetry from FLIR Nexus cameras...");
    
    let socket = Arc::new(socket);
    let mut buffer = vec![0u8; MAX_DATAGRAM_SIZE];
    
    // Main receive loop
    loop {
        // Receive datagram
        let (len, peer_addr) = match socket.recv_from(&mut buffer).await {
            Ok((len, addr)) => (len, addr),
            Err(e) => {
                error!("[FLIR UDP] Receive error: {}", e);
                // Continue listening despite errors (contested network resilience)
                continue;
            }
        };
        
        debug!("[FLIR UDP] Received {} bytes from {}", len, peer_addr);
        
        // Convert to string (NMEA is ASCII text)
        let datagram_str = String::from_utf8_lossy(&buffer[..len]);
        
        // Process each line in the datagram (may contain multiple NMEA sentences)
        for line in datagram_str.lines() {
            let trimmed = line.trim();
            
            // Filter for TRACK messages only
            if !trimmed.starts_with("$TRACK") {
                debug!("[FLIR UDP] Ignoring non-TRACK message: {}", trimmed);
                continue;
            }
            
            debug!("[FLIR UDP] Processing TRACK message: {}", trimmed);
            
            // Parse the NMEA track message
            match parse_track_nmea(trimmed) {
                Some(track) => {
                    info!(
                        "[FLIR UDP] Parsed track ID {} from {}: Lat={:.6}, Lon={:.6}",
                        track.target_id, peer_addr, track.latitude, track.longitude
                    );
                    
                    // Send to processing channel
                    if let Err(e) = track_tx.send(track).await {
                        error!("[FLIR UDP] Failed to send track to processor: {}", e);
                        // Channel closed - listener should terminate
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::BrokenPipe,
                            "Track processing channel closed",
                        )));
                    }
                }
                None => {
                    warn!("[FLIR UDP] Failed to parse TRACK message: {}", trimmed);
                    // Continue processing (Fail-Visible: log but don't crash)
                }
            }
        }
    }
}

/// Start listening for FLIR UDP telemetry with a callback handler
///
/// Alternative interface that accepts a callback function for each parsed track.
/// Useful for simple integrations that don't require explicit channel management.
///
/// # Arguments
/// * `bind_address` - IP address to bind
/// * `port` - UDP port to bind
/// * `handler` - Async callback invoked for each successfully parsed track
///
/// # Example
/// ```ignore
/// start_listening_with_handler("0.0.0.0", 5000, |track| async move {
///     println!("Track: {}", track.target_id);
/// }).await?;
/// ```
pub async fn start_listening_with_handler<F, Fut>(
    bind_address: &str,
    port: u16,
    handler: F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: Fn(FlirTrack) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    let (tx, mut rx) = mpsc::channel(TRACK_CHANNEL_SIZE);
    
    let bind_address = bind_address.to_string();
    // Spawn listener task
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = start_listening(&bind_address, port, tx).await {
            error!("[FLIR UDP] Listener task failed: {}", e);
        }
    });
    
    // Process tracks with handler
    while let Some(track) = rx.recv().await {
        handler(track).await;
    }
    
    // Await listener completion
    listener_handle.await?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_channel_creation() {
        let (tx, _rx) = mpsc::channel::<FlirTrack>(TRACK_CHANNEL_SIZE);
        assert_eq!(tx.capacity(), TRACK_CHANNEL_SIZE);
    }
    
    // Note: Full integration tests for UDP sockets require network mocking
    // and are better suited for the integration test suite
}
