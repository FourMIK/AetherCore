/**
 * AetherCore Canonical Event Schemas
 * 
 * TypeScript representation of the Rust canonical_event.rs domain model.
 * These schemas must stay synchronized with crates/domain/src/canonical_event.rs
 * 
 * Security Model:
 * - All events are Merkle Vine-linked via prev_hash
 * - BLAKE3 hashing for deterministic event hashes
 * - Ed25519 signatures for authenticity
 * - Fail-Visible: Invalid signatures = SPOOFED status
 */

/**
 * Event hash type (BLAKE3 hash as hex string)
 */
export type EventHash = string;

/**
 * Ed25519 signature as hex-encoded bytes
 */
export type Signature = string;

/**
 * Ed25519 public key as hex-encoded bytes
 */
export type PublicKey = string;

/**
 * Canonical event types
 */
export enum EventType {
  AIS = 'AIS',
  GPS = 'GPS',
  TELEMETRY = 'TELEMETRY',
  SYSTEM = 'SYSTEM',
  CUSTOM = 'CUSTOM',
  MESSAGE = 'MESSAGE',
}

/**
 * System event subtypes
 */
export enum SystemSubtype {
  STARTUP = 'STARTUP',
  SHUTDOWN = 'SHUTDOWN',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  CONFIG_CHANGE = 'CONFIG_CHANGE',
}

/**
 * AIS maritime vessel data
 */
export interface AISPayload {
  mmsi: string;
  vessel_name?: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  heading?: number;
  nav_status?: string;
  message_type: number;
}

/**
 * GPS location data
 */
export interface GPSPayload {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  hdop?: number;
  satellites?: number;
}

/**
 * Telemetry sensor reading
 */
export interface TelemetryPayload {
  sensor_type: string;
  unit: string;
  value: number;
  metadata?: Record<string, any>;
}

/**
 * System operational event
 */
export interface SystemPayload {
  subtype: SystemSubtype;
  message: string;
  error_code?: string;
  context?: Record<string, any>;
}

/**
 * Custom application-specific event
 */
export interface CustomPayload {
  custom_type: string;
  data: Record<string, any>;
}

/**
 * Fleet asset position and state
 */
export interface FleetPayload {
  asset_id: string;
  asset_type: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  state: string;
  metadata?: Record<string, any>;
}

/**
 * Mission dispatch and lifecycle events
 */
export interface MissionPayload {
  mission_id: string;
  mission_type: string;
  state: string;
  assigned_assets?: string[];
  waypoints?: Record<string, any>[];
  metadata?: Record<string, any>;
}

/**
 * Operational alerts
 */
export interface AlertPayload {
  alert_id: string;
  severity: string;
  category: string;
  message: string;
  source_asset?: string;
  acknowledged?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Secure messaging payload (Merkle Vine-linked)
 * 
 * CRITICAL: Messages are part of the Trust Fabric.
 * Each message event must:
 * - Link to previous message via prev_hash
 * - Be signed with TPM-backed Ed25519 key
 * - Have recipient_ids verified against IdentityRegistry
 */
export interface MessagePayload {
  /** Message content (plaintext - encryption handled at transport layer) */
  text: string;
  
  /** Conversation identifier (UUID) */
  conversation_id: string;
  
  /** List of recipient node IDs (Ed25519 public key hashes) */
  recipient_ids: string[];
  
  /** Optional reference to message being replied to (event_id) */
  reply_to?: string;
}

/**
 * Video frame hash event (Mission Guardian)
 * 
 * CRITICAL: Frame hashes form a Merkle Vine to prevent deepfake injection.
 * Each frame hash event:
 * - Links to previous frame hash via prev_hash
 * - Contains BLAKE3 hash of actual frame data
 * - Is transmitted via secure Data Channel
 * - Broken chain = SPOOFED status (Fail-Visible)
 */
export interface VideoFramePayload {
  /** Video call session identifier (UUID) */
  session_id: string;
  
  /** Frame sequence number (monotonically increasing) */
  frame_sequence: number;
  
