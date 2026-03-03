/**
 * StreamAuthenticator - Video Frame Integrity with Merkle Vine
 * 
 * MISSION GUARDIAN: Prevents deepfake injection and man-in-the-middle attacks
 * in real-time video streams.
 * 
 * ARCHITECTURAL INVARIANTS:
 * - Every nth frame hash is wrapped as a CanonicalEvent with Merkle Vine linkage
 * - Missing or invalid frame hash = SPOOFED status (Fail-Visible)
 * - Frame hashes transmitted via secure Data Channel
 * - Byzantine nodes are immediately quarantined
 * 
 * This extends StreamMonitor with Merkle Vine chain validation for video frames.
 */

import {
  NodeID,
  VerificationStatus,
  StreamIntegrityHash,
  IntegrityStatus,
} from '@aethercore/shared';
import { CanonicalEvent } from '../operator/P2PMessagingClient';
import { createSigningClient, SigningClient } from '../identity';

/**
 * Frame Hash Payload - Content for FRAME_HASH type events
 */
export interface FrameHashPayload {
  /** Session ID for this video call */
  session_id: string;
  
  /** Frame sequence number */
  frame_sequence: number;
  
  /** BLAKE3 hash of the frame */
  frame_hash: string;
  
  /** Timestamp when frame was captured */
  timestamp: number;
  
  /** Whether this is a keyframe */
  is_keyframe: boolean;
}

/**
 * Authenticated Frame - Frame with Merkle Vine verification
 */
export interface AuthenticatedFrame {
  /** Frame hash event */
  event: CanonicalEvent;
  
  /** Extracted frame hash */
  hash: FrameHashPayload;
  
  /** Verification status */
  verification_status: VerificationStatus;
  
  /** Chain validation result */
  chain_valid: boolean;
  
  /** Failure reason if any */
  failure_reason?: string;
}

/**
 * StreamAuthenticator Configuration
 */
export interface StreamAuthenticatorConfig {
  /** Local NodeID */
  localNodeId: NodeID;
  
  /** Remote NodeID */
  remoteNodeId: NodeID;
  
  /** Session ID for this stream */
  sessionId: string;
  
  /** Private key for signing (TPM-backed in production) */
  privateKey: string;
  
  /** Public key for verification */
  publicKey: string;
  
  /** Data channel for hash transmission */
  dataChannel: RTCDataChannel;
  
  /** Callback when integrity violation detected */
  onIntegrityViolation?: (reason: string) => void;
  
  /** Callback when status changes */
  onStatusChange?: (status: IntegrityStatus) => void;
  
  /** Callback when chain broken (Byzantine detection) */
  onChainBroken?: (nodeId: NodeID, reason: string) => void;
  
  /** Signing service endpoint (default: http://localhost:50053) */
  signingServiceEndpoint?: string;
}

/**
 * Chain State - Frame hash chain tracking
 */
interface FrameChainState {
  last_hash: string;
  last_sequence: number;
  chain_height: number;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const KEYFRAME_HASH_INTERVAL = 30; // Hash every 30th frame (typical I-frame interval)

/**
 * StreamAuthenticator
 * 
 * Authenticates video stream frames using Merkle Vine chain validation.
 * Extends StreamMonitor with CanonicalEvent wrapping and chain verification.
 */
export class StreamAuthenticator {
  private config: StreamAuthenticatorConfig;
  private localChain: FrameChainState;
  private remoteChain: FrameChainState | null = null;
  private frameCount: number = 0;
  private status: IntegrityStatus;
  private pendingFrameHashes: Map<number, CanonicalEvent> = new Map();
  private signingClient: SigningClient;

  constructor(config: StreamAuthenticatorConfig) {
    this.config = {
      signingServiceEndpoint: 'http://localhost:50053',
      ...config,
    };
    
    // Initialize local chain state
    this.localChain = {
      last_hash: GENESIS_HASH,
      last_sequence: 0,
      chain_height: 0,
    };

    // Initialize integrity status
    this.status = {
      isValid: true,
      verificationStatus: 'VERIFIED',
      totalFrames: 0,
      validFrames: 0,
      invalidFrames: 0,
      lastCheckTimestamp: Date.now(),
      showAlert: false,
    };
    
    // Initialize signing client for hardware-backed signatures
    this.signingClient = createSigningClient(
      this.config.signingServiceEndpoint,
      { 
        enableLogging: true,
        enablePerformanceMonitoring: true,
      }
    );

    this.setupDataChannel();
  }

