/**
 * Signing Service Client - TPM-Backed Ed25519 Signatures
 * 
 * Bridges TypeScript dashboard to Rust Signing Service (crates/crypto).
 * All signature creation and verification MUST use hardware-backed keys via this client.
 * 
 * gRPC Service: aethercore.crypto.SigningService
 * Proto: crates/crypto/proto/signing.proto
 * 
 * Security Model:
 * - Private keys NEVER leave TPM (CodeRalphie integration)
 * - < 1ms signing latency for high-velocity telemetry streams
 * - Zero-copy operations for performance
 * - NO GRACEFUL DEGRADATION: If TPM fails, the node is compromised
 * 
 * CRITICAL: This replaces all mock signing logic in the codebase.
 */

import type { NodeID } from './identityClient';

/**
 * Signing Service Client Configuration
 */
export interface SigningClientConfig {
  /** gRPC service endpoint (default: localhost:50053) */
  endpoint: string;
  
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  
  /** Enable request/response logging */
  enableLogging?: boolean;
  
  /** Enable performance monitoring (latency tracking) */
  enablePerformanceMonitoring?: boolean;
}

/**
 * Request to sign a message
 */
export interface SignMessageRequest {
  node_id: NodeID;
  message: Uint8Array;
  timestamp_ms: number;
}

/**
 * Response containing the signature
 */
export interface SignMessageResponse {
  success: boolean;
  signature_hex: string;
  public_key_id: string;
  error_message?: string;
  timestamp_ms: number;
  latency_us: number;
}

/**
 * Request to get public key
 */
export interface GetPublicKeyRequest {
  node_id: NodeID;
}

/**
 * Response containing the public key
 */
export interface GetPublicKeyResponse {
  success: boolean;
  public_key_hex: string;
  public_key_id: string;
  error_message?: string;
  timestamp_ms: number;
}

/**
 * Request to create a signed envelope
 */
export interface CreateSignedEnvelopeRequest {
  node_id: NodeID;
  payload: Uint8Array;
  timestamp_ms: number;
}

/**
 * Response containing the signed envelope
 */
export interface CreateSignedEnvelopeResponse {
  success: boolean;
  envelope_json: string;
  error_message?: string;
  timestamp_ms: number;
  latency_us: number;
}

/**
 * Request to verify a signature (local verification)
 */
export interface VerifySignatureRequest {
  public_key_hex: string;
  message: Uint8Array;
  signature_hex: string;
}

/**
 * Response from signature verification
 */
export interface VerifySignatureResponse {
  is_valid: boolean;
  error_message?: string;
  timestamp_ms: number;
}

/**
 * Signing Client Error
 */
export class SigningClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'SigningClientError';
  }
}

/**
 * Performance metrics for signing operations
 */
export interface SigningMetrics {
  totalSignOperations: number;
  averageLatencyUs: number;
  minLatencyUs: number;
  maxLatencyUs: number;
  lastLatencyUs: number;
}

/**
 * Signing Service Client
 * 
 * Provides access to TPM-backed Ed25519 signing operations.
 * All methods throw SigningClientError on failure (Fail-Visible).
 */
export class SigningClient {
  private config: Required<SigningClientConfig>;
  private controller: AbortController | null = null;
  private metrics: SigningMetrics | null = null;

  constructor(config: SigningClientConfig) {
    this.config = {
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs ?? 5000,
      enableLogging: config.enableLogging ?? false,
      enablePerformanceMonitoring: config.enablePerformanceMonitoring ?? false,
    };

    // Normalize endpoint (remove trailing slash)
    if (this.config.endpoint.endsWith('/')) {
      this.config.endpoint = this.config.endpoint.slice(0, -1);
    }

    // Initialize metrics if performance monitoring enabled
    if (this.config.enablePerformanceMonitoring) {
      this.metrics = {
        totalSignOperations: 0,
        averageLatencyUs: 0,
        minLatencyUs: Number.MAX_SAFE_INTEGER,
        maxLatencyUs: 0,
        lastLatencyUs: 0,
      };
    }

    if (this.config.enableLogging) {
      console.log('[SigningClient] Initialized with endpoint:', this.config.endpoint);
    }
  }

