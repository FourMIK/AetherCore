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
          nodes.set(telemetry.node_id, telemetryToNode(telemetry));
        });

        if (data.nodes.length > 0) {
          console.log(`[TELEMETRY] Fetched ${data.nodes.length} nodes from backend`);
        } else {
          console.log('[TELEMETRY] Gateway responded but no nodes available yet');
        }
      }
    } else if (response.status === 404) {
      console.warn('[TELEMETRY] Gateway /api/nodes endpoint not found - gateway may need restart');
    } else {
      console.warn(`[TELEMETRY] Failed to fetch nodes: ${response.status}`);
    }

    return nodes;
  } catch (error) {
    console.error('[TELEMETRY] Failed to fetch telemetry:', error);

    return nodes;
  }
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
  const { telemetryWebsocketUrl } = getRuntimeConfig();

  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;

  const connect = () => {
    try {
      ws = new WebSocket(telemetryWebsocketUrl);

      ws.onopen = () => {
        console.log('Telemetry WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle telemetry message
          if (data.type === 'telemetry' && data.payload) {
            void fetchTelemetry().then((nodes) => {
              const payloadNode = telemetryToNode(data.payload as TelemetryData);
              nodes.set(payloadNode.id, payloadNode);
              onUpdate(nodes);
            });
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
 * Subscribe to telemetry updates
 * This sets up a polling mechanism to fetch telemetry from the gateway
 * and trigger callbacks for each telemetry update
 */
export async function subscribeToTelemetry(onUpdate: (telemetry: TelemetryData) => void): Promise<() => void> {
  const pollIntervalMs = 2000; // Poll every 2 seconds

  let isSubscribed = true;

  const poll = async () => {
    while (isSubscribed) {
      try {
        const config = getRuntimeConfig();
        const response = await fetch(`${config.apiUrl}/api/nodes`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.nodes && Array.isArray(data.nodes)) {
            // Process each node's telemetry
            for (const node of data.nodes) {
              // Call the callback for each telemetry update
              onUpdate(node);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching telemetry:', error);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  };

  // Start polling in the background
  poll().catch(error => console.error('Telemetry polling failed:', error));

  // Return unsubscribe function
  return () => {
    isSubscribed = false;
  };
}



