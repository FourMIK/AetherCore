/**
 * Telemetry Service
 * Polls the backend gateway for node telemetry and updates the tactical store
 */

import { getRuntimeConfig } from '../config/runtime';
import type { TacticalNode } from '../store/useTacticalStore';

export interface TelemetryData {
  node_id: string;
  timestamp: number;
  node_type: string;
  platform: string;
  hardware: {
    manufacturer: string;
    model: string;
    android_version?: string;
    api_level?: number;
    security_patch?: string;
  };
  security: {
    keystore_type: string;
    hardware_backed: boolean;
    attestation_available: boolean;
    biometric_available: boolean;
  };
  trust: {
    self_score: number;
    peers_visible: number;
    byzantine_detected: number;
    merkle_vine_synced: boolean;
  };
  network: {
    wifi_connected: boolean;
    backend_reachable: boolean;
    mesh_discovery_active: boolean;
  };
  atak?: {
    installed: boolean;
    cot_listener_active: boolean;
    cot_messages_processed: number;
  };
  native?: {
    jni_loaded: boolean;
    architecture: string;
  };
  isr?: {
    camera_active: boolean;
    frame_count: number;
    last_frame_ts?: number;
    resolution?: string;
  };
}

// In-memory cache of telemetry data
const telemetryCache = new Map<string, TelemetryData>();
let lastFetchTime = 0;
const CACHE_DURATION_MS = 3000; // 3 seconds

/**
 * Convert telemetry data to a TacticalNode
 */
export function telemetryToNode(telemetry: TelemetryData): TacticalNode {
  return {
    id: telemetry.node_id,
    domain: telemetry.node_type || 'edge',
    position: {
      latitude: 0, // TODO: Get from telemetry if available
      longitude: 0,
      altitude: 0,
    },
    trustScore: telemetry.trust?.self_score || 0,
    verified: telemetry.security?.hardware_backed || false,
    attestationHash: telemetry.node_id.substring(0, 16),
    lastSeen: new Date(telemetry.timestamp),
    status: telemetry.network?.backend_reachable ? 'online' : 'offline',
    firmwareVersion: telemetry.hardware?.android_version || telemetry.platform || 'unknown',
    integrityCompromised: !telemetry.trust?.merkle_vine_synced,
  };
}

/**
 * Fetch telemetry from multiple sources (Gateway + Teledyne)
 */
export async function fetchTelemetry(): Promise<Map<string, TacticalNode>> {
  const now = Date.now();

  // Return cached data if still fresh
  if (now - lastFetchTime < CACHE_DURATION_MS && telemetryCache.size > 0) {
    const nodes = new Map<string, TacticalNode>();
    telemetryCache.forEach((telemetry, nodeId) => {
      nodes.set(nodeId, telemetryToNode(telemetry));
    });
    return nodes;
  }

  const nodes = new Map<string, TacticalNode>();
  const { apiUrl } = getRuntimeConfig();

  try {
    // Fetch from gateway nodes endpoint
    const response = await fetch(`${apiUrl}/api/nodes`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();

      if (data.nodes && Array.isArray(data.nodes)) {
        data.nodes.forEach((telemetry: TelemetryData) => {
          telemetryCache.set(telemetry.node_id, telemetry);
          nodes.set(telemetry.node_id, telemetryToNode(telemetry));
        });

        if (data.nodes.length > 0) {
          console.log(`[TELEMETRY] Fetched ${data.nodes.length} nodes from backend`);
        } else {
          console.log('[TELEMETRY] Gateway responded but no nodes available yet');
          console.log('[TELEMETRY] Waiting for devices to send telemetry to http://localhost:3000/api/telemetry');
        }
      }
    } else if (response.status === 404) {
      console.warn('[TELEMETRY] Gateway /api/nodes endpoint not found - gateway may need restart');
    } else {
      console.warn(`[TELEMETRY] Failed to fetch nodes: ${response.status}`);
    }

    lastFetchTime = now;
    return nodes;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('[TELEMETRY] Cannot connect to gateway at', apiUrl);
      console.error('[TELEMETRY] Ensure gateway is running on port 3000');
    } else {
      console.error('[TELEMETRY] Failed to fetch telemetry:', error);
    }

    // Fall back to cached data if fetch fails
    telemetryCache.forEach((telemetry, nodeId) => {
      // Only include if telemetry is recent (within last 30 seconds)
      if (now - telemetry.timestamp < 30000) {
        nodes.set(nodeId, telemetryToNode(telemetry));
      }
    });

    return nodes;
  }
}