  /**
   * Sign a message with TPM-backed Ed25519 key
   * 
   * CRITICAL: Private key NEVER leaves TPM. Signing happens in hardware.
   * 
   * @param nodeId NodeID (identifies the TPM key to use)
   * @param message Message to sign (raw bytes)
   * @returns Signature response with Ed25519 signature
   * @throws SigningClientError if signing fails
   */
  async signMessage(nodeId: NodeID, message: Uint8Array): Promise<SignMessageResponse> {
    if (!nodeId || typeof nodeId !== 'string') {
      throw new SigningClientError(
        'Invalid NodeID',
        'INVALID_NODE_ID',
        { nodeId }
      );
    }

    if (!message || message.length === 0) {
      throw new SigningClientError(
        'Message cannot be empty',
        'INVALID_MESSAGE',
        { messageLength: message?.length }
      );
    }

    const request: SignMessageRequest = {
      node_id: nodeId,
      message,
      timestamp_ms: Date.now(),
    };

    const response = await this.callRpc<SignMessageRequest, SignMessageResponse>(
      'SignMessage',
      request
    );

    if (!response.success) {
      throw new SigningClientError(
        response.error_message || 'Failed to sign message',
        'SIGN_MESSAGE_FAILED',
        { nodeId }
      );
    }

    // Update performance metrics
    if (this.metrics) {
      this.updateMetrics(response.latency_us);
    }

    if (this.config.enableLogging) {
      console.log(
        `[SigningClient] SignMessage(${nodeId}) -> ${response.signature_hex.slice(0, 16)}... (${response.latency_us}µs)`
      );
    }

    return response;
  }

  /**
   * Get public key for a node
   * 
   * @param nodeId NodeID
   * @returns Public key response
   * @throws SigningClientError if request fails
   */
  async getPublicKey(nodeId: NodeID): Promise<GetPublicKeyResponse> {
    if (!nodeId || typeof nodeId !== 'string') {
      throw new SigningClientError(
        'Invalid NodeID',
        'INVALID_NODE_ID',
        { nodeId }
      );
    }

    const request: GetPublicKeyRequest = { node_id: nodeId };
    const response = await this.callRpc<GetPublicKeyRequest, GetPublicKeyResponse>(
      'GetPublicKey',
      request
    );

    if (!response.success) {
      throw new SigningClientError(
        response.error_message || 'Failed to get public key',
        'GET_PUBLIC_KEY_FAILED',
        { nodeId }
      );
    }

    if (this.config.enableLogging) {
      console.log(`[SigningClient] GetPublicKey(${nodeId}) -> ${response.public_key_hex.slice(0, 16)}...`);
    }

    return response;
  }

  /**
   * Create a signed envelope (convenience method)
   * 
   * Wraps payload in SignedEnvelope structure with signature, timestamp, and nonce.
   * 
   * @param nodeId NodeID (signer)
   * @param payload Payload to sign
   * @returns Signed envelope as JSON string
   * @throws SigningClientError if signing fails
   */
  async createSignedEnvelope(nodeId: NodeID, payload: Uint8Array): Promise<CreateSignedEnvelopeResponse> {
    if (!nodeId || typeof nodeId !== 'string') {
      throw new SigningClientError(
        'Invalid NodeID',
        'INVALID_NODE_ID',
        { nodeId }
      );
    }

    if (!payload || payload.length === 0) {
      throw new SigningClientError(
        'Payload cannot be empty',
        'INVALID_PAYLOAD',
        { payloadLength: payload?.length }
      );
    }

    const request: CreateSignedEnvelopeRequest = {
      node_id: nodeId,
      payload,
      timestamp_ms: Date.now(),
    };

    const response = await this.callRpc<CreateSignedEnvelopeRequest, CreateSignedEnvelopeResponse>(
      'CreateSignedEnvelope',
      request
    );

    if (!response.success) {
      throw new SigningClientError(
        response.error_message || 'Failed to create signed envelope',
        'CREATE_ENVELOPE_FAILED',
        { nodeId }
      );
    }

    // Update performance metrics
    if (this.metrics) {
      this.updateMetrics(response.latency_us);
    }

    if (this.config.enableLogging) {
      console.log(
        `[SigningClient] CreateSignedEnvelope(${nodeId}) -> ${response.envelope_json.slice(0, 32)}... (${response.latency_us}µs)`
      );
    }

    return response;
  }

