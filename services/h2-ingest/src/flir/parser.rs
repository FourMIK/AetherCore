// FLIR NMEA-0183 Track Parser
// Decodes telemetry data from Teledyne Ranger HD cameras

use tracing::{info, warn};

/// Parsed track from NMEA-0183 data
#[derive(Clone, Debug)]
pub struct FlirTrack {
    pub target_id: u32,
    pub lat: f64,
    pub lon: f64,
    pub speed: f64,
    pub heading: f64,
    pub timestamp: Option<String>,
}

impl FlirTrack {
    /// Convert geographic coordinates to tuple format
    pub fn geo_tuple(&self) -> (f64, f64) {
        (self.lat, self.lon)
    }

    /// Verify basic track validity
    pub fn is_valid(&self) -> bool {
        self.lat >= -90.0
            && self.lat <= 90.0
            && self.lon >= -180.0
            && self.lon <= 180.0
            && self.speed >= 0.0
            && self.heading >= 0.0
            && self.heading < 360.0
    }
}

/// Parse NMEA-0183 TRACK sentence from Teledyne FLIR
///
/// Expected format:
/// `$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF`
///
/// Fields:
/// 0: Message ID ($TRACK)
/// 1: Target ID (numeric)
/// 2: Latitude (DDMM.SS)
/// 3: Latitude Direction (N/S)
/// 4: Longitude (DDDMM.SS)
/// 5: Longitude Direction (E/W)
/// 6: Reserved
/// 7: Reserved
/// 8: Speed (knots)
/// 9: Heading (degrees)
/// 10: Date (YYMMDD)
/// 11: Time (HHMMSS)
/// 12: Checksum (HH)
pub fn parse_track_nmea(nmea: &str) -> Option<FlirTrack> {
    let parts: Vec<&str> = nmea.trim().split(',').collect();

    if parts.len() < 10 {
        warn!(
            "[FLIR] Invalid NMEA sentence length: {} fields (expected >= 10)",
            parts.len()
        );
        return None;
    }

    // Validate sentence starts with $TRACK
    if !parts[0].starts_with("$TRACK") {
        warn!("[FLIR] Not a TRACK sentence: {}", parts[0]);
        return None;
    }

    // Parse Target ID
    let target_id = parts[1].parse::<u32>().ok()?;

    // Parse Latitude
    let lat_str = parts[2];
    let lat_dir = parts[3];
    let lat = parse_coordinate(lat_str, lat_dir)?;

    // Parse Longitude
    let lon_str = parts[4];
    let lon_dir = parts[5];
    let lon = parse_coordinate(lon_str, lon_dir)?;

    // Parse Speed (knots)
    let speed = parts[8].parse::<f64>().unwrap_or(0.0);

    // Parse Heading (degrees)
    let heading = parts[9]
        .split('*')
        .next()
        .unwrap_or("")
        .parse::<f64>()
        .unwrap_or(0.0);

    // Optional timestamp from fields 10 and 11
    let timestamp = if parts.len() >= 12 {
        Some(format!("{} {}", parts[10], parts[11]))
    } else {
        None
    };

    let track = FlirTrack {
        target_id,
        lat,
        lon,
        speed,
        heading,
        timestamp,
    };

    if !track.is_valid() {
        warn!("[FLIR] Parsed track failed validation: {:?}", track);
        return None;
    }

    info!(
        "[FLIR] Parsed track ID={}, pos=({:.4},{:.4}), spd={:.1}kts, hdg={:.0}°",
        target_id, lat, lon, speed, heading
    );

    Some(track)
}

/// Convert NMEA geographic coordinate to decimal degrees
///
/// Input format: DDMM.SS (or DDDMM.SS for longitude)
/// Returns: Signed decimal degrees (negative for S/W)
fn parse_coordinate(coord_str: &str, direction: &str) -> Option<f64> {
    let coord_str = coord_str.trim();

    // Determine if this is latitude (2 degree digits) or longitude (3 degree digits)
    let degree_digits = if coord_str.len() <= 7 { 2 } else { 3 };

    let degrees_str = &coord_str[..degree_digits];
    let minutes_str = &coord_str[degree_digits..];

    let degrees = degrees_str.parse::<f64>().ok()?;
    let minutes = minutes_str.parse::<f64>().ok()?;

    let mut decimal = degrees + (minutes / 60.0);

    // Apply direction sign
    if direction == "S" || direction == "W" {
        decimal = -decimal;
    }

    Some(decimal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_track_nmea() {
        let nmea = "$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF";
        let track = parse_track_nmea(nmea).expect("Failed to parse valid NMEA");

        assert_eq!(track.target_id, 1);
        assert!((track.lat - 53.7520).abs() < 0.001);
        assert!((track.lon - (-2.2390)).abs() < 0.001);
        assert!((track.speed - 12.5).abs() < 0.001);
        assert!((track.heading - 45.0).abs() < 0.001);
    }

    #[test]
    fn test_invalid_nmea_length() {
        let nmea = "$TRACK,1,05345.12,N";
        assert!(parse_track_nmea(nmea).is_none());
    }

    #[test]
    fn test_invalid_target_id() {
        let nmea = "$TRACK,invalid,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF";
        assert!(parse_track_nmea(nmea).is_none());
    }
}