/**
 * Update telemetry cache with new data
 * This should be called when telemetry is received via WebSocket or polling
 */
export function updateTelemetryCache(telemetry: TelemetryData) {
  telemetryCache.set(telemetry.node_id, telemetry);
}

/**
 * Start polling for telemetry data
 */
export function startTelemetryPolling(
  onUpdate: (nodes: Map<string, TacticalNode>) => void,
  intervalMs: number = 5000
): () => void {
  console.log('Starting telemetry polling...');

  // Initial fetch
  fetchTelemetry().then(onUpdate);

  // Set up polling
  const intervalId = setInterval(async () => {
    try {
      const nodes = await fetchTelemetry();
      onUpdate(nodes);
    } catch (error) {
      console.error('Telemetry polling error:', error);
    }
  }, intervalMs);

  // Return cleanup function
  return () => {
    console.log('Stopping telemetry polling');
    clearInterval(intervalId);
  };
}

/**
 * Connect to WebSocket for real-time telemetry updates
 */
export function connectTelemetryWebSocket(
  onUpdate: (nodes: Map<string, TacticalNode>) => void
): () => void {
  const { apiUrl } = getRuntimeConfig();
  const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
  const collaborationUrl = wsUrl.replace(':3000', ':8080'); // Collaboration service on 8080

  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;

  const connect = () => {
    try {
      ws = new WebSocket(collaborationUrl);

      ws.onopen = () => {
        console.log('Telemetry WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle telemetry message
          if (data.type === 'telemetry' && data.payload) {
            updateTelemetryCache(data.payload);
            fetchTelemetry().then(onUpdate);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Telemetry WebSocket disconnected, reconnecting in 5s...');
        reconnectTimeout = setTimeout(connect, 5000);
      };

      ws.onerror = (error) => {
        console.error('Telemetry WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to connect telemetry WebSocket:', error);
      reconnectTimeout = setTimeout(connect, 5000);
    }
  };

  connect();

  // Return cleanup function
  return () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    if (ws) {
      ws.close();
    }
  };
}

/**
 * Simulate receiving telemetry (for testing)
 */
export function simulateATAKDevice() {
  const mockTelemetry: TelemetryData = {
    node_id: 'google-pixel_9_pro_xl-' + Math.random().toString(36).substring(7),
    timestamp: Date.now(),
    node_type: 'tactical_edge',
    platform: 'android',
    hardware: {
      manufacturer: 'Google',
      model: 'Pixel 9 Pro XL',
      android_version: '16',
      api_level: 36,
      security_patch: '2026-03-01',
    },
    security: {
      keystore_type: 'android_strongbox',
      hardware_backed: true,
      attestation_available: true,
      biometric_available: true,
    },
    trust: {
      self_score: 100,
      peers_visible: 0,
      byzantine_detected: 0,
      merkle_vine_synced: true,
    },
    network: {
      wifi_connected: true,
      backend_reachable: true,
      mesh_discovery_active: false,
    },
    atak: {
      installed: true,
      cot_listener_active: false,
      cot_messages_processed: 0,
    },
    native: {
      jni_loaded: true,
      architecture: 'arm64-v8a',
    },
  };

  // Add RalphieNode on local network
  const ralphieNodeTelemetry: TelemetryData = {
    node_id: 'ralphie-local-desktop',
    timestamp: Date.now(),
    node_type: 'ralphie',
    platform: 'desktop',
    hardware: {
      manufacturer: 'Local Network',
      model: 'Desktop CodeRalphie Node',
    },
    security: {
      keystore_type: 'software_simulated',
      hardware_backed: false, // Dev mode simulation
      attestation_available: false,
      biometric_available: false,
    },
    trust: {
      self_score: 95,
      peers_visible: 1,
      byzantine_detected: 0,
      merkle_vine_synced: true,
    },
    network: {
      wifi_connected: true,
      backend_reachable: true,
      mesh_discovery_active: true,
    },
  };

  updateTelemetryCache(mockTelemetry);
  updateTelemetryCache(ralphieNodeTelemetry);
  console.log('Simulated ATAK device telemetry:', mockTelemetry.node_id);
  console.log('Simulated RalphieNode telemetry:', ralphieNodeTelemetry.node_id);
}



