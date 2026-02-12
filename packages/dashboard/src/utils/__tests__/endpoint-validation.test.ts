/**
 * Endpoint Validation Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateWebSocketEndpoint,
  validateHttpEndpoint,
  validateGrpcEndpoint,
} from '../endpoint-validation';

describe('Endpoint Validation', () => {
  beforeEach(() => {
    // Reset environment
    vi.stubGlobal('import', {
      meta: {
        env: {},
      },
    });
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

    it('should reject ws://localhost without DEV_ALLOW_INSECURE_LOCALHOST', () => {
      const result = validateWebSocketEndpoint('ws://localhost:8080');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept ws://localhost with DEV_ALLOW_INSECURE_LOCALHOST=true', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: 'true',
          },
        },
      });

      const result = validateWebSocketEndpoint('ws://localhost:8080');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('ws');
      expect(result.isLocalhost).toBe(true);
    });

    it('should accept ws://127.0.0.1 with DEV_ALLOW_INSECURE_LOCALHOST=true', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: '1',
          },
        },
      });

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

    it('should handle IPv6 localhost [::1]', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: 'yes',
          },
        },
      });

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

    it('should reject http://localhost without DEV_ALLOW_INSECURE_LOCALHOST', () => {
      const result = validateHttpEndpoint('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept http://localhost with DEV_ALLOW_INSECURE_LOCALHOST=true', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: 'true',
          },
        },
      });

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

    it('should reject localhost gRPC without DEV_ALLOW_INSECURE_LOCALHOST', () => {
      const result = validateGrpcEndpoint('localhost:50051');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DEV_ALLOW_INSECURE_LOCALHOST');
    });

    it('should accept localhost gRPC with DEV_ALLOW_INSECURE_LOCALHOST=true', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: 'true',
          },
        },
      });

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

    it('should accept 127.0.0.1 with DEV_ALLOW_INSECURE_LOCALHOST=true', () => {
      vi.stubGlobal('import', {
        meta: {
          env: {
            VITE_DEV_ALLOW_INSECURE_LOCALHOST: '1',
          },
        },
      });

      const result = validateGrpcEndpoint('127.0.0.1:50051');
      expect(result.valid).toBe(true);
      expect(result.isLocalhost).toBe(true);
    });
  });
});