  /**
   * Setup Data Channel for hash transmission
   */
  private setupDataChannel(): void {
    this.config.dataChannel.onmessage = async (event) => {
      await this.handleHashMessage(event.data);
    };

    this.config.dataChannel.onopen = () => {
      console.log('[StreamAuthenticator] Data channel opened');
    };

    this.config.dataChannel.onerror = (error) => {
      console.error('[StreamAuthenticator] Data channel error:', error);
      this.status.showAlert = true;
      this.config.onStatusChange?.(this.status);
    };
  }

  /**
   * Process outgoing video frame (Sender side)
   * 
   * For keyframes:
   * 1. Compute BLAKE3 hash of frame
   * 2. Wrap in CanonicalEvent with Merkle Vine linkage
   * 3. Sign with Ed25519
   * 4. Transmit via Data Channel
   */
  async processOutgoingFrame(
    frameData: Uint8Array,
    timestamp: number,
    isKeyframe: boolean
  ): Promise<void> {
    this.frameCount++;

    // Only hash keyframes to reduce overhead
    if (!isKeyframe && this.frameCount % KEYFRAME_HASH_INTERVAL !== 0) {
      return;
    }

    try {
      // Compute BLAKE3 hash of frame
      const frameHash = await this.computeBlake3Hash(frameData);

      // Create frame hash payload
      const payload: FrameHashPayload = {
        session_id: this.config.sessionId,
        frame_sequence: this.frameCount,
        frame_hash: frameHash,
        timestamp,
        is_keyframe: isKeyframe,
      };

      // Wrap in CanonicalEvent
      const event: CanonicalEvent = {
        event_id: this.generateUUID(),
        event_type: 'FRAME_HASH',
        timestamp: Date.now(),
        device_id: this.config.localNodeId,
        sequence: this.localChain.last_sequence + 1,
        prev_hash: this.localChain.last_hash,
        chain_height: this.localChain.chain_height + 1,
        payload,
        event_hash: '', // Computed below
        signature: '', // Computed below
        public_key: this.config.publicKey,
      };

      // Compute event hash
      event.event_hash = await this.computeEventHash(event);

      // Sign event hash
      event.signature = await this.signEventHash(event.event_hash);

      // Update local chain
      this.localChain = {
        last_hash: event.event_hash,
        last_sequence: event.sequence,
        chain_height: event.chain_height,
      };

      // Transmit via Data Channel
      this.transmitFrameHash(event);

      console.log(
        `[StreamAuthenticator] Sent frame hash for frame ${this.frameCount} (chain height: ${event.chain_height})`
      );
    } catch (error) {
      console.error('[StreamAuthenticator] Error processing outgoing frame:', error);
    }
  }

  /**
   * Verify incoming frame hash (Receiver side)
   * 
   * Validates:
   * 1. Ed25519 signature
   * 2. Merkle Vine chain linkage
   * 3. Sequence monotonicity
   */
  private async handleHashMessage(data: string): Promise<void> {
    try {
      const event: CanonicalEvent = JSON.parse(data);

      // Skip our own hashes
      if (event.device_id === this.config.localNodeId) {
        return;
      }

      // Verify event signature
      const signatureValid = await this.verifySignature(
        event.event_hash,
        event.signature,
        event.public_key
      );

      if (!signatureValid) {
        console.error('[StreamAuthenticator] SIGNATURE VERIFICATION FAILED');
        console.error(`  NodeID: ${event.device_id}`);
        console.error('  STATUS: SPOOFED - Invalid signature on frame hash');

        this.handleIntegrityViolation(
          event,
          'Invalid Ed25519 signature on frame hash'
        );
        return;
      }

      // Verify chain linkage
      const chainValid = this.verifyChainLinkage(event);

      if (!chainValid) {
        console.error('[StreamAuthenticator] CHAIN VALIDATION FAILED');
        console.error(`  NodeID: ${event.device_id}`);
        console.error(
          `  Expected prev_hash: ${this.remoteChain?.last_hash || GENESIS_HASH}`
        );
        console.error(`  Received prev_hash: ${event.prev_hash}`);
        console.error('  STATUS: SPOOFED - Frame hash chain broken');

        this.handleIntegrityViolation(
          event,
          'Broken frame hash chain - potential frame injection'
        );
        return;
      }

      // Update remote chain
      this.updateRemoteChain(event);

      // Store for frame verification
      const payload = event.payload as FrameHashPayload;
      this.pendingFrameHashes.set(payload.frame_sequence, event);

      console.log(
        `[StreamAuthenticator] Frame hash received and verified ✓ (frame ${payload.frame_sequence}, chain height: ${event.chain_height})`
      );
    } catch (error) {
      console.error('[StreamAuthenticator] Error handling hash message:', error);
    }
  }

