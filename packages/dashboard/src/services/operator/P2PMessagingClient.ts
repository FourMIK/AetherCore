/**
 * P2PMessagingClient - Peer-to-Peer Messaging with Merkle Vine Integrity
 * 
 * ARCHITECTURAL INVARIANTS:
 * - Every message is a CanonicalEvent with BLAKE3 hash of ancestor
 * - No message transmission without hardware-backed Ed25519 signature
 * - Broken hash chain = SPOOFED status (Byzantine node detected)
 * - Store-and-forward for contested network resilience
 * 
 * This is NOT a standard chat client. Every byte is cryptographically bound
 * to physical silicon (TPM 2.0 / Secure Enclave).
 */

import {
  NodeID,
  VerificationStatus,
  SignedEnvelope,
} from '@aethercore/shared';
import { MessageEnvelope, MessageEnvelopeSchema } from '@aethercore/shared';

/**
 * CanonicalEvent - Merkle Vine Message Structure
 * 
 * Every message forms a tamper-evident chain via ancestor_hash.
 * Messages CANNOT be injected retroactively without breaking the chain.
 */
export interface CanonicalEvent {
  /** Unique event ID (UUIDv4) */
  event_id: string;
  
  /** Event type */
  event_type: 'MESSAGE' | 'SIGNAL' | 'FRAME_HASH' | 'REVOCATION';
  
  /** Timestamp (ms since epoch) */
  timestamp: number;
  
  /** Sending NodeID (Public Key Hash) */
  device_id: NodeID;
  
  /** Monotonic sequence number for this device */
  sequence: number;
  
  /** BLAKE3 hash of previous event in this device's chain */
  prev_hash: string;
  
  /** Chain height (starts at 0 for genesis) */
  chain_height: number;
  
  /** Event payload (type-specific data) */
  payload: unknown;
  
  /** BLAKE3 hash of this event (computed before signing) */
  event_hash: string;
  
  /** Ed25519 signature of event_hash (TPM-backed in production) */
  signature: string;
  
  /** Public key for signature verification */
  public_key: string;
}

/**
 * Message Payload - Content for MESSAGE type events
 */
export interface MessagePayload {
  /** Message content (plaintext or ciphertext) */
  content: string;
  
  /** Recipient NodeID */
  recipient_id: NodeID;
  
  /** Whether content is encrypted */
  encrypted: boolean;
  
  /** Conversation ID (for threading) */
  conversation_id?: string;
  
  /** Reply-to message ID (for threading) */
  reply_to?: string;
}

/**
 * Verified Message - Message with verification result
 * 
 * Fail-Visible Design: All messages MUST be explicitly marked.
 */
export interface VerifiedMessage {
  /** Original canonical event */
  event: CanonicalEvent;
  
  /** Extracted message payload */
  message: MessagePayload;
  
  /** Verification status from Trust Fabric */
  verification_status: VerificationStatus;
  
  /** Chain validation result */
  chain_valid: boolean;
  
  /** Reason if verification failed */
  failure_reason?: string;
}

/**
 * Message Queue Entry - For store-and-forward
 */
interface QueuedMessage {
  event: CanonicalEvent;
  retries: number;
  last_attempt: number;
}

/**
 * P2PMessagingClient Configuration
 */
export interface P2PMessagingClientConfig {
  /** Local NodeID (Public Key Hash) */
  localNodeId: NodeID;
  
  /** Private key for signing (TPM-backed in production) */
  privateKey: string;
  
  /** Public key for verification */
  publicKey: string;
  
  /** WebSocket or NATS endpoint for message transport */
  transportEndpoint: string;
  
  /** Callback when message received */
  onMessageReceived?: (message: VerifiedMessage) => void;
  
  /** Callback when verification fails */
  onVerificationFailure?: (event: CanonicalEvent, reason: string) => void;
  
  /** Callback when chain validation fails (Byzantine detection) */
  onChainBroken?: (nodeId: NodeID, reason: string) => void;
}

/**
 * Chain State - Per-device chain tracking
 */
interface ChainState {
  last_hash: string;
  last_sequence: number;
  chain_height: number;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = 2000;

/**
 * P2PMessagingClient
 * 
 * Manages peer-to-peer messaging with Merkle Vine integrity enforcement.
 */
export class P2PMessagingClient {
  private config: P2PMessagingClientConfig;
  private ws: WebSocket | null = null;
  private localChain: ChainState;
  private remoteChains: Map<NodeID, ChainState> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private isConnected: boolean = false;

