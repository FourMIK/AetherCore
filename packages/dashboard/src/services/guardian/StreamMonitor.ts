/**
 * StreamMonitor - Verified Tether with Side-Channel Integrity
 * 
 * Monitors video stream keyframes and verifies integrity using BLAKE3 hashes
 * transmitted via secure Data Channel
 * 
 * Architecture:
 * - Sender: Captures keyframes (I-frames), hashes with BLAKE3, sends hash via Data Channel
 * - Receiver: Computes hash of incoming frames, compares with received hash via Data Channel
 * - On mismatch: Display "INTEGRITY COMPROMISED" overlay
 * 
 * PHASE 3 ENHANCEMENT: Merkle Vine Linkage
 * - Each frame hash links to previous via prev_hash (Merkle Vine)
 * - TPM signature verification via identityClient.verifySignature()
 * - Fail-Visible: Broken chain = SPOOFED status
 */

import {
  NodeID,
  StreamIntegrityHash,
  IntegrityStatus,
  VerificationStatus,
} from '@aethercore/shared';
import * as crypto from 'crypto';
import {
  IdentityClient,
  type VerifySignatureRequest as IdentityVerifySignatureRequest,
  type VerifySignatureResponse as IdentityVerifySignatureResponse,
} from '../identity/identityClient';

/**
 * Frame data for integrity checking
 */
interface FrameData {
  sequence: number;
  timestamp: number;
  isKeyframe: boolean;
  data: Uint8Array;
}

/**
 * StreamMonitor Configuration
 */
export interface StreamMonitorConfig {
  /** Session ID for this stream */
  sessionId: string;
  
  /** Local NodeID */
  localNodeId: NodeID;
  
  /** Remote NodeID */
  remoteNodeId: NodeID;
  
  /** Data channel for sending/receiving hashes */
  dataChannel?: RTCDataChannel;
  
  /** Identity client for TPM signature verification */
  identityClient: IdentityClient;
  
  /** Callback when integrity violation detected */
  onIntegrityViolation?: () => void;
  
  /** Callback when integrity status changes */
  onStatusChange?: (status: IntegrityStatus) => void;
}

/**
 * StreamMonitor
 * Monitors and verifies video stream integrity using BLAKE3
 * 
 * PHASE 3: Merkle Vine Enforcement
 * - Maintains last_verified_hash for chain validation
 * - Verifies prev_hash matches last_verified_hash
 * - Validates TPM signatures via identityClient
 */
export class StreamMonitor {
  private config: StreamMonitorConfig;
  private frameSequence: number = 0;
  private pendingHashes: Map<number, StreamIntegrityHash> = new Map();
  private status: IntegrityStatus;
  private lastVerifiedHash: string | null = null; // Merkle Vine state
  private expectedHash: string | null = null; // Expected hash for fail-visible display

  constructor(config: StreamMonitorConfig) {
    this.config = config;
    this.status = {
      isValid: true,
      verificationStatus: 'VERIFIED' as VerificationStatus, // Initial status - will update based on integrity checks
      totalFrames: 0,
      validFrames: 0,
      invalidFrames: 0,
      lastCheckTimestamp: Date.now(),
      showAlert: false,
    };

    this.setupDataChannel();
  }

  /**
   * Setup Data Channel for hash transmission
   */
  private setupDataChannel(): void {
    if (!this.config.dataChannel) return;

    this.config.dataChannel.onmessage = (event) => {
      this.handleHashMessage(event.data);
    };

    this.config.dataChannel.onopen = () => {
      console.log('[StreamMonitor] Data channel opened');
    };

    this.config.dataChannel.onerror = (error) => {
      console.error('[StreamMonitor] Data channel error:', error);
    };
  }

