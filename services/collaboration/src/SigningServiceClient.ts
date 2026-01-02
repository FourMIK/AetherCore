/**
 * Signing Service gRPC Client - TPM-Backed Ed25519 Signatures (CodeRalphie)
 * 
 * This client replaces mock signature generation with production gRPC calls to
 * the Rust-based Signing Service (crates/crypto).
 * 
 * Security Model:
 * - Private keys are TPM-resident and NEVER leave the secure element
 * - < 1ms signing latency for high-velocity telemetry streams
 * - NO GRACEFUL DEGRADATION: If signing service fails, the node is compromised
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { NodeID, SignedEnvelope } from '@aethercore/shared';

// Load proto file
const PROTO_PATH = path.join(__dirname, '../proto/signing.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto: any = grpc.loadPackageDefinition(packageDefinition);
const signingProto = proto.aethercore.crypto;

/**
 * Configuration for Signing Service gRPC client
 */
export interface SigningServiceConfig {
  /** gRPC server address (e.g., 'localhost:50052') */
  serverAddress: string;
  /** Timeout in milliseconds for gRPC calls (default: 2000ms) */
  timeout?: number;
  /** Maximum retry attempts for failed requests (default: 3) */
  maxRetries?: number;
  /** Retry delay in milliseconds (default: 500ms) */
  retryDelay?: number;
}

/**
 * Signing Service gRPC Client
 * 
 * Provides TPM-backed Ed25519 signing for the 4MIK Trust Fabric.
 * Replaces mock signature generation with hardware-backed signatures.
 */
export class SigningServiceClient {
  private client: any;
  private config: Required<SigningServiceConfig>;

  constructor(config: SigningServiceConfig) {
    this.config = {
      timeout: 2000, // 2 second timeout (< 1ms target + network overhead)
      maxRetries: 3,
      retryDelay: 500,
      ...config,
    };

    // Create gRPC client
    // TODO: In production, use TLS credentials:
    // const credentials = grpc.credentials.createSsl(
    //   fs.readFileSync('ca.pem'),
    //   fs.readFileSync('key.pem'),
    //   fs.readFileSync('cert.pem')
    // );
    this.client = new signingProto.SigningService(
      this.config.serverAddress,
      grpc.credentials.createInsecure(),
    );

    console.log(
      `[SigningServiceClient] Connected to ${this.config.serverAddress}`,
    );
  }

  /**
   * Create a signed envelope with TPM-backed signature
   * 
   * @param payload - Payload to sign (will be JSON stringified)
   * @param nodeId - NodeID (identifies the TPM key to use)
   * @returns SignedEnvelope with hardware-backed signature
   * @throws Error if signing fails after retries (FAIL-VISIBLE)
   */
  async createSignedEnvelope(
    payload: any,
    nodeId: NodeID,
  ): Promise<SignedEnvelope> {
    const payloadStr = JSON.stringify(payload);
    const timestamp = Date.now();

    const request = {
      node_id: nodeId,
      payload: Buffer.from(payloadStr, 'utf-8'),
      timestamp_ms: timestamp,
    };

    return this.retryableCall<SignedEnvelope>(
      'createSignedEnvelope',
      request,
      (response: any) => {
        if (!response.success) {
          throw new Error(
            `Signing failed: ${response.error_message || 'Unknown error'}`,
          );
        }

        // Log performance metrics
        if (response.latency_us && response.latency_us > 1000) {
          console.warn(
            `[SigningServiceClient] WARNING: Signing latency exceeded 1ms target: ${response.latency_us}µs`,
          );
        } else if (response.latency_us) {
          console.log(
            `[SigningServiceClient] Signing latency: ${response.latency_us}µs`,
          );
        }

        // Parse the envelope JSON
        const envelope = JSON.parse(response.envelope_json);
        return envelope as SignedEnvelope;
      },
    );
  }

  /**
   * Sign a raw message with TPM-backed Ed25519 key
   * 
   * @param message - Message to sign (as Buffer)
   * @param nodeId - NodeID (identifies the TPM key to use)
   * @returns Signature in hex format
   * @throws Error if signing fails (FAIL-VISIBLE)
   */
  async signMessage(
    message: Buffer,
    nodeId: NodeID,
  ): Promise<{
    signatureHex: string;
    publicKeyId: string;
    latencyUs: number;
  }> {
    const request = {
      node_id: nodeId,
      message: message,
      timestamp_ms: Date.now(),
    };

    return this.retryableCall(
      'signMessage',
      request,
      (response: any) => {
        if (!response.success) {
          throw new Error(
            `Signing failed: ${response.error_message || 'Unknown error'}`,
          );
        }

        // Log performance metrics
        if (response.latency_us > 1000) {
          console.warn(
            `[SigningServiceClient] WARNING: Signing latency exceeded 1ms target: ${response.latency_us}µs`,
          );
        }

        return {
          signatureHex: response.signature_hex,
          publicKeyId: response.public_key_id,
          latencyUs: response.latency_us || 0,
        };
      },
    );
  }

  /**
   * Get public key for a node
   * 
   * @param nodeId - NodeID
   * @returns Public key in hex format
   * @throws Error if request fails
   */
  async getPublicKey(nodeId: NodeID): Promise<string> {
    const request = { node_id: nodeId };

    return this.retryableCall<string>(
      'getPublicKey',
      request,
      (response: any) => {
        if (!response.success) {
          throw new Error(
            `Failed to get public key: ${response.error_message || 'Unknown error'}`,
          );
        }

        return response.public_key_hex;
      },
    );
  }

  /**
   * Verify a signature (local verification)
   * 
   * @param publicKeyHex - Public key (32 bytes, hex-encoded)
   * @param message - Message that was signed
   * @param signatureHex - Signature to verify (64 bytes, hex-encoded)
   * @returns True if signature is valid, false otherwise
   */
  async verifySignature(
    publicKeyHex: string,
    message: Buffer,
    signatureHex: string,
  ): Promise<boolean> {
    const request = {
      public_key_hex: publicKeyHex,
      message: message,
      signature_hex: signatureHex,
    };

    return this.retryableCall<boolean>(
      'verifySignature',
      request,
      (response: any) => {
        return response.is_valid;
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
          `[SigningServiceClient] ${method} attempt ${attempt + 1}/${this.config.maxRetries} failed:`,
          error,
        );

        // Wait before retrying (exponential backoff)
        if (attempt < this.config.maxRetries - 1) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          console.log(
            `[SigningServiceClient] Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - FAIL-VISIBLE
    const errorMessage = `Signing Service ${method} failed after ${this.config.maxRetries} attempts: ${lastError?.message}`;
    console.error(`[SigningServiceClient] CRITICAL: ${errorMessage}`);
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
    console.log('[SigningServiceClient] Connection closed');
  }
}

/**
 * Create a new Signing Service client with default configuration
 * 
 * @param serverAddress - gRPC server address (default: 'localhost:50052')
 * @returns SigningServiceClient instance
 */
export function createSigningServiceClient(
  serverAddress: string = 'localhost:50052',
): SigningServiceClient {
  return new SigningServiceClient({ serverAddress });
}
