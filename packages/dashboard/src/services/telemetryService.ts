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
export function updateTelemetry(data: TelemetryData): void {
  telemetryCache.set(data.node_id, data);
}

/**
 * Get cached telemetry for a specific node
 */
export function getTelemetry(nodeId: string): TelemetryData | undefined {
  return telemetryCache.get(nodeId);
}

/**
 * Get all cached telemetry
 */
export function getAllTelemetry(): Map<string, TelemetryData> {
  return new Map(telemetryCache);
}

/**
 * Subscribe to telemetry updates via WebSocket (for live Teledyne feeds)
 */
export function subscribeToTelemetry(callback: (telemetry: TelemetryData) => void): () => void {
  const { apiUrl } = getRuntimeConfig();
  const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');

  const ws = new WebSocket(`${wsUrl}/api/telemetry/subscribe`);

  ws.onmessage = (event) => {
    try {
      const telemetry: TelemetryData = JSON.parse(event.data);
      updateTelemetry(telemetry);
      callback(telemetry);
    } catch (error) {
      console.error('[TELEMETRY] Failed to parse WebSocket message:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('[TELEMETRY] WebSocket error:', error);
  };

  // Return unsubscribe function
  return () => {
    ws.close();
  };
}

