/**
 * Identity Registry gRPC Client - Hardware-Rooted Trust Fabric Integration
 * 
 * This client replaces MockIdentityRegistry with production gRPC calls to
 * the Rust-based Identity Registry service (crates/identity).
 * 
 * Security Model:
 * - NO GRACEFUL DEGRADATION: If identity service is unreachable, nodes are Byzantine
 * - Timeout windows account for contested/congested network conditions
 * - All failures are logged as security events with fail-visible semantics
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'fs';
import path from 'path';
import { NodeID } from '@aethercore/shared';

// Load proto file
const PROTO_PATH = path.join(__dirname, '../proto/identity_registry.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto: any = grpc.loadPackageDefinition(packageDefinition);
const identityProto = proto.aethercore.identity;

/**
 * Configuration for Identity Registry gRPC client
 */
export interface IdentityRegistryConfig {
  /** gRPC server address (e.g., 'localhost:50051') */
  serverAddress: string;
  /** Timeout in milliseconds for gRPC calls (default: 5000ms) */
  timeout?: number;
  /** Maximum retry attempts for failed requests (default: 3) */
  maxRetries?: number;
  /** Retry delay in milliseconds (default: 1000ms) */
  retryDelay?: number;
  /** Use TLS for gRPC connection (default: true in production) */
  useTls?: boolean;
  /** Path to CA certificate file (required if useTls is true) */
  caCertPath?: string;
  /** Path to client key file (optional for mTLS) */
  clientKeyPath?: string;
  /** Path to client certificate file (optional for mTLS) */
  clientCertPath?: string;
}

/**
 * Identity Registry gRPC Client
 * 
 * Provides hardware-backed identity verification for the 4MIK Trust Fabric.
 * Replaces MockIdentityRegistry with production gRPC integration.
 */
export class IdentityRegistryClient {
  private client: any;
  private config: IdentityRegistryConfig & {
    timeout: number;
    maxRetries: number;
    retryDelay: number;
    useTls: boolean;
  };