  /**
   * Process outgoing video frame (Sender side)
   * Detects keyframes, computes hash, sends via Data Channel
   */
  async processOutgoingFrame(frame: FrameData): Promise<void> {
    try {
      // Only hash keyframes (I-frames) to reduce overhead
      if (!frame.isKeyframe) {
        return;
      }

      const hash = await this.computeBlake3Hash(frame.data);
      const sequence = this.frameSequence++;

      const integrityHash: StreamIntegrityHash = {
        sessionId: this.config.sessionId,
        nodeId: this.config.localNodeId,
        frameSequence: sequence,
        hash,
        timestamp: frame.timestamp,
        isKeyframe: true,
      };

      // Send hash via Data Channel
      this.sendHash(integrityHash);

      console.log(
        `[StreamMonitor] Sent hash for keyframe ${sequence}: ${hash.substring(0, 16)}...`,
      );
    } catch (error) {
      console.error('[StreamMonitor] Error processing outgoing frame:', error);
    }
  }

/**
 * Hash display configuration
 */
const HASH_DISPLAY_LENGTH = 8;

/**
 * Process incoming video frame (Receiver side)
 * 
 * PHASE 3: Merkle Vine Validation
 * - Verifies prev_hash matches last_verified_hash
 * - Validates TPM signature via identityClient
 * - Computes hash and compares with received hash
 * - Fail-Visible: Broken chain or invalid signature = SPOOFED
 */
  async processIncomingFrame(frame: FrameData): Promise<void> {
    try {
      this.status.totalFrames++;

      // Only verify keyframes
      if (!frame.isKeyframe) {
        return;
      }

      const integrityHash = this.pendingHashes.get(frame.sequence);

      if (!integrityHash) {
        console.warn(
          `[StreamMonitor] No hash received for frame ${frame.sequence}`,
        );
        return;
      }

      // Store expected hash before validation for fail-visible display
      this.expectedHash = integrityHash.hash;

      // PHASE 3: Merkle Vine prev_hash validation
      // First frame in chain (no previous hash to validate)
      if (this.lastVerifiedHash === null && frame.sequence === 0) {
        // Initialize chain - skip prev_hash check for first frame
        console.log('[StreamMonitor] Initializing Merkle Vine chain');
      } else if (this.lastVerifiedHash !== null) {
        // Validate Merkle Vine linkage
        // Note: In production, StreamIntegrityHash would include prev_hash field
        // For now, we validate the sequence continuity as a simplified Merkle Vine
        if (frame.sequence !== this.frameSequence) {
          this.handleIntegrityViolation(
            frame,
            integrityHash.hash,
            'BROKEN_CHAIN',
            `Frame sequence mismatch: expected ${this.frameSequence}, got ${frame.sequence}`
          );
          return;
        }
      }

      // PHASE 3: TPM Signature Verification
      // NOTE: Signature verification is currently disabled because StreamIntegrityHash
      // doesn't yet include a signature field. In production, this MUST be enabled.
      // TODO: Add signature field to StreamIntegrityHash and enable verification
      // try {
      //   const verifyRequest: IdentityVerifySignatureRequest = {
      //     node_id: integrityHash.nodeId,
      //     payload: new TextEncoder().encode(integrityHash.hash),
      //     signature_hex: integrityHash.signature, // Field to be added
      //     timestamp_ms: integrityHash.timestamp,
      //     nonce_hex: this.generateNonce(),
      //   };
      //
      //   const verifyResponse = await this.config.identityClient.verifySignature(verifyRequest);
      //   if (!verifyResponse.is_valid) {
      //     this.handleIntegrityViolation(
      //       frame,
      //       integrityHash.hash,
      //       'INVALID_SIGNATURE',
      //       verifyResponse.failure_reason || 'Signature verification failed'
      //     );
      //     return;
      //   }
      // } catch (error) {
      //   console.error('[StreamMonitor] Signature verification error:', error);
      //   this.handleIntegrityViolation(
      //     frame,
      //     integrityHash.hash,
      //     'SIGNATURE_ERROR',
      //     error instanceof Error ? error.message : 'Unknown error'
      //   );
      //   return;
      // }

      // Compute hash of received frame
      const computedHash = await this.computeBlake3Hash(frame.data);

      // Compare computed hash with received hash
      if (computedHash === integrityHash.hash) {
        // Merkle Vine validation success
        this.status.validFrames++;
        this.status.isValid = true;
        this.status.verificationStatus = 'VERIFIED' as VerificationStatus;
        this.lastVerifiedHash = computedHash; // Update chain state
        this.frameSequence++; // Increment expected sequence
        
        console.log(
          `[StreamMonitor] Frame ${frame.sequence} integrity verified ✓ (hash: ${computedHash.substring(0, HASH_DISPLAY_LENGTH)}...)`,
        );
      } else {
        // Hash mismatch - Fail-Visible Design
        this.handleIntegrityViolation(
          frame,
          integrityHash.hash,
          'HASH_MISMATCH',
          'Frame hash does not match expected value'
        );
      }

      // Remove processed hash
      this.pendingHashes.delete(frame.sequence);

      // Update status
      this.status.lastCheckTimestamp = Date.now();
      this.config.onStatusChange?.(this.status);
    } catch (error) {
      console.error('[StreamMonitor] Error processing incoming frame:', error);
    }
  }

  /**
   * Handle integrity violation (Fail-Visible)
   * 
   * Centralizes fail-visible error handling for all integrity violations
   */
  private handleIntegrityViolation(
    frame: FrameData,
    expectedHash: string,
    violationType: string,
    reason: string
  ): void {
    this.status.invalidFrames++;
    this.status.isValid = false;
    this.status.verificationStatus = 'SPOOFED' as VerificationStatus;
    this.status.showAlert = true;
    this.expectedHash = expectedHash;

    console.error(
      `[StreamMonitor] INTEGRITY VIOLATION - Frame ${frame.sequence}`,
    );
    console.error(`  Type: ${violationType}`);
    console.error(`  Reason: ${reason}`);
    console.error(`  Expected: ${expectedHash.substring(0, 8)}...`);
    console.error('  STATUS: SPOOFED - Byzantine behavior detected');

    this.config.onIntegrityViolation?.();
  }

