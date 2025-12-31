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
 */

import {
  NodeID,
  StreamIntegrityHash,
  IntegrityStatus,
} from '@aethercore/shared';
import * as crypto from 'crypto';

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
  
  /** Callback when integrity violation detected */
  onIntegrityViolation?: () => void;
  
  /** Callback when integrity status changes */
  onStatusChange?: (status: IntegrityStatus) => void;
}

/**
 * StreamMonitor
 * Monitors and verifies video stream integrity using BLAKE3
 */
export class StreamMonitor {
  private config: StreamMonitorConfig;
  private frameSequence: number = 0;
  private pendingHashes: Map<number, string> = new Map();
  private status: IntegrityStatus;

  constructor(config: StreamMonitorConfig) {
    this.config = config;
    this.status = {
      isValid: true,
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
   * Process incoming video frame (Receiver side)
   * Computes hash and compares with received hash from Data Channel
   */
  async processIncomingFrame(frame: FrameData): Promise<void> {
    try {
      this.status.totalFrames++;

      // Only verify keyframes
      if (!frame.isKeyframe) {
        return;
      }

      const computedHash = await this.computeBlake3Hash(frame.data);
      const expectedHash = this.pendingHashes.get(frame.sequence);

      if (!expectedHash) {
        console.warn(
          `[StreamMonitor] No hash received for frame ${frame.sequence}`,
        );
        return;
      }

      // Compare hashes
      if (computedHash === expectedHash) {
        this.status.validFrames++;
        console.log(
          `[StreamMonitor] Frame ${frame.sequence} integrity verified ✓`,
        );
      } else {
        this.status.invalidFrames++;
        this.status.isValid = false;
        this.status.showAlert = true;

        console.error(
          `[StreamMonitor] INTEGRITY VIOLATION - Frame ${frame.sequence}`,
        );
        console.error(`  Expected: ${expectedHash}`);
        console.error(`  Computed: ${computedHash}`);

        this.config.onIntegrityViolation?.();
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
   * Compute BLAKE3 hash of frame data
   * 
   * NOTE: This uses SHA-256 as a placeholder.
   * In production, this would use actual BLAKE3 implementation
   * (e.g., via npm package 'blake3' or crates/crypto FFI)
   */
  private async computeBlake3Hash(data: Uint8Array): Promise<string> {
    try {
      // BLAKE3 implementation would go here
      // For now, use SHA-256 as placeholder
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      return hash;
    } catch (error) {
      console.error('[StreamMonitor] Error computing hash:', error);
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
   */
  private handleHashMessage(data: string): void {
    try {
      const hash: StreamIntegrityHash = JSON.parse(data);

      // Store hash for verification when frame arrives
      this.pendingHashes.set(hash.frameSequence, hash.hash);

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
   * Reset integrity status
   */
  resetStatus(): void {
    this.status = {
      isValid: true,
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
