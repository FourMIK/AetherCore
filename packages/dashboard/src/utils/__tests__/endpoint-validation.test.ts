/**
 * Endpoint Validation Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateWebSocketEndpoint,
  validateHttpEndpoint,
  validateGrpcEndpoint,
} from '../endpoint-validation';
import * as runtimeConfig from '../../config/runtime';
import type { UnifiedRuntimeConfig } from '../../config/runtime';

const buildRuntimeConfig = (allowInsecureLocalhost: boolean): UnifiedRuntimeConfig => ({
  schema_version: 3,
  product_profile: 'commander_edition',
  profile: 'commander-local',
  connection: {
    api_endpoint: 'http://localhost:3000',
    mesh_endpoint: 'ws://localhost:3000',
  },
  tpm_policy: {
    mode: 'optional',
    enforce_hardware: false,
  },
  ports: {
    api: 3000,
    mesh: 3000,
  },
  features: {
    allow_insecure_localhost: allowInsecureLocalhost,
    bootstrap_on_startup: true,
  },
  connection_retry: {
    max_retries: 10,
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
  },
});

describe('Endpoint Validation', () => {
  beforeEach(() => {
    // Clear environment variables
    vi.unstubAllEnvs();
    // Reset runtime config cache by setting it to a clean state
    runtimeConfig.setRuntimeConfig(buildRuntimeConfig(false));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('validateWebSocketEndpoint', () => {
    it('should accept wss:// for remote endpoints', () => {
      const result = validateWebSocketEndpoint('wss://example.com:8443');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('wss');
      expect(result.isLocalhost).toBe(false);
    });

    it('should reject ws:// for remote endpoints', () => {
      const result = validateWebSocketEndpoint('ws://example.com:8080');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('MUST use wss://');
    });

    it('should accept wss:// for localhost', () => {
      const result = validateWebSocketEndpoint('wss://localhost:8443');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('wss');
      expect(result.isLocalhost).toBe(true);
    });

    it('should reject ws://localhost without allow_insecure_localhost', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(false));
      const result = validateWebSocketEndpoint('ws://localhost:8080');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept ws://localhost when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateWebSocketEndpoint('ws://localhost:8080');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('ws');
      expect(result.isLocalhost).toBe(true);
    });

    it('should accept ws://127.0.0.1 when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateWebSocketEndpoint('ws://127.0.0.1:8080');
      expect(result.valid).toBe(true);
      expect(result.isLocalhost).toBe(true);
    });

    it('should reject http:// protocol', () => {
      const result = validateWebSocketEndpoint('http://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid WebSocket protocol');
    });

    it('should reject invalid URL format', () => {
      const result = validateWebSocketEndpoint('not a url');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL format');
    });

    it('should handle IPv6 localhost [::1] when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateWebSocketEndpoint('ws://[::1]:8080');
      expect(result.valid).toBe(true);
      expect(result.isLocalhost).toBe(true);
    });
  });

  describe('validateHttpEndpoint', () => {
    it('should accept https:// for remote endpoints', () => {
      const result = validateHttpEndpoint('https://api.example.com:443');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('https');
      expect(result.isLocalhost).toBe(false);
    });

    it('should reject http:// for remote endpoints', () => {
      const result = validateHttpEndpoint('http://api.example.com:80');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('MUST use https://');
    });

    it('should accept https:// for localhost', () => {
      const result = validateHttpEndpoint('https://localhost:3000');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('https');
      expect(result.isLocalhost).toBe(true);
    });

    it('should reject http://localhost without allow_insecure_localhost', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(false));
      const result = validateHttpEndpoint('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept http://localhost when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateHttpEndpoint('http://localhost:3000');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('http');
      expect(result.isLocalhost).toBe(true);
    });

    it('should reject ws:// protocol', () => {
      const result = validateHttpEndpoint('ws://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid HTTP protocol');
    });
  });

  describe('validateGrpcEndpoint', () => {
    it('should accept remote gRPC endpoint', () => {
      const result = validateGrpcEndpoint('api.example.com:50051');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('https'); // Conceptual - TLS assumed
      expect(result.isLocalhost).toBe(false);
    });

    it('should reject localhost gRPC without allow_insecure_localhost', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(false));
      const result = validateGrpcEndpoint('localhost:50051');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept localhost gRPC when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateGrpcEndpoint('localhost:50051');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('http'); // Conceptual - insecure
      expect(result.isLocalhost).toBe(true);
    });

    it('should reject invalid port', () => {
      const result = validateGrpcEndpoint('localhost:abc');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid port number');
    });

    it('should reject port out of range', () => {
      const result = validateGrpcEndpoint('localhost:99999');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid port number');
    });

    it('should reject invalid format', () => {
      const result = validateGrpcEndpoint('invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be in format "host:port"');
    });

    it('should accept 127.0.0.1 when allow_insecure_localhost is enabled', () => {
      runtimeConfig.setRuntimeConfig(buildRuntimeConfig(true));
      const result = validateGrpcEndpoint('127.0.0.1:50051');
      expect(result.valid).toBe(true);
      expect(result.isLocalhost).toBe(true);
    });
  });
});
