// FLIR UDP Telemetry Listener
// Receives and processes NMEA-0183 track data from Teledyne cameras

use tokio::net::UdpSocket;
use tracing::{info, error, warn};
use crate::flir::parser::{parse_track_nmea, FlirTrack};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Message type for track updates
#[derive(Clone, Debug)]
pub struct TrackUpdate {
    pub track: FlirTrack,
    pub received_at: chrono::DateTime<chrono::Utc>,
}

/// Start UDP listener for FLIR telemetry
///
/// Binds to 0.0.0.0:<port> and listens for NMEA-0183 TRACK sentences.
/// Parses valid tracks and sends them to the provided channel.
pub async fn start_listening(
    port: u16,
    tx: mpsc::Sender<TrackUpdate>,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("0.0.0.0:{}", port);
    let socket = UdpSocket::bind(&addr).await?;
    let socket = Arc::new(socket);

    info!("[FLIR] UDP listener bound to {}", addr);

    loop {
        let mut buffer = vec![0u8; 4096];
        let socket_clone = Arc::clone(&socket);
        let tx_clone = tx.clone();

        match socket_clone.recv(&mut buffer).await {
            Ok(n) => {
                // Convert buffer to string
                match String::from_utf8(buffer[..n].to_vec()) {
                    Ok(payload) => {
                        // Check if this looks like a TRACK sentence
                        if payload.contains("$TRACK") {
                            // Try to parse each line (may be multiple sentences)
                            for line in payload.lines() {
                                if line.starts_with("$TRACK") {
                                    match parse_track_nmea(line) {
                                        Some(track) => {
                                            let update = TrackUpdate {
                                                track: track.clone(),
                                                received_at: chrono::Utc::now(),
                                            };

                                            info!(
                                                "[FLIR] Ingesting Track ID: {} at ({:.4}, {:.4})",
                                                track.target_id, track.lat, track.lon
                                            );

                                            // Send to channel
                                            if let Err(e) = tx_clone.send(update).await {
                                                error!("[FLIR] Failed to send track update: {}", e);
                                            }
                                        }
                                        None => {
                                            warn!("[FLIR] Failed to parse TRACK sentence: {}", line);
                                        }
                                    }
                                }
                            }
                        } else {
                            warn!("[FLIR] Received non-TRACK UDP data: {}",
                                String::from_utf8_lossy(&buffer[..n.min(100)]));
                        }
                    }
                    Err(e) => {
                        error!("[FLIR] Failed to decode UDP payload as UTF-8: {}", e);
                    }
                }
            }
            Err(e) => {
                error!("[FLIR] UDP socket error: {}", e);
                break;
            }
        }
    }
}

/// Get UDP socket for custom handling
pub async fn create_socket(port: u16) -> Result<Arc<UdpSocket>, Box<dyn std::error::Error>> {
    let addr = format!("0.0.0.0:{}", port);
    let socket = UdpSocket::bind(&addr).await?;
    info!("[FLIR] UDP socket created on {}", addr);
    Ok(Arc::new(socket))
}