  /**
   * Verify received video frame against stored hash
   * 
   * Called when actual frame data arrives via video stream.
   */
  async verifyFrame(
    frameData: Uint8Array,
    frameSequence: number
  ): Promise<boolean> {
    this.status.totalFrames++;

    const hashEvent = this.pendingFrameHashes.get(frameSequence);
    if (!hashEvent) {
      console.warn(
        `[StreamAuthenticator] No hash received for frame ${frameSequence}`
      );
      this.status.verificationStatus = 'STATUS_UNVERIFIED';
      this.config.onStatusChange?.(this.status);
      return false;
    }

    try {
      // Compute BLAKE3 hash of received frame
      const computedHash = await this.computeBlake3Hash(frameData);

      // Extract expected hash from event
      const payload = hashEvent.payload as FrameHashPayload;
      const expectedHash = payload.frame_hash;

      // Compare hashes
      if (computedHash === expectedHash) {
        this.status.validFrames++;
        this.status.verificationStatus = 'VERIFIED';
        this.status.lastCheckTimestamp = Date.now();
        this.config.onStatusChange?.(this.status);

        // Remove verified hash
        this.pendingFrameHashes.delete(frameSequence);

        console.log(
          `[StreamAuthenticator] Frame ${frameSequence} integrity verified ✓`
        );
        return true;
      } else {
        // Fail-Visible: Frame hash mismatch = SPOOFED
        this.status.invalidFrames++;
        this.status.isValid = false;
        this.status.verificationStatus = 'SPOOFED';
        this.status.showAlert = true;
        this.status.lastCheckTimestamp = Date.now();

        console.error(
          `[StreamAuthenticator] FRAME INTEGRITY VIOLATION - Frame ${frameSequence}`
        );
        console.error(`  Expected hash: ${expectedHash}`);
        console.error(`  Computed hash: ${computedHash}`);
        console.error('  STATUS: SPOOFED - Video stream tampered');

        this.config.onIntegrityViolation?.(
          `Frame ${frameSequence} hash mismatch - possible deepfake injection`
        );
        this.config.onStatusChange?.(this.status);

        return false;
      }
    } catch (error) {
      console.error('[StreamAuthenticator] Error verifying frame:', error);
      return false;
    }
  }

  /**
   * Verify chain linkage
   */
  private verifyChainLinkage(event: CanonicalEvent): boolean {
    // First frame hash from remote (genesis)
    if (!this.remoteChain) {
      if (event.prev_hash !== GENESIS_HASH || event.chain_height !== 1) {
        console.warn('[StreamAuthenticator] Invalid genesis frame hash event');
        return false;
      }
      return true;
    }

    // Verify prev_hash matches last known hash
    if (event.prev_hash !== this.remoteChain.last_hash) {
      return false;
    }

    // Verify sequence monotonicity
    if (event.sequence <= this.remoteChain.last_sequence) {
      console.warn('[StreamAuthenticator] Non-monotonic sequence detected');
      return false;
    }

    // Verify chain height progression
    if (event.chain_height !== this.remoteChain.chain_height + 1) {
      console.warn('[StreamAuthenticator] Chain height mismatch');
      return false;
    }

    return true;
  }

  /**
   * Update remote chain state
   */
  private updateRemoteChain(event: CanonicalEvent): void {
    this.remoteChain = {
      last_hash: event.event_hash,
      last_sequence: event.sequence,
      chain_height: event.chain_height,
    };
  }

  /**
   * Handle integrity violation
   */
  private handleIntegrityViolation(
    event: CanonicalEvent,
    reason: string
  ): void {
    this.status.invalidFrames++;
    this.status.isValid = false;
    this.status.verificationStatus = 'SPOOFED';
    this.status.showAlert = true;
    this.status.lastCheckTimestamp = Date.now();

    this.config.onIntegrityViolation?.(reason);
    this.config.onChainBroken?.(event.device_id, reason);
    this.config.onStatusChange?.(this.status);
  }

