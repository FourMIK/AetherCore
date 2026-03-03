/**
 * Identity Registry Client - Hardware-Rooted Trust Verification
 * 
 * Bridges TypeScript dashboard to Rust Identity Registry Service (crates/identity).
 * All node enrollment and trust verification flows MUST go through this client.
 * 
 * gRPC Service: aethercore.identity.IdentityRegistry
 * Proto: crates/identity/proto/identity_registry.proto
 * 
 * Security Model:
 * - NO GRACEFUL DEGRADATION: If hardware attestation fails, node is Byzantine
 * - All queries complete within timeout windows (contested/congested aware)
 * - Fail-Visible: Verification failures are explicit, never hidden
 * 
 * CRITICAL: This replaces all MockIdentityRegistry usage in the codebase.
 */

/**
 * NodeID type (64-character hex string - BLAKE3 hash of public key)
 */
export type NodeID = string;

/**
 * Ed25519 public key (32 bytes, hex-encoded)
 */
export type PublicKeyHex = string;

/**
 * Identity Registry Client Configuration
 */
export interface IdentityClientConfig {
  /** gRPC service endpoint (default: localhost:50052) */
  endpoint: string;
  
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  
  /** Enable request/response logging */
  enableLogging?: boolean;
}

/**
 * Request to get a node's public key
 */
export interface GetPublicKeyRequest {
  node_id: NodeID;
}

/**
 * Response containing the public key
 */
export interface GetPublicKeyResponse {
  success: boolean;
  public_key_hex: PublicKeyHex;
  error_message?: string;
  timestamp_ms: number;
}

/**
 * Request to check if a node is enrolled
 */
export interface IsNodeEnrolledRequest {
  node_id: NodeID;
}

/**
 * Response indicating enrollment status
 */
export interface IsNodeEnrolledResponse {
  success: boolean;
  is_enrolled: boolean;
  error_message?: string;
  timestamp_ms: number;
}

/**
 * Request to verify a signature
 */
export interface VerifySignatureRequest {
  node_id: NodeID;
  payload: Uint8Array;
  signature_hex: string;
  timestamp_ms: number;
  nonce_hex: string;
}

/**
 * Response from signature verification
 */
export interface VerifySignatureResponse {
  is_valid: boolean;
  failure_reason?: string;
  timestamp_ms: number;
  security_event_type?: string;
}

/**
 * Identity Registry Client Error
 */
export class IdentityClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'IdentityClientError';
  }
}

/**
 * Identity Registry Client
 * 
 * Provides access to hardware-rooted identity verification services.
 * All methods throw IdentityClientError on failure (Fail-Visible).
 */
export class IdentityClient {
  private config: Required<IdentityClientConfig>;
  private controller: AbortController | null = null;

  constructor(config: IdentityClientConfig) {
    this.config = {
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs ?? 5000,
      enableLogging: config.enableLogging ?? false,
    };

    // Normalize endpoint (remove trailing slash)
    if (this.config.endpoint.endsWith('/')) {
      this.config.endpoint = this.config.endpoint.slice(0, -1);
    }

    if (this.config.enableLogging) {
      console.log('[IdentityClient] Initialized with endpoint:', this.config.endpoint);
    }
  }

  /**
   * Get public key for a NodeID
   * 
   * @param nodeId NodeID (64-character hex string)
   * @returns Public key response
   * @throws IdentityClientError if request fails or node not found
   */
  async getPublicKey(nodeId: NodeID): Promise<GetPublicKeyResponse> {
    this.validateNodeId(nodeId);

    const request: GetPublicKeyRequest = { node_id: nodeId };
    const response = await this.callRpc<GetPublicKeyRequest, GetPublicKeyResponse>(
      'GetPublicKey',
      request
    );

    if (!response.success) {
      throw new IdentityClientError(
        response.error_message || 'Failed to get public key',
        'GET_PUBLIC_KEY_FAILED',
        { nodeId }
      );
    }

    if (this.config.enableLogging) {
      console.log(`[IdentityClient] GetPublicKey(${nodeId}) -> ${response.public_key_hex.slice(0, 16)}...`);
    }

    return response;
  }