  /** BLAKE3 hash of frame data (hex-encoded) */
  frame_hash: string;
  
  /** Whether this is a keyframe (I-frame) */
  is_keyframe?: boolean;
}

/**
 * Event payload union type
 */
export type EventPayload =
  | AISPayload
  | GPSPayload
  | TelemetryPayload
  | SystemPayload
  | CustomPayload
  | FleetPayload
  | MissionPayload
  | AlertPayload
  | MessagePayload
  | VideoFramePayload;

/**
 * Canonical event structure
 * 
 * This is the domain representation of an event after validation and canonicalization.
 * All fields are immutable after creation.
 * 
 * Merkle Vine Invariants:
 * - prev_hash MUST link to previous event in device's chain
 * - chain_height MUST increment monotonically
 * - hash MUST be computed from canonical representation (excludes signature fields)
 * - signature MUST be Ed25519 signature over hash
 */
export interface CanonicalEvent {
  /** Unique event identifier (UUIDv4) */
  event_id: string;

  /** Event type discriminator */
  event_type: EventType;

  /** Unix epoch timestamp in milliseconds */
  timestamp: number;

  /** Device identity that generated this event */
  device_id: string;

  /** Sequence number for this device's event stream */
  sequence: number;

  /** Event payload (canonicalized, sorted keys) */
  payload: EventPayload;

  /** Hash of previous event in this device's chain (empty for first event) */
  prev_hash: EventHash;

  /** Chain height (sequence in the device's event chain) */
  chain_height: number;

  /** BLAKE3 hash of canonical representation (computed without signature) */
  hash: EventHash;

  /** Ed25519 signature over the hash (empty before signing) */
  signature: Signature;

  /** Ed25519 public key of the signing device */
  public_key: PublicKey;

  /** Node identifier (matches device_id for single-node devices) */
  node_id: string;

  /** Optional metadata (sorted for deterministic serialization) */
  metadata?: Record<string, any>;
}

/**
 * Type guard for MessagePayload
 */
export function isMessagePayload(payload: EventPayload): payload is MessagePayload {
  return (
    'text' in payload &&
    'conversation_id' in payload &&
    'recipient_ids' in payload &&
    typeof payload.text === 'string' &&
    typeof payload.conversation_id === 'string' &&
    Array.isArray(payload.recipient_ids)
  );
}

/**
 * Type guard for VideoFramePayload
 */
export function isVideoFramePayload(payload: EventPayload): payload is VideoFramePayload {
  return (
    'session_id' in payload &&
    'frame_sequence' in payload &&
    'frame_hash' in payload &&
    typeof payload.session_id === 'string' &&
    typeof payload.frame_sequence === 'number' &&
    typeof payload.frame_hash === 'string'
  );
}

/**
 * Compute canonical JSON for signing (excludes signature fields)
 * 
 * This must match the Rust implementation's to_canonical_json_for_signing()
 * to ensure hash compatibility across language boundaries.
 */
export function toCanonicalJsonForSigning(event: CanonicalEvent): string {
  // Create object with sorted keys
  const canonical = {
    chain_height: event.chain_height,
    device_id: event.device_id,
    event_id: event.event_id,
    event_type: event.event_type,
    node_id: event.node_id,
    payload: event.payload,
    prev_hash: event.prev_hash,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };

  // Add metadata if present
  if (event.metadata) {
    Object.assign(canonical, { metadata: event.metadata });
  }

  // Note: signature and public_key are intentionally excluded
  return JSON.stringify(canonical);
}

/**
 * Verify event hash matches canonical representation
 * 
 * @param event Event to verify
 * @param computedHash BLAKE3 hash computed from canonical JSON
 * @returns true if hash matches, false otherwise
 */
export function verifyEventHash(event: CanonicalEvent, computedHash: string): boolean {
  return event.hash === computedHash;
}

/**
 * Check if event is signed
 */
export function isEventSigned(event: CanonicalEvent): boolean {
  return event.signature.length > 0 && event.public_key.length > 0;
}