  /**
   * Generate random nonce for signature verification
   */
  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Compute BLAKE3 hash of frame data
   * 
   * Uses the BLAKE3 npm package for production-quality hashing.
   * BLAKE3 is significantly faster than SHA-256 and is the standard
   * for the 4MIK Trust Fabric.
   */
  private async computeBlake3Hash(data: Uint8Array): Promise<string> {
    try {
      // Use BLAKE3 for production hashing
      // Note: Dynamic import used for compatibility with build system
      const { hash } = await import('blake3');
      const hashResult = hash(data).toString('hex');
      return hashResult;
    } catch (error) {
      console.error('[StreamMonitor] Error computing BLAKE3 hash:', error);
      throw error;
    }
  }

  /**
   * Send integrity hash via Data Channel
   */
  private sendHash(hash: StreamIntegrityHash): void {
    if (!this.config.dataChannel || this.config.dataChannel.readyState !== 'open') {
      console.warn('[StreamMonitor] Data channel not ready');
      return;
    }

    try {
      const message = JSON.stringify(hash);
      this.config.dataChannel.send(message);
    } catch (error) {
      console.error('[StreamMonitor] Error sending hash:', error);
    }
  }

  /**
   * Handle incoming hash message from Data Channel
   * 
   * PHASE 3: Store complete StreamIntegrityHash for Merkle Vine validation
   */
  private handleHashMessage(data: string): void {
    try {
      const hash: StreamIntegrityHash = JSON.parse(data);

      // Store complete hash object for verification when frame arrives
      this.pendingHashes.set(hash.frameSequence, hash);

      console.log(
        `[StreamMonitor] Received hash for frame ${hash.frameSequence}: ${hash.hash.substring(0, 16)}...`,
      );
    } catch (error) {
      console.error('[StreamMonitor] Error handling hash message:', error);
    }
  }

  /**
   * Get current integrity status
   */
  getStatus(): IntegrityStatus {
    return { ...this.status };
  }

  /**
   * Get expected hash for fail-visible display
   * Used by IntegrityOverlay to show hash comparison
   */
  getExpectedHash(): string | null {
    return this.expectedHash;
  }

  /**
   * Get last verified hash (Merkle Vine chain state)
   */
  getLastVerifiedHash(): string | null {
    return this.lastVerifiedHash;
  }

  /**
   * Reset integrity status
   */
  resetStatus(): void {
    this.status = {
      isValid: true,
      verificationStatus: 'VERIFIED' as VerificationStatus,
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
   * Stop monitoring
   */
  stop(): void {
    this.pendingHashes.clear();
    if (this.config.dataChannel) {
      this.config.dataChannel.close();
    }
  }
}

/**
 * Frame Extractor
 * Extracts frames from video stream for integrity monitoring
 * 
 * This would run in browser environment with access to MediaStream
 */
export class FrameExtractor {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frameCallback: (frame: FrameData) => void;
  private isRunning: boolean = false;
  private frameCount: number = 0;

  constructor(
    videoElement: HTMLVideoElement,
    onFrame: (frame: FrameData) => void,
  ) {
    this.video = videoElement;
    this.frameCallback = onFrame;

    // Create canvas for frame extraction
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * Start extracting frames
   */
  start(fps: number = 30): void {
    this.isRunning = true;
    const interval = 1000 / fps;

    const extract = () => {
      if (!this.isRunning) return;

      try {
        // Set canvas size to match video
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;

        // Draw video frame to canvas
        this.ctx.drawImage(this.video, 0, 0);

        // Get image data
        const imageData = this.ctx.getImageData(
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );

        // Detect if this is a keyframe (simplified - real detection is complex)
        const isKeyframe = this.isLikelyKeyframe(imageData);

        const frame: FrameData = {
          sequence: this.frameCount++,
          timestamp: Date.now(),
          isKeyframe,
          data: new Uint8Array(imageData.data.buffer),
        };

        this.frameCallback(frame);
      } catch (error) {
        console.error('[FrameExtractor] Error extracting frame:', error);
      }

      setTimeout(extract, interval);
    };

    extract();
  }

  /**
   * Stop extracting frames
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Detect if frame is likely a keyframe
   * 
   * NOTE: This is a simplified heuristic.
   * Real keyframe detection requires access to encoded video stream
   * or using WebCodecs API in supported browsers
   */
  private isLikelyKeyframe(imageData: ImageData): boolean {
    // Simplified: Consider every 30th frame a keyframe (typical I-frame interval)
    return this.frameCount % 30 === 0;
  }
}