  /**
   * Check if a node is enrolled in the Trust Fabric
   * 
   * CRITICAL: This MUST be called before accepting any telemetry or commands
   * from a node. Unenrolled nodes are Byzantine by definition.
   * 
   * @param nodeId NodeID to check
   * @returns Enrollment status
   * @throws IdentityClientError if request fails
   */
  async isNodeEnrolled(nodeId: NodeID): Promise<boolean> {
    this.validateNodeId(nodeId);

    const request: IsNodeEnrolledRequest = { node_id: nodeId };
    const response = await this.callRpc<IsNodeEnrolledRequest, IsNodeEnrolledResponse>(
      'IsNodeEnrolled',
      request
    );

    if (!response.success) {
      throw new IdentityClientError(
        response.error_message || 'Failed to check enrollment',
        'ENROLLMENT_CHECK_FAILED',
        { nodeId }
      );
    }

    if (this.config.enableLogging) {
      console.log(`[IdentityClient] IsNodeEnrolled(${nodeId}) -> ${response.is_enrolled}`);
    }

    // Fail-Visible: Log Byzantine detection
    if (!response.is_enrolled) {
      console.warn(`[IdentityClient] BYZANTINE NODE DETECTED: ${nodeId} is not enrolled`);
    }

    return response.is_enrolled;
  }

  /**
   * Verify a signed envelope
   * 
   * Performs full verification including:
   * - Ed25519 signature validation
   * - Timestamp freshness (replay attack detection)
   * - Nonce uniqueness
   * 
   * @param request Verification request
   * @returns Verification result
   * @throws IdentityClientError if request fails
   */
  async verifySignature(request: VerifySignatureRequest): Promise<VerifySignatureResponse> {
    this.validateNodeId(request.node_id);

    if (!request.signature_hex || request.signature_hex.length !== 128) {
      throw new IdentityClientError(
        'Invalid signature format (must be 128 hex characters)',
        'INVALID_SIGNATURE_FORMAT',
        { signature: request.signature_hex }
      );
    }

    const response = await this.callRpc<VerifySignatureRequest, VerifySignatureResponse>(
      'VerifySignature',
      {
        node_id: request.node_id,
        payload: request.payload,
        signature_hex: request.signature_hex,
        timestamp_ms: request.timestamp_ms,
        nonce_hex: request.nonce_hex,
      }
    );

    if (this.config.enableLogging) {
      console.log(
        `[IdentityClient] VerifySignature(${request.node_id}) -> ${response.is_valid ? 'VALID' : 'INVALID'}`
      );
    }

    // Fail-Visible: Log signature verification failures
    if (!response.is_valid) {
      console.error(`[IdentityClient] SIGNATURE VERIFICATION FAILED`);
      console.error(`  NodeID: ${request.node_id}`);
      console.error(`  Reason: ${response.failure_reason || 'Unknown'}`);
      console.error(`  Security Event: ${response.security_event_type || 'None'}`);
    }

    return response;
  }

  /**
   * Call gRPC method via gRPC-JSON gateway
   * 
   * @param method Method name (e.g., 'IsNodeEnrolled')
   * @param request Request payload
   * @returns Response payload
   * @throws IdentityClientError if request fails
   */
  private async callRpc<TRequest, TResponse>(
    method: string,
    request: TRequest
  ): Promise<TResponse> {
    const url = `${this.config.endpoint}/aethercore.identity.IdentityRegistry/${method}`;

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
        throw new IdentityClientError(
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

      if (error instanceof IdentityClientError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new IdentityClientError(
            `Request timeout after ${this.config.timeoutMs}ms`,
            'TIMEOUT',
            { method }
          );
        }

        throw new IdentityClientError(
          `Network error: ${error.message}`,
          'NETWORK_ERROR',
          { method, error: error.message }
        );
      }

      throw new IdentityClientError(
        'Unknown error during RPC call',
        'UNKNOWN_ERROR',
        { method }
      );
    }
  }

  /**
   * Validate NodeID format
   */
  private validateNodeId(nodeId: NodeID): void {
    if (!nodeId || typeof nodeId !== 'string') {
      throw new IdentityClientError(
        'Invalid NodeID: must be a non-empty string',
        'INVALID_NODE_ID',
        { nodeId }
      );
    }

    if (nodeId.length !== 64) {
      throw new IdentityClientError(
        'Invalid NodeID: must be 64 hex characters',
        'INVALID_NODE_ID',
        { nodeId, length: nodeId.length }
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(nodeId)) {
      throw new IdentityClientError(
        'Invalid NodeID: must contain only hex characters',
        'INVALID_NODE_ID',
        { nodeId }
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
      console.log('[IdentityClient] Closed');
    }
  }
}

/**
 * Create a new Identity Registry Client
 * 
 * @param endpoint gRPC service endpoint (default: http://localhost:50052)
 * @param options Optional configuration
 * @returns Identity client instance
 */
export function createIdentityClient(
  endpoint = 'http://localhost:50052',
  options?: Partial<IdentityClientConfig>
): IdentityClient {
  return new IdentityClient({
    endpoint,
    ...options,
  });
}
