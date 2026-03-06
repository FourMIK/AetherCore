/**
 * Endpoint Validation Utilities
 * 
 * Enforces TLS for all network communications in AetherCore.
 * Fail-Visible Doctrine: No silent insecure fallbacks.
 * 
 * Rules:
 * - Remote endpoints MUST use wss:// or https://
 * - Localhost endpoints MAY use ws:// or http:// ONLY when allow_insecure_localhost is enabled
 *   (Settings/runtime config) or when VITE_DEV_ALLOW_INSECURE_LOCALHOST=true in env fallback
 * - All other insecure connections are rejected with actionable errors
 */

import { getRuntimeConfig } from '../config/runtime';

export interface EndpointValidationResult {
  valid: boolean;
  error?: string;
  protocol?: 'ws' | 'wss' | 'http' | 'https';
  isLocalhost?: boolean;
}

/**
 * Check if a hostname is localhost
 */
function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === '::1'
  );
}

function isInsecureLocalhostAllowedAtRuntime(): boolean {
  try {
    return Boolean(getRuntimeConfig().devAllowInsecureLocalhost);
  } catch {
    return false;
  }
}

/**
 * Validate WebSocket endpoint URL
 */
export function validateWebSocketEndpoint(url: string): EndpointValidationResult {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '') as 'ws' | 'wss';
    const isLocalhost = isLocalhostHostname(parsed.hostname);

    // Check protocol
    if (protocol !== 'ws' && protocol !== 'wss') {
      return {
        valid: false,
        error: `Invalid WebSocket protocol: ${protocol}. Expected ws:// or wss://`,
      };
    }

    // Remote endpoints MUST use wss
    if (!isLocalhost && protocol === 'ws') {
      return {
        valid: false,
        error: 'Remote WebSocket endpoints MUST use wss:// (secure WebSocket). Insecure ws:// is prohibited.',
      };
    }

    // Localhost with ws requires DEV_ALLOW_INSECURE_LOCALHOST
    if (isLocalhost && protocol === 'ws') {
      const devAllowed = isInsecureLocalhostAllowedAtRuntime();
      if (!devAllowed) {
        return {
          valid: false,
          error: 'Insecure localhost WebSocket (ws://) requires allow_insecure_localhost or DEV_ALLOW_INSECURE_LOCALHOST=true. Use wss:// or enable dev mode.',
        };
      }
    }

    return {
      valid: true,
      protocol,
      isLocalhost,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate HTTP/HTTPS endpoint URL
 */
export function validateHttpEndpoint(url: string): EndpointValidationResult {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '') as 'http' | 'https';
    const isLocalhost = isLocalhostHostname(parsed.hostname);

    // Check protocol
    if (protocol !== 'http' && protocol !== 'https') {
      return {
        valid: false,
        error: `Invalid HTTP protocol: ${protocol}. Expected http:// or https://`,
      };
    }

    // Remote endpoints MUST use https
    if (!isLocalhost && protocol === 'http') {
      return {
        valid: false,
        error: 'Remote HTTP endpoints MUST use https:// (secure HTTP). Insecure http:// is prohibited.',
      };
    }

    // Localhost with http requires DEV_ALLOW_INSECURE_LOCALHOST
    if (isLocalhost && protocol === 'http') {
      const devAllowed = isInsecureLocalhostAllowedAtRuntime();
      if (!devAllowed) {
        return {
          valid: false,
          error: 'Insecure localhost HTTP (http://) requires allow_insecure_localhost or DEV_ALLOW_INSECURE_LOCALHOST=true. Use https:// or enable dev mode.',
        };
      }
    }

    return {
      valid: true,
      protocol,
      isLocalhost,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate gRPC endpoint (should be hostname:port format with implicit TLS)
 */
export function validateGrpcEndpoint(endpoint: string): EndpointValidationResult {
  try {
    // gRPC endpoints are typically "host:port" without protocol
    // We need to check if it's localhost or remote
    const parts = endpoint.split(':');
    if (parts.length !== 2) {
      return {
        valid: false,
        error: 'gRPC endpoint must be in format "host:port"',
      };
    }

    const [hostname, port] = parts;
    const isLocalhost = isLocalhostHostname(hostname);

    // Validate port
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return {
        valid: false,
        error: `Invalid port number: ${port}`,
      };
    }

    // For remote gRPC, we assume TLS is used
    // For localhost, insecure is allowed with dev flag
    if (!isLocalhost) {
      // Remote gRPC should use TLS (enforced in gRPC client configuration)
      return {
        valid: true,
        protocol: 'https', // Conceptual - gRPC over TLS
        isLocalhost: false,
      };
    }

    // Localhost gRPC
    const devAllowed = isInsecureLocalhostAllowedAtRuntime();
    if (!devAllowed) {
      return {
        valid: false,
        error: 'Localhost gRPC without TLS requires allow_insecure_localhost or DEV_ALLOW_INSECURE_LOCALHOST=true.',
      };
    }

    return {
      valid: true,
      protocol: 'http', // Conceptual - insecure localhost
      isLocalhost: true,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid gRPC endpoint format: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