  /**
   * Verify a signature (local verification)
   * 
   * This performs cryptographic verification without contacting the Identity Registry.
   * Use IdentityClient.verifySignature() for full verification including enrollment checks.
   * 
   * @param publicKeyHex Ed25519 public key (32 bytes, hex-encoded)
   * @param message Message that was signed
   * @param signatureHex Ed25519 signature (64 bytes, hex-encoded)
   * @returns Verification result
   * @throws SigningClientError if request fails
   */
  async verifySignature(
    publicKeyHex: string,
    message: Uint8Array,
    signatureHex: string
  ): Promise<VerifySignatureResponse> {
    if (!publicKeyHex || publicKeyHex.length !== 64) {
      throw new SigningClientError(
        'Invalid public key format (must be 64 hex characters)',
        'INVALID_PUBLIC_KEY',
        { publicKeyHex }
      );
    }

    if (!signatureHex || signatureHex.length !== 128) {
      throw new SigningClientError(
        'Invalid signature format (must be 128 hex characters)',
        'INVALID_SIGNATURE',
        { signatureHex }
      );
    }

    if (!message || message.length === 0) {
      throw new SigningClientError(
        'Message cannot be empty',
        'INVALID_MESSAGE',
        { messageLength: message?.length }
      );
    }

    const request: VerifySignatureRequest = {
      public_key_hex: publicKeyHex,
      message,
      signature_hex: signatureHex,
    };

    const response = await this.callRpc<VerifySignatureRequest, VerifySignatureResponse>(
      'VerifySignature',
      request
    );

    if (this.config.enableLogging) {
      console.log(
        `[SigningClient] VerifySignature() -> ${response.is_valid ? 'VALID' : 'INVALID'}`
      );
    }

    // Fail-Visible: Log signature verification failures
    if (!response.is_valid) {
      console.error(`[SigningClient] LOCAL SIGNATURE VERIFICATION FAILED`);
      console.error(`  Reason: ${response.error_message || 'Unknown'}`);
    }

    return response;
  }

  /**
   * Get performance metrics
   * 
   * Returns null if performance monitoring is disabled.
   */
  getMetrics(): SigningMetrics | null {
    return this.metrics ? { ...this.metrics } : null;
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    if (this.metrics) {
      this.metrics = {
        totalSignOperations: 0,
        averageLatencyUs: 0,
        minLatencyUs: Number.MAX_SAFE_INTEGER,
        maxLatencyUs: 0,
        lastLatencyUs: 0,
      };
    }
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(latencyUs: number): void {
    if (!this.metrics) return;

    this.metrics.totalSignOperations++;
    this.metrics.lastLatencyUs = latencyUs;
    this.metrics.minLatencyUs = Math.min(this.metrics.minLatencyUs, latencyUs);
    this.metrics.maxLatencyUs = Math.max(this.metrics.maxLatencyUs, latencyUs);

    // Update rolling average
    const alpha = 0.1; // Smoothing factor
    if (this.metrics.averageLatencyUs === 0) {
      this.metrics.averageLatencyUs = latencyUs;
    } else {
      this.metrics.averageLatencyUs =
        alpha * latencyUs + (1 - alpha) * this.metrics.averageLatencyUs;
    }
  }

  /**
   * Call gRPC method via gRPC-JSON gateway
   */
  private async callRpc<TRequest, TResponse>(
    method: string,
    request: TRequest
  ): Promise<TResponse> {
    const url = `${this.config.endpoint}/aethercore.crypto.SigningService/${method}`;

    // Create abort controller for timeout
    this.controller = new AbortController();
    const timeoutId = setTimeout(() => {
      this.controller?.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: this.controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new SigningClientError(
          `gRPC call failed: ${response.statusText}`,
          'RPC_FAILED',
          {
            method,
            status: response.status,
            statusText: response.statusText,
          }
        );
      }

      const data = await response.json();
      return data as TResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SigningClientError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new SigningClientError(
            `Request timeout after ${this.config.timeoutMs}ms`,
            'TIMEOUT',
            { method }
          );
        }

        throw new SigningClientError(
          `Network error: ${error.message}`,
          'NETWORK_ERROR',
          { method, error: error.message }
        );
      }

      throw new SigningClientError(
        'Unknown error during RPC call',
        'UNKNOWN_ERROR',
        { method }
      );
    }
  }

  /**
   * Close client and cleanup resources
   */
  close(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }

    if (this.config.enableLogging) {
      console.log('[SigningClient] Closed');
    }
  }
}

/**
 * Create a new Signing Service Client
 * 
 * @param endpoint gRPC service endpoint (default: http://localhost:50053)
 * @param options Optional configuration
 * @returns Signing client instance
 */
export function createSigningClient(
  endpoint = 'http://localhost:50053',
  options?: Partial<SigningClientConfig>
): SigningClient {
  return new SigningClient({
    endpoint,
    ...options,
  });
}