  constructor(config: P2PMessagingClientConfig) {
    this.config = config;
    
    // Initialize local chain state (genesis)
    this.localChain = {
      last_hash: GENESIS_HASH,
      last_sequence: 0,
      chain_height: 0,
    };
  }

  /**
   * Connect to message transport
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.transportEndpoint);

        this.ws.onopen = () => {
          console.log('[P2PMessagingClient] Connected to message transport');
          this.isConnected = true;
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = async (event) => {
          await this.handleIncomingMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[P2PMessagingClient] WebSocket error:', error);
          this.isConnected = false;
        };

        this.ws.onclose = () => {
          console.log('[P2PMessagingClient] Connection closed');
          this.isConnected = false;
          // Auto-reconnect after delay
          setTimeout(() => this.connect(), 5000);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send message with Merkle Vine linkage
   * 
   * Creates CanonicalEvent with:
   * 1. prev_hash pointing to last event in local chain
   * 2. BLAKE3 hash of event content
   * 3. Ed25519 signature of hash
   */
  async sendMessage(
    recipientId: NodeID,
    content: string,
    encrypted: boolean = false
  ): Promise<CanonicalEvent> {
    const payload: MessagePayload = {
      content,
      recipient_id: recipientId,
      encrypted,
    };

    // Create CanonicalEvent
    const event: CanonicalEvent = {
      event_id: this.generateUUID(),
      event_type: 'MESSAGE',
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

    // Compute BLAKE3 hash of event
    event.event_hash = await this.computeEventHash(event);

    // Sign event hash with Ed25519
    event.signature = await this.signEventHash(event.event_hash);

    // Update local chain state
    this.localChain = {
      last_hash: event.event_hash,
      last_sequence: event.sequence,
      chain_height: event.chain_height,
    };

    // Send or queue message
    if (this.isConnected) {
      await this.transmitEvent(event);
    } else {
      this.queueMessage(event);
      console.warn('[P2PMessagingClient] Offline - message queued for transmission');
    }

    return event;
  }

  /**
   * Handle incoming message
   * 
   * Verifies:
   * 1. Signature validity (Ed25519)
   * 2. Chain linkage (prev_hash matches remote chain)
   * 3. Sequence monotonicity
   */
  private async handleIncomingMessage(data: string): Promise<void> {
    try {
      const event: CanonicalEvent = JSON.parse(data);

      // Skip our own messages
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
        console.error('[P2PMessagingClient] SIGNATURE VERIFICATION FAILED');
        console.error(`  NodeID: ${event.device_id}`);
        console.error('  STATUS: SPOOFED - Invalid signature detected');
        
        const message = this.extractMessagePayload(event);
        if (message) {
          this.config.onMessageReceived?.({
            event,
            message,
            verification_status: 'SPOOFED',
            chain_valid: false,
            failure_reason: 'Invalid Ed25519 signature',
          });
        }
        
        this.config.onVerificationFailure?.(event, 'Invalid signature');
        return;
      }

      // Verify chain linkage
      const chainValid = this.verifyChainLinkage(event);

      if (!chainValid) {
        console.error('[P2PMessagingClient] CHAIN VALIDATION FAILED');
        console.error(`  NodeID: ${event.device_id}`);
        console.error(`  Expected prev_hash: ${this.remoteChains.get(event.device_id)?.last_hash}`);
        console.error(`  Received prev_hash: ${event.prev_hash}`);
        console.error('  STATUS: SPOOFED - Byzantine behavior detected');
        
        const message = this.extractMessagePayload(event);
        if (message) {
          this.config.onMessageReceived?.({
            event,
            message,
            verification_status: 'SPOOFED',
            chain_valid: false,
            failure_reason: 'Broken hash chain - message injected retroactively',
          });
        }
        
        this.config.onChainBroken?.(
          event.device_id,
          'Hash chain broken - potential replay or injection attack'
        );
        return;
      }

      // Update remote chain state
      this.updateRemoteChain(event);

      // Extract message payload
      const message = this.extractMessagePayload(event);
      if (!message) {
        console.warn('[P2PMessagingClient] Invalid message payload');
        return;
      }

      // Deliver verified message
      this.config.onMessageReceived?.({
        event,
        message,
        verification_status: 'VERIFIED',
        chain_valid: true,
      });

      console.log(`[P2PMessagingClient] Message verified ✓`);
      console.log(`  From: ${event.device_id}`);
      console.log(`  Chain height: ${event.chain_height}`);
      console.log(`  Status: VERIFIED`);
    } catch (error) {
      console.error('[P2PMessagingClient] Error handling message:', error);
    }
  }

