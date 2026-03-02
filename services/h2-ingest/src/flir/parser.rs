//! FLIR NMEA-0183 Telemetry Parser
//!
//! This module parses standard FLIR Nexus camera telemetry data from NMEA-0183 formatted strings.
//! The parser extracts target tracking information including position, speed, and heading.
//!
//! # NMEA-0183 Format
//! FLIR tracking data follows the format:
//! `$TRACK,<target_id>,<lat>,<lat_dir>,<lon>,<lon_dir>,<reserved>,<reserved>,<speed>,<heading>,<date>,<time>*<checksum>`
//!
//! Example: `$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF`

use tracing::{debug, warn};

/// Represents a parsed FLIR target track
///
/// This structure contains the essential telemetry data extracted from a FLIR NMEA-0183 track message.
/// All coordinates are in decimal degrees, suitable for integration with the AetherCore Trust Mesh.
#[derive(Debug, Clone)]
pub struct FlirTrack {
    /// Unique identifier for the tracked target
    pub target_id: String,
    
    /// Latitude in decimal degrees (-90.0 to +90.0)
    pub latitude: f64,
    
    /// Longitude in decimal degrees (-180.0 to +180.0)
    pub longitude: f64,
    
    /// Ground speed in knots
    pub speed: f64,
    
    /// True heading in degrees (0-360)
    pub heading: f64,
}

/// Parse a FLIR NMEA-0183 track message into a FlirTrack structure
///
/// # Arguments
/// * `nmea` - The raw NMEA-0183 string from the FLIR device (must start with "$TRACK")
///
/// # Returns
/// * `Some(FlirTrack)` if parsing succeeds
/// * `None` if the input is invalid or cannot be parsed
///
/// # Example
/// ```ignore
/// let track = parse_track_nmea("$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF");
/// assert!(track.is_some());
/// ```
pub fn parse_track_nmea(nmea: &str) -> Option<FlirTrack> {
    // Verify this is a TRACK message
    if !nmea.starts_with("$TRACK") {
        warn!("Invalid NMEA prefix: expected $TRACK, got: {}", nmea);
        return None;
    }
    
    // Remove checksum if present (everything after '*')
    let data_part = if let Some(pos) = nmea.find('*') {
        &nmea[..pos]
    } else {
        nmea
    };
    
    // Split by comma and collect fields
    let fields: Vec<&str> = data_part.split(',').collect();
    
    // Verify minimum field count
    // Expected format: $TRACK,id,lat,lat_dir,lon,lon_dir,res1,res2,speed,heading,date,time
    if fields.len() < 11 {
        warn!("Insufficient NMEA fields: expected at least 11, got {}", fields.len());
        return None;
    }
    
    // Extract target ID (field 1)
    let target_id = fields[1].to_string();
    
    // Parse latitude (fields 2 & 3)
    // Format: DDMM.MM (degrees + decimal minutes)
    let lat_str = fields[2];
    let lat_dir = fields[3];
    let latitude = parse_coordinate(lat_str, lat_dir)?;
    
    // Parse longitude (fields 4 & 5)
    // Format: DDDMM.MM (degrees + decimal minutes)
    let lon_str = fields[4];
    let lon_dir = fields[5];
    let longitude = parse_coordinate(lon_str, lon_dir)?;
    
    // Parse speed (field 8)
    let speed = fields[8].parse::<f64>().ok()?;
    
    // Parse heading (field 9)
    let heading = fields[9].parse::<f64>().ok()?;
    
    debug!(
        "Parsed FLIR track: ID={}, Lat={:.6}, Lon={:.6}, Speed={:.2}kts, Heading={:.1}°",
        target_id, latitude, longitude, speed, heading
    );
    
    Some(FlirTrack {
        target_id,
        latitude,
        longitude,
        speed,
        heading,
    })
}

/// Convert NMEA coordinate format (DDMM.MM or DDDMM.MM) to decimal degrees
///
/// # Arguments
/// * `coord_str` - The coordinate string in NMEA format
/// * `direction` - Direction indicator ('N', 'S', 'E', or 'W')
///
/// # Returns
/// * `Some(f64)` - Decimal degrees with sign based on direction
/// * `None` - If parsing fails
fn parse_coordinate(coord_str: &str, direction: &str) -> Option<f64> {
    // Parse the coordinate string as a float
    let coord_val = coord_str.parse::<f64>().ok()?;
    
    // Validate coordinate format
    if coord_str.len() < 7 || !coord_str.contains('.') {
        warn!("Invalid coordinate format: {}", coord_str);
        return None;
    }
    
    // Extract degrees and minutes
    // Format is either DDMM.MM (latitude) or DDDMM.MM (longitude)
    let deg = (coord_val / 100.0).floor();
    let min = coord_val - (deg * 100.0);
    
    // Convert to decimal degrees
    let mut decimal_degrees = deg + (min / 60.0);
    
    // Apply direction (negative for South and West)
    if direction == "S" || direction == "W" {
        decimal_degrees = -decimal_degrees;
    }
    
    Some(decimal_degrees)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_valid_track() {
        let nmea = "$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF";
        let track = parse_track_nmea(nmea);
        
        assert!(track.is_some());
        let track = track.unwrap();
        assert_eq!(track.target_id, "1");
        assert!((track.latitude - 53.752).abs() < 0.001);
        assert!((track.longitude - (-2.239)).abs() < 0.001);
        assert_eq!(track.speed, 12.5);
        assert_eq!(track.heading, 45.0);
    }
    
    #[test]
    fn test_parse_without_checksum() {
        let nmea = "$TRACK,2,04530.00,S,17845.50,E,0,0,0.0,180.0,20260302,150600";
        let track = parse_track_nmea(nmea);
        
        assert!(track.is_some());
        let track = track.unwrap();
        assert_eq!(track.target_id, "2");
        assert!((track.latitude - (-45.5)).abs() < 0.001);
        assert!((track.longitude - 178.758).abs() < 0.001);
    }
    
    #[test]
    fn test_parse_invalid_prefix() {
        let nmea = "$GPGGA,123456.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47";
        let track = parse_track_nmea(nmea);
        assert!(track.is_none());
    }
    
    #[test]
    fn test_parse_insufficient_fields() {
        let nmea = "$TRACK,1,05345.12,N,00214.34";
        let track = parse_track_nmea(nmea);
        assert!(track.is_none());
    }
}
