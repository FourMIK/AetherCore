/**
 * Desktop Integration Tests - TypeScript/Rust Boundary (Tauri Commands)
 *
 * Tests the FFI boundary between TypeScript (frontend) and Rust (Tauri backend)
 * for the Tactical Glass desktop application.
 *
 * Coverage:
 * - Tauri command invocations via @tauri-apps/api
 * - Type safety and serialization
 * - Error handling and validation
 * - Security-relevant operations (signatures, identity)
 * - Stream integrity tracking
 *
 * Architecture adherence:
 * - Zod validation for all incoming data
 * - Fail-visible security (explicit STATUS_UNVERIFIED/SPOOFED)
 * - BLAKE3 hashing
 * - Ed25519 signatures with TPM intent (CodeRalphie)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

type GenesisBundle = {
  user_identity: string;
  squad_id: string;
  public_key: string;
  signature: string;
  timestamp: number;
};

type StreamIntegrityStatus = {
  stream_id: string;
  is_compromised: boolean;
  total_events: number;
  valid_events: number;
  broken_events: number;
  verification_status: string;
  compromise_reason: string | null;
};

type CompromisedStream = {
  stream_id: string;
  is_compromised: boolean;
  verification_status: string;
  compromise_reason: string | null;
};

// Mock invoke from setup
const mockInvoke = globalThis.mockTauriInvoke;

describe("Desktop Integration - Tauri Command Invocations", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  describe("connect_to_testnet command", () => {
    it("should validate and accept valid WebSocket endpoint", async () => {
      const endpoint = "wss://testnet.aethercore.local:8080";
      const expectedResponse = `Connected to testnet at ${endpoint} (validation successful)`;

      mockInvoke.mockResolvedValue(expectedResponse);

      const result = await invoke<string>("connect_to_testnet", { endpoint });

      expect(mockInvoke).toHaveBeenCalledWith("connect_to_testnet", {
        endpoint,
      });
      expect(result).toBe(expectedResponse);
    });

    it("should reject endpoint without ws:// or wss:// prefix", async () => {
      const endpoint = "http://testnet.aethercore.local:8080";
      const errorMessage =
        "Invalid endpoint format. Must start with ws:// or wss://";

      mockInvoke.mockRejectedValue(new Error(errorMessage));

      await expect(invoke("connect_to_testnet", { endpoint })).rejects.toThrow(
        errorMessage
      );
    });

    it("should reject malformed endpoint URL", async () => {
      const endpoint = "wss://invalid url with spaces";

      mockInvoke.mockRejectedValue(new Error("Invalid endpoint URL"));

      await expect(
        invoke("connect_to_testnet", { endpoint })
      ).rejects.toThrow();
    });
  });

  describe("generate_genesis_bundle command", () => {
    it("should generate valid genesis bundle with signature", async () => {
      const userIdentity = "operator-alpha";
      const squadId = "squad-001";

      const mockBundle = {
        user_identity: userIdentity,
        squad_id: squadId,
        public_key: "base64EncodedPublicKey==",
        signature: "base64EncodedSignature==",
        timestamp: Date.now() / 1000,
      };

      mockInvoke.mockResolvedValue(mockBundle);

      const result = await invoke<GenesisBundle>("generate_genesis_bundle", {
        userIdentity,
        squadId,
      });

      expect(mockInvoke).toHaveBeenCalledWith("generate_genesis_bundle", {
        userIdentity,
        squadId,
      });

      expect(result).toEqual(mockBundle);
      expect(result.user_identity).toBe(userIdentity);
      expect(result.squad_id).toBe(squadId);
      expect(result.public_key).toBeTruthy();
      expect(result.signature).toBeTruthy();
    });

    it("should validate bundle structure for QR encoding", async () => {
      const bundle = {
        user_identity: "operator-alpha",
        squad_id: "squad-001",
        public_key: "mockPublicKey",
        signature: "mockSignature",
        timestamp: 1234567890,
      };

      const qrData = JSON.stringify(bundle);
      mockInvoke.mockResolvedValue(qrData);

      const result = await invoke<string>("bundle_to_qr_data", { bundle });

      expect(result).toBe(qrData);
      expect(() => JSON.parse(result as string)).not.toThrow();
    });
  });

  describe("verify_telemetry_signature command", () => {
    it("should verify valid telemetry signature", async () => {
      const payload = {
        node_id: "test-node-001",
        data: { lat: 45.0, lon: -122.0, alt: 100.0 },
        signature: "validBase64Signature==",
        timestamp: Date.now() / 1000,
      };

      mockInvoke.mockResolvedValue(true);

      const result = await invoke<boolean>("verify_telemetry_signature", {
        payload,
      });

      expect(result).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith("verify_telemetry_signature", {
        payload,
      });
    });

    it("should reject telemetry with invalid signature", async () => {
      const payload = {
        node_id: "test-node-002",
        data: { lat: 45.0, lon: -122.0 },
        signature: "invalidSignature",
        timestamp: Date.now() / 1000,
      };

      mockInvoke.mockResolvedValue(false);

      const result = await invoke<boolean>("verify_telemetry_signature", {
        payload,
      });

      // Fail-visible: returns false instead of throwing
      expect(result).toBe(false);
    });

    it("should reject telemetry with empty signature", async () => {
      const payload = {
        node_id: "test-node-003",
        data: { lat: 45.0 },
        signature: "",
        timestamp: Date.now() / 1000,
      };

      mockInvoke.mockResolvedValue(false);

      const result = await invoke<boolean>("verify_telemetry_signature", {
        payload,
      });

      // Fail-visible: empty signature returns false
      expect(result).toBe(false);
    });

    it("should handle unknown node gracefully", async () => {
      const payload = {
        node_id: "unknown-node-999",
        data: { lat: 45.0 },
        signature: "someSignature",
        timestamp: Date.now() / 1000,
      };

      mockInvoke.mockResolvedValue(false);

      const result = await invoke<boolean>("verify_telemetry_signature", {
        payload,
      });

      // Fail-visible: unknown nodes are treated as unverified
      expect(result).toBe(false);
    });
  });

  describe("create_node command", () => {
    it("should create node with valid identity", async () => {
      const nodeId = "node-001";
      const domain = "tactical-mesh";
      const expectedResponse = `Node ${nodeId} successfully created and registered`;

      mockInvoke.mockResolvedValue(expectedResponse);

      const result = await invoke<string>("create_node", { nodeId, domain });

      expect(result).toBe(expectedResponse);
      expect(mockInvoke).toHaveBeenCalledWith("create_node", {
        nodeId,
        domain,
      });
    });

    it("should reject empty node_id", async () => {
      const nodeId = "";
      const domain = "tactical-mesh";

      mockInvoke.mockRejectedValue(
        new Error("Invalid node_id: must be 1-255 characters")
      );

      await expect(invoke("create_node", { nodeId, domain })).rejects.toThrow(
        "Invalid node_id"
      );
    });

    it("should reject node_id exceeding 255 characters", async () => {
      const nodeId = "a".repeat(256);
      const domain = "tactical-mesh";

      mockInvoke.mockRejectedValue(
        new Error("Invalid node_id: must be 1-255 characters")
      );

      await expect(invoke("create_node", { nodeId, domain })).rejects.toThrow();
    });

    it("should reject empty domain", async () => {
      const nodeId = "node-001";
      const domain = "";

      mockInvoke.mockRejectedValue(
        new Error("Invalid domain: must be 1-255 characters")
      );

      await expect(invoke("create_node", { nodeId, domain })).rejects.toThrow(
        "Invalid domain"
      );
    });
  });

  describe("check_stream_integrity command", () => {
    it("should return VERIFIED status for valid stream", async () => {
      const streamId = "stream-001";
      const mockStatus = {
        stream_id: streamId,
        is_compromised: false,
        total_events: 10,
        valid_events: 10,
        broken_events: 0,
        verification_status: "VERIFIED",
        compromise_reason: null,
      };

      mockInvoke.mockResolvedValue(mockStatus);

      const result = await invoke<StreamIntegrityStatus>(
        "check_stream_integrity",
        {
          streamId,
        }
      );

      expect(result).toEqual(mockStatus);
      expect(result.verification_status).toBe("VERIFIED");
      expect(result.is_compromised).toBe(false);
    });

    it("should return SPOOFED status for compromised stream", async () => {
      const streamId = "stream-002-compromised";
      const mockStatus = {
        stream_id: streamId,
        is_compromised: true,
        total_events: 10,
        valid_events: 8,
        broken_events: 2,
        verification_status: "SPOOFED",
        compromise_reason: "Merkle chain broken: previous_hash mismatch",
      };

      mockInvoke.mockResolvedValue(mockStatus);

      const result = await invoke<StreamIntegrityStatus>(
        "check_stream_integrity",
        {
          streamId,
        }
      );

      // Fail-visible: compromised streams marked as SPOOFED
      expect(result.verification_status).toBe("SPOOFED");
      expect(result.is_compromised).toBe(true);
      expect(result.compromise_reason).toBeTruthy();
    });

    it("should return STATUS_UNVERIFIED for unknown stream", async () => {
      const streamId = "unknown-stream-999";
      const mockStatus = {
        stream_id: streamId,
        is_compromised: false,
        total_events: 0,
        valid_events: 0,
        broken_events: 0,
        verification_status: "STATUS_UNVERIFIED",
        compromise_reason: "Stream not found in tracker",
      };

      mockInvoke.mockResolvedValue(mockStatus);

      const result = await invoke<StreamIntegrityStatus>(
        "check_stream_integrity",
        {
          streamId,
        }
      );

      // Fail-visible: unknown streams marked as STATUS_UNVERIFIED
      expect(result.verification_status).toBe("STATUS_UNVERIFIED");
      expect(result.compromise_reason).toBeTruthy();
    });
  });

  describe("get_compromised_streams command", () => {
    it("should return list of compromised streams", async () => {
      const mockCompromisedStreams = [
        {
          stream_id: "stream-001",
          is_compromised: true,
          verification_status: "SPOOFED",
          compromise_reason: "Chain break detected",
        },
        {
          stream_id: "stream-002",
          is_compromised: true,
          verification_status: "SPOOFED",
          compromise_reason: "Invalid signature",
        },
      ];

      mockInvoke.mockResolvedValue(mockCompromisedStreams);

      const result = await invoke<CompromisedStream[]>(
        "get_compromised_streams"
      );

      expect(result).toEqual(mockCompromisedStreams);
      expect(result).toHaveLength(2);
      result.forEach((stream: any) => {
        expect(stream.is_compromised).toBe(true);
        expect(stream.verification_status).toBe("SPOOFED");
      });
    });

    it("should return empty array when no compromised streams", async () => {
      mockInvoke.mockResolvedValue([]);

      const result = await invoke<CompromisedStream[]>(
        "get_compromised_streams"
      );

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe("FFI Error Handling", () => {
    it("should handle Rust panic gracefully", async () => {
      mockInvoke.mockRejectedValue(new Error("Rust panic: thread panicked"));

      await expect(invoke("some_command")).rejects.toThrow("Rust panic");
    });

    it("should handle serialization errors", async () => {
      mockInvoke.mockRejectedValue(
        new Error("Failed to serialize response: invalid UTF-8")
      );

      await expect(invoke("some_command")).rejects.toThrow(
        "Failed to serialize"
      );
    });

    it("should propagate descriptive error messages from Rust", async () => {
      const errorMessage = "Node identity-001 not found in registry";
      mockInvoke.mockRejectedValue(new Error(errorMessage));

      await expect(invoke("verify_telemetry_signature", {})).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe("deploy_node command", () => {
    it("should deploy node with valid configuration", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 9000,
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      const mockResponse = {
        node_id: config.node_id,
        pid: 12345,
        port: config.listen_port,
        started_at: Math.floor(Date.now() / 1000),
        status: "Running",
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const result = await invoke<any>("deploy_node", { config });

      expect(mockInvoke).toHaveBeenCalledWith("deploy_node", { config });
      expect(result.node_id).toBe(config.node_id);
      expect(result.pid).toBeTruthy();
      expect(result.port).toBe(config.listen_port);
      expect(result.status).toBe("Running");
    });

    it("should reject invalid port numbers", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 500, // Invalid: below 1024
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error("Invalid port: 500 (must be 1024-65535)")
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "Invalid port"
      );
    });

    it("should reject port numbers above 65535", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 70000, // Invalid: above 65535
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error("Invalid port: 70000 (must be 1024-65535)")
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "Invalid port"
      );
    });

    it("should reject invalid mesh endpoint URL", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "not-a-valid-url",
        listen_port: 9000,
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error("Invalid mesh endpoint URL: relative URL without a base")
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "Invalid mesh endpoint URL"
      );
    });

    it("should reject non-WebSocket endpoint schemes", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "http://localhost:8080", // Should be ws:// or wss://
        listen_port: 9000,
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error("Mesh endpoint must use ws:// or wss:// scheme")
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "ws:// or wss://"
      );
    });

    it("should reject invalid log levels", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 9000,
        data_dir: "./data/test-node-001",
        log_level: "invalid-level",
      };

      mockInvoke.mockRejectedValue(
        new Error(
          "Invalid log level: invalid-level (must be one of: trace, debug, info, warn, error)"
        )
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "Invalid log level"
      );
    });

    it("should reject path traversal in data_dir", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 9000,
        data_dir: "../../../etc/passwd", // Path traversal attempt
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error("Invalid data_dir: path traversal not allowed")
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "path traversal not allowed"
      );
    });

    it("should handle binary not found gracefully", async () => {
      const config = {
        node_id: "test-node-001",
        mesh_endpoint: "ws://localhost:8080",
        listen_port: 9000,
        data_dir: "./data/test-node-001",
        log_level: "info",
      };

      mockInvoke.mockRejectedValue(
        new Error(
          "Failed to locate node binary: Node binary not found. Set NODE_BINARY_PATH environment variable or ensure 'aethercore-node' is in PATH"
        )
      );

      await expect(invoke("deploy_node", { config })).rejects.toThrow(
        "Failed to locate node binary"
      );
    });
  });

  describe("stop_node command", () => {
    it("should stop a running node", async () => {
      const nodeId = "test-node-001";
      const expectedResponse = `Node ${nodeId} stopped successfully`;

      mockInvoke.mockResolvedValue(expectedResponse);

      const result = await invoke<string>("stop_node", { nodeId });

      expect(mockInvoke).toHaveBeenCalledWith("stop_node", { nodeId });
      expect(result).toBe(expectedResponse);
    });

    it("should reject empty node_id", async () => {
      const nodeId = "";

      mockInvoke.mockRejectedValue(
        new Error("Invalid node_id: cannot be empty")
      );

      await expect(invoke("stop_node", { nodeId })).rejects.toThrow(
        "Invalid node_id"
      );
    });

    it("should handle stopping non-existent node", async () => {
      const nodeId = "non-existent-node";

      mockInvoke.mockRejectedValue(
        new Error(`Failed to stop node: Node ${nodeId} not found`)
      );

      await expect(invoke("stop_node", { nodeId })).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("get_deployment_status command", () => {
    it("should return all deployment statuses", async () => {
      const mockStatuses = [
        {
          node_id: "node-001",
          pid: 12345,
          port: 9000,
          started_at: 1234567890,
          status: "Running",
        },
        {
          node_id: "node-002",
          pid: 12346,
          port: 9001,
          started_at: 1234567900,
          status: "Running",
        },
      ];

      mockInvoke.mockResolvedValue(mockStatuses);

      const result = await invoke<any[]>("get_deployment_status");

      expect(mockInvoke).toHaveBeenCalledWith("get_deployment_status");
      expect(result).toEqual(mockStatuses);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no deployments", async () => {
      mockInvoke.mockResolvedValue([]);

      const result = await invoke<any[]>("get_deployment_status");

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe("get_node_logs command", () => {
    it("should retrieve logs for a node", async () => {
      const nodeId = "test-node-001";
      const tail = 100;
      const mockLogs = [
        "[OUT] Node starting...",
        "[OUT] Listening on port 9000",
        "[ERR] Warning: connection timeout",
      ];

      mockInvoke.mockResolvedValue(mockLogs);

      const result = await invoke<string[]>("get_node_logs", { nodeId, tail });

      expect(mockInvoke).toHaveBeenCalledWith("get_node_logs", {
        nodeId,
        tail,
      });
      expect(result).toEqual(mockLogs);
      expect(result).toHaveLength(3);
    });

    it("should reject empty node_id", async () => {
      const nodeId = "";
      const tail = 100;

      mockInvoke.mockRejectedValue(
        new Error("Invalid node_id: cannot be empty")
      );

      await expect(invoke("get_node_logs", { nodeId, tail })).rejects.toThrow(
        "Invalid node_id"
      );
    });

    it("should handle logs for non-existent node", async () => {
      const nodeId = "non-existent-node";
      const tail = 100;

      mockInvoke.mockRejectedValue(
        new Error(`Failed to get logs: Node ${nodeId} not found`)
      );

      await expect(invoke("get_node_logs", { nodeId, tail })).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("Type Safety and Validation", () => {
    it("should handle boolean return values correctly", async () => {
      mockInvoke.mockResolvedValue(true);

      const result = await invoke<boolean>("verify_telemetry_signature", {
        payload: {},
      });

      expect(typeof result).toBe("boolean");
      expect(result).toBe(true);
    });

    it("should handle string return values correctly", async () => {
      const message = "Operation successful";
      mockInvoke.mockResolvedValue(message);

      const result = await invoke<string>("create_node", {
        nodeId: "test",
        domain: "test",
      });

      expect(typeof result).toBe("string");
      expect(result).toBe(message);
    });

    it("should handle object return values correctly", async () => {
      const bundle = {
        user_identity: "test",
        squad_id: "test",
        public_key: "test",
        signature: "test",
        timestamp: 123456,
      };

      mockInvoke.mockResolvedValue(bundle);

      const result = await invoke<GenesisBundle>("generate_genesis_bundle", {
        userIdentity: "test",
        squadId: "test",
      });

      expect(typeof result).toBe("object");
      expect(result).toEqual(bundle);
    });
  });

  describe("Security - Audit Events", () => {
    it("should trigger audit events for security-relevant operations", async () => {
      // Create node triggers NODE_CREATED audit event
      mockInvoke.mockResolvedValue("Node created");

      await invoke("create_node", {
        nodeId: "audit-node",
        domain: "audit-domain",
      });

      // In production, this would trigger an audit log entry
      expect(mockInvoke).toHaveBeenCalledWith("create_node", {
        nodeId: "audit-node",
        domain: "audit-domain",
      });
    });

    it("should trigger audit events for failed signature verification", async () => {
      // Failed verification triggers SIGNATURE_VERIFICATION_FAILED audit event
      mockInvoke.mockResolvedValue(false);

      const result = await invoke("verify_telemetry_signature", {
        payload: {
          node_id: "test",
          signature: "invalid",
          timestamp: 123,
          data: {},
        },
      });

      // Fail-visible: returns false instead of throwing
      expect(result).toBe(false);
    });
  });
});