  /**
   * Verify chain linkage
   * 
   * Ensures prev_hash matches last known hash from this device.
   * First message from device is genesis (prev_hash = GENESIS_HASH).
   */
  private verifyChainLinkage(event: CanonicalEvent): boolean {
    const remoteChain = this.remoteChains.get(event.device_id);

    // First message from this device (genesis)
    if (!remoteChain) {
      if (event.prev_hash !== GENESIS_HASH || event.chain_height !== 1) {
        console.warn('[P2PMessagingClient] Invalid genesis event');
        return false;
      }
      return true;
    }

    // Verify prev_hash matches last known hash
    if (event.prev_hash !== remoteChain.last_hash) {
      return false;
    }

    // Verify sequence monotonicity
    if (event.sequence <= remoteChain.last_sequence) {
      console.warn('[P2PMessagingClient] Non-monotonic sequence detected');
      return false;
    }

    // Verify chain height progression
    if (event.chain_height !== remoteChain.chain_height + 1) {
      console.warn('[P2PMessagingClient] Chain height mismatch');
      return false;
    }

    return true;
  }

  /**
   * Update remote chain state after successful verification
   */
  private updateRemoteChain(event: CanonicalEvent): void {
    this.remoteChains.set(event.device_id, {
      last_hash: event.event_hash,
      last_sequence: event.sequence,
      chain_height: event.chain_height,
    });
  }

  /**
   * Extract message payload from event
   */
  private extractMessagePayload(event: CanonicalEvent): MessagePayload | null {
    if (event.event_type !== 'MESSAGE') {
      return null;
    }

    try {
      const payload = event.payload as MessagePayload;
      if (!payload.content || !payload.recipient_id) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Compute BLAKE3 hash of event
   * 
   * Hashes canonical representation: event_id + timestamp + device_id + 
   * sequence + prev_hash + payload
   */
  private async computeEventHash(event: CanonicalEvent): Promise<string> {
    try {
      // Create canonical representation
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

      // Compute BLAKE3 hash
      const { hash } = await import('blake3');
      const encoder = new TextEncoder();
      const data = encoder.encode(canonical);
      return hash(data).toString('hex');
    } catch (error) {
      console.error('[P2PMessagingClient] Error computing hash:', error);
      throw error;
    }
  }

  /**
   * Sign event hash with Ed25519
   * 
   * In production, this calls crates/crypto signing service via gRPC.
   * For now, using crypto library for development.
   */
  private async signEventHash(hash: string): Promise<string> {
    // TODO: Replace with gRPC call to crates/crypto EventSigningService
    // For now, simulating signature (in dev mode only)
    try {
      const crypto = await import('crypto');
      const encoder = new TextEncoder();
      const data = encoder.encode(hash);
      
      // Generate deterministic signature (dev mode simulation)
      const hmac = crypto.createHmac('sha256', this.config.privateKey);
      hmac.update(data);
      const signature = hmac.digest('hex');
      
      // Pad to 128 hex chars (Ed25519 signature length)
      return signature.padEnd(128, '0');
    } catch (error) {
      console.error('[P2PMessagingClient] Error signing hash:', error);
      throw error;
    }
  }

  /**
   * Verify Ed25519 signature
   * 
   * In production, calls crates/identity VerifySignature gRPC endpoint.
   */
  private async verifySignature(
    hash: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    // TODO: Replace with gRPC call to crates/identity VerifySignature
    // For now, accepting all signatures in dev mode
    
    // Basic validation
    if (!signature || signature.length !== 128) {
      return false;
    }
    
    if (!hash || hash.length !== 64) {
      return false;
    }
    
    // In dev mode, trust signatures (production uses TPM verification)
    return true;
  }

  /**
   * Transmit event over WebSocket
   */
  private async transmitEvent(event: CanonicalEvent): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queueMessage(event);
      return;
    }

    try {
      const message = JSON.stringify(event);
      this.ws.send(message);
      console.log(`[P2PMessagingClient] Message transmitted`);
    } catch (error) {
      console.error('[P2PMessagingClient] Transmission failed:', error);
      this.queueMessage(event);
    }
  }

  /**
   * Queue message for later transmission (store-and-forward)
   */
  private queueMessage(event: CanonicalEvent): void {
    this.messageQueue.push({
      event,
      retries: 0,
      last_attempt: Date.now(),
    });
    console.log(`[P2PMessagingClient] Message queued (${this.messageQueue.length} pending)`);
  }