  constructor(config: IdentityRegistryConfig) {
    this.config = {
      timeout: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      useTls: process.env.NODE_ENV === 'production', // Enable TLS in production by default
      ...config,
    };

    // Create gRPC credentials
    let credentials: grpc.ChannelCredentials;
    
    if (this.config.useTls) {
      // Production mode: Use TLS credentials
      if (!this.config.caCertPath) {
        throw new Error(
          'TLS enabled but no CA certificate path provided. Set caCertPath or disable TLS for development.',
        );
      }

      try {
        const rootCert = fs.readFileSync(this.config.caCertPath);
        
        if (this.config.clientKeyPath && this.config.clientCertPath) {
          // mTLS: mutual authentication
          const clientKey = fs.readFileSync(this.config.clientKeyPath);
          const clientCert = fs.readFileSync(this.config.clientCertPath);
          credentials = grpc.credentials.createSsl(rootCert, clientKey, clientCert);
          console.log('[IdentityRegistryClient] Using mTLS credentials');
        } else {
          // Server-only TLS
          credentials = grpc.credentials.createSsl(rootCert);
          console.log('[IdentityRegistryClient] Using TLS credentials');
        }
      } catch (error) {
        throw new Error(
          `Failed to load TLS certificates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      // Development mode: Insecure connection
      credentials = grpc.credentials.createInsecure();
      console.warn(
        '[IdentityRegistryClient] WARNING: Using insecure connection. This is NOT suitable for production.',
      );
    }

    this.client = new identityProto.IdentityRegistry(
      this.config.serverAddress,
      credentials,
    );

    console.log(
      `[IdentityRegistryClient] Connected to ${this.config.serverAddress} (TLS: ${this.config.useTls ? 'enabled' : 'disabled'})`,
    );
  }

  /**
   * Get public key for a NodeID
   * 
   * @param nodeId - NodeID (64-character hex string)
   * @returns Public key in hex format, or null if not found
   * @throws Error if gRPC call fails after retries
   */
  async getPublicKey(nodeId: NodeID): Promise<string | null> {
    const request = { node_id: nodeId };

    return this.retryableCall<string | null>(
      'getPublicKey',
      request,
      (response: any) => {
        if (!response.success) {
          console.warn(
            `[IdentityRegistryClient] GetPublicKey failed: ${response.error_message}`,
          );
          return null;
        }

        if (!response.public_key_hex) {
          return null;
        }

        return response.public_key_hex;
      },
    );
  }

  /**
   * Check if a node is enrolled in the Trust Fabric
   * 
   * @param nodeId - NodeID to check
   * @returns True if enrolled and not revoked, false otherwise
   * @throws Error if gRPC call fails after retries (FAIL-VISIBLE)
   */
  async isNodeEnrolled(nodeId: NodeID): Promise<boolean> {
    const request = { node_id: nodeId };

    return this.retryableCall<boolean>(
      'isNodeEnrolled',
      request,
      (response: any) => {
        if (!response.success) {
          // FAIL-VISIBLE: If identity service fails, we cannot trust the node
          throw new Error(
            `Identity service failure for node ${nodeId}: ${response.error_message}`,
          );
        }

        return response.is_enrolled;
      },
    );
  }

  /**
   * Verify a signed envelope (full verification)
   * 
   * @param nodeId - NodeID of the signer
   * @param payload - Payload that was signed (as Buffer)
   * @param signatureHex - Ed25519 signature (64 bytes, hex-encoded)
   * @param timestampMs - Timestamp from SignedEnvelope
   * @param nonceHex - Nonce from SignedEnvelope
   * @returns True if signature is valid, false otherwise
   * @throws Error if gRPC call fails (FAIL-VISIBLE)
   */
  async verifySignature(
    nodeId: NodeID,
    payload: Buffer,
    signatureHex: string,
    timestampMs: number,
    nonceHex: string,
  ): Promise<{
    isValid: boolean;
    failureReason?: string;
    securityEventType?: string;
  }> {
    const request = {
      node_id: nodeId,
      payload: payload,
      signature_hex: signatureHex,
      timestamp_ms: timestampMs,
      nonce_hex: nonceHex,
    };

    return this.retryableCall(
      'verifySignature',
      request,
      (response: any) => {
        return {
          isValid: response.is_valid,
          failureReason: response.failure_reason || undefined,
          securityEventType: response.security_event_type || undefined,
        };
      },
    );
  }

  /**
   * Retryable gRPC call with timeout and exponential backoff
   * 
   * @param method - gRPC method name
   * @param request - Request object
   * @param responseHandler - Function to process the response
   * @returns Processed response
   * @throws Error if all retries fail
   */
  private async retryableCall<T>(
    method: string,
    request: any,
    responseHandler: (response: any) => T,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.callWithTimeout(method, request);
        return responseHandler(response);
      } catch (error) {
        lastError = error as Error;

        // Log the error
        console.error(
          `[IdentityRegistryClient] ${method} attempt ${attempt + 1}/${this.config.maxRetries} failed:`,
          error,
        );

        // Wait before retrying (exponential backoff)
        if (attempt < this.config.maxRetries - 1) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          console.log(
            `[IdentityRegistryClient] Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - FAIL-VISIBLE
    const errorMessage = `Identity Registry ${method} failed after ${this.config.maxRetries} attempts: ${lastError?.message}`;
    console.error(`[IdentityRegistryClient] CRITICAL: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  /**
   * Call gRPC method with timeout
   * 
   * @param method - gRPC method name
   * @param request - Request object
   * @returns Response from gRPC call
   */
  private callWithTimeout(method: string, request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + this.config.timeout);

      this.client[method](
        request,
        { deadline },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  /**
   * Close the gRPC client connection
   */
  close(): void {
    this.client.close();
    console.log('[IdentityRegistryClient] Connection closed');
  }
}

/**
 * Create a new Identity Registry client with default configuration
 * 
 * @param serverAddress - gRPC server address (default: 'localhost:50051')
 * @returns IdentityRegistryClient instance
 */
export function createIdentityRegistryClient(
  serverAddress: string = 'localhost:50051',
): IdentityRegistryClient {
  return new IdentityRegistryClient({ serverAddress });
}