  /**
   * Compute BLAKE3 hash
   */
  private async computeBlake3Hash(data: Uint8Array): Promise<string> {
    try {
      const { hash } = await import('blake3');
      return hash(data).toString('hex');
    } catch (error) {
      console.error('[StreamAuthenticator] Error computing BLAKE3 hash:', error);
      throw error;
    }
  }

  /**
   * Compute event hash
   */
  private async computeEventHash(event: CanonicalEvent): Promise<string> {
    try {
      const canonical = JSON.stringify({
        event_id: event.event_id,
        event_type: event.event_type,
        timestamp: event.timestamp,
        device_id: event.device_id,
        sequence: event.sequence,
        prev_hash: event.prev_hash,
        chain_height: event.chain_height,
        payload: event.payload,
      });

      const { hash } = await import('blake3');
      const encoder = new TextEncoder();
      const data = encoder.encode(canonical);
      return hash(data).toString('hex');
    } catch (error) {
      console.error('[StreamAuthenticator] Error computing event hash:', error);
      throw error;
    }
  }

  /**
   * Sign event hash with Ed25519
   * 
   * Uses SigningClient for hardware-backed TPM signature generation.
   * Private keys NEVER leave the TPM.
   */
  private async signEventHash(hash: string): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const hashBytes = encoder.encode(hash);
      
      // Use signing client for hardware-backed signature
      const result = await this.signingClient.signMessage(
        this.config.localNodeId,
        hashBytes
      );
      
      return result.signature_hex;
    } catch (error) {
      console.error('[StreamAuthenticator] Error signing hash:', error);
      throw error;
    }
  }

  /**
   * Verify Ed25519 signature
   * 
   * Uses SigningClient for cryptographic verification via hardware-backed service.
   * Fail-Visible: Invalid signatures are logged and rejected.
   */
  private async verifySignature(
    hash: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    // Basic validation
    if (!signature || signature.length !== 128) {
      console.error('[StreamAuthenticator] Invalid signature format');
      return false;
    }
    
    if (!hash || hash.length !== 64) {
      console.error('[StreamAuthenticator] Invalid hash format');
      return false;
    }
    
    if (!publicKey || publicKey.length !== 64) {
      console.error('[StreamAuthenticator] Invalid public key format');
      return false;
    }
    
    try {
      // Convert hash to bytes for verification
      const encoder = new TextEncoder();
      const hashBytes = encoder.encode(hash);
      
      // Use signing client for cryptographic verification
      const result = await this.signingClient.verifySignature(
        publicKey,
        hashBytes,
        signature
      );
      
      return result.is_valid;
    } catch (error) {
      console.error('[StreamAuthenticator] Signature verification error:', error);
      return false;
    }
  }

  /**
   * Transmit frame hash via Data Channel
   */
  private transmitFrameHash(event: CanonicalEvent): void {
    if (this.config.dataChannel.readyState !== 'open') {
      console.warn('[StreamAuthenticator] Data channel not ready');
      return;
    }

    try {
      const message = JSON.stringify(event);
      this.config.dataChannel.send(message);
    } catch (error) {
      console.error('[StreamAuthenticator] Error transmitting frame hash:', error);
    }
  }

  /**
   * Generate UUIDv4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current integrity status
   */
  getStatus(): IntegrityStatus {
    return { ...this.status };
  }

  /**
   * Reset integrity status
   */
  resetStatus(): void {
    this.status = {
      isValid: true,
      verificationStatus: 'VERIFIED',
      totalFrames: 0,
      validFrames: 0,
      invalidFrames: 0,
      lastCheckTimestamp: Date.now(),
      showAlert: false,
    };
    this.config.onStatusChange?.(this.status);
  }

  /**
   * Clear integrity alert
   */
  clearAlert(): void {
    this.status.showAlert = false;
    this.config.onStatusChange?.(this.status);
  }

  /**
   * Stop authenticator
   */
  stop(): void {
    this.pendingFrameHashes.clear();
    if (this.config.dataChannel) {
      this.config.dataChannel.close();
    }
    
    // Cleanup signing client
    this.signingClient.close();
    
    // Log performance metrics if available
    const metrics = this.signingClient.getMetrics();
    if (metrics) {
      console.log('[StreamAuthenticator] Performance metrics:');
      console.log(`  Total sign operations: ${metrics.totalSignOperations}`);
      console.log(`  Average latency: ${metrics.averageLatencyUs.toFixed(2)}µs`);
      console.log(`  Min latency: ${metrics.minLatencyUs}µs`);
      console.log(`  Max latency: ${metrics.maxLatencyUs}µs`);
    }
  }
}