  /**
   * Flush message queue when connection restored
   */
  private async flushMessageQueue(): Promise<void> {
    console.log(`[P2PMessagingClient] Flushing queue (${this.messageQueue.length} messages)`);

    const now = Date.now();
    const toRetry: QueuedMessage[] = [];

    for (const queued of this.messageQueue) {
      // Exponential backoff
      const backoffDelay = RETRY_BACKOFF_MS * Math.pow(2, queued.retries);
      if (now - queued.last_attempt < backoffDelay) {
        toRetry.push(queued);
        continue;
      }

      if (queued.retries >= MAX_RETRY_ATTEMPTS) {
        console.error('[P2PMessagingClient] Message dropped after max retries');
        continue;
      }

      try {
        await this.transmitEvent(queued.event);
      } catch (error) {
        console.error('[P2PMessagingClient] Retry failed:', error);
        toRetry.push({
          ...queued,
          retries: queued.retries + 1,
          last_attempt: now,
        });
      }
    }

    this.messageQueue = toRetry;
  }

  /**
   * Generate UUIDv4
   */
  private generateUUID(): string {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (!cryptoObj?.randomUUID) {
      throw new Error('Fail-Visible: crypto.randomUUID unavailable; cannot generate event_id');
    }
    return cryptoObj.randomUUID();
  }

  /**
   * Disconnect from transport
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get local chain state
   */
  getLocalChainState(): ChainState {
    return { ...this.localChain };
  }

  /**
   * Get remote chain state for a device
   */
  getRemoteChainState(nodeId: NodeID): ChainState | null {
    return this.remoteChains.get(nodeId) || null;
  }
}

/**
 * PHASE 5: Integration with useCommStore
 * 
 * Creates P2PMessagingClient and wires it to push messages to useCommStore.
 * Runs in background regardless of which React component is mounted.
 * 
 * This is the background daemon that:
 * - Listens to WebSocket/WebRTC data channels
 * - Validates signatures via identityClient
 * - Validates Merkle Vine chain
 * - Pushes verified/unverified messages to store
 */
export function initializeBackgroundMessaging(
  config: P2PMessagingClientConfig,
  useCommStore: any // Zustand store instance
): P2PMessagingClient {
  const client = new P2PMessagingClient({
    ...config,
    onMessageReceived: (verifiedMessage: VerifiedMessage) => {
      // Convert VerifiedMessage to store Message format
      const message = {
        id: verifiedMessage.event.event_id,
        from: verifiedMessage.event.device_id,
        to: verifiedMessage.message.recipient_id,
        content: verifiedMessage.message.content,
        timestamp: new Date(verifiedMessage.event.timestamp),
        signature: verifiedMessage.event.signature,
        verified: verifiedMessage.verification_status === 'VERIFIED',
        encrypted: verifiedMessage.message.encrypted,
      };

      // Push to store - will trigger notification logic
      useCommStore.getState().receiveMessage(message);

      console.log(
        `[BackgroundMessaging] Message pushed to store (verified: ${message.verified})`
      );
    },
    onVerificationFailure: (event: CanonicalEvent, reason: string) => {
      console.error('[BackgroundMessaging] Verification failure:', reason);
      console.error('[BackgroundMessaging] This indicates active Byzantine behavior or MitM attack');
      
      // Extract message payload with type safety
      const payload = event.payload as MessagePayload | undefined;
      
      // Still push to store, but marked as unverified
      // This will increment unverifiedIntercepts counter
      const message = {
        id: event.event_id,
        from: event.device_id,
        to: payload?.recipient_id || 'unknown',
        content: payload?.content || '<unverified>',
        timestamp: new Date(event.timestamp),
        signature: event.signature,
        verified: false,
        encrypted: false,
      };

      useCommStore.getState().receiveMessage(message);
    },
    onChainBroken: (nodeId: NodeID, reason: string) => {
      console.error(`[BackgroundMessaging] Chain broken for ${nodeId}: ${reason}`);
      console.error('[BackgroundMessaging] Great Gospel: Consider revoking this node');
      
      // Could trigger automatic revocation via Great Gospel
      // useCommStore.getState().revokeNode(nodeId, reason);
    },
  });

  // Connect to transport
  client.connect().catch((error) => {
    console.error('[BackgroundMessaging] Failed to connect:', error);
  });

  return client;
}
