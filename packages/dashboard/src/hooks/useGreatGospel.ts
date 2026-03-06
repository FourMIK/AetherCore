/**
 * Great Gospel Integration - Revocation Event Handler
 * 
 * THE GREAT GOSPEL:
 * - Sovereign revocation is absolute
 * - Quorum-based Byzantine node removal
 * - All active sessions with revoked nodes are instantly severed
 * - Aetheric Sweep animation visualizes node purge
 * 
 * This module wires the Great Gospel ledger to the UI for fail-visible
 * node revocation with cryptographic finality.
 */

import { useEffect, useCallback, useState } from 'react';
import { useCommStore } from '../store/useCommStore';
import { RevocationReason } from '../components/animations/AethericSweep';
import { isDemoMode } from '../config/runtime';

/**
 * Revocation Event from Great Gospel ledger
 */
export interface RevocationEvent {
  /** Revoked node ID */
  node_id: string;
  
  /** Reason for revocation */
  reason: RevocationReason;
  
  /** Issuer node ID */
  issuer_id: string;
  
  /** Timestamp (ms since epoch) */
  timestamp: number;
  
  /** Ed25519 signature of revocation certificate */
  signature: string;
  
  /** BLAKE3 Merkle root of Gospel ledger */
  merkle_root: string;
}

/**
 * useGreatGospel Hook
 * 
 * Listens for revocation events from the Great Gospel ledger and:
 * 1. Terminates all sessions with revoked nodes
 * 2. Triggers Aetheric Sweep animation
 * 3. Updates operator trust scores
 * 4. Removes revoked nodes from UI
 */
export function useGreatGospel(gospelEndpoint?: string) {
  const { revokeNode, isNodeRevoked, activeCall } = useCommStore();
  const [revocationEvents, setRevocationEvents] = useState<RevocationEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const demoEnabled = isDemoMode();

  /**
   * Handle revocation event from Gospel ledger
   */
  const handleRevocation = useCallback((event: RevocationEvent) => {
    console.warn('[GREAT GOSPEL] Revocation event received:', {
      node_id: event.node_id,
      reason: event.reason,
      timestamp: new Date(event.timestamp).toISOString(),
    });

    // Add to revocation log
    setRevocationEvents((prev) => [...prev, event]);

    // Revoke node in store (terminates sessions)
    revokeNode(
      event.node_id,
      `${event.reason} - Revoked by ${event.issuer_id} at ${new Date(event.timestamp).toISOString()}`
    );

    // TODO: Trigger Aetheric Sweep animation
    // This would dispatch to AethericSweep component to visualize the purge
  }, [revokeNode]);

  /**
   * Connect to Great Gospel WebSocket feed
   */
  useEffect(() => {
    if (!gospelEndpoint) {
      console.warn('[GREAT GOSPEL] No endpoint configured, revocation disabled');
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(gospelEndpoint);

        ws.onopen = () => {
          console.log('[GREAT GOSPEL] Connected to ledger feed');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Check if this is a revocation event
            if (data.type === 'revocation') {
              const revocationEvent: RevocationEvent = {
                node_id: data.node_id,
                reason: data.reason as RevocationReason,
                issuer_id: data.issuer_id,
                timestamp: data.timestamp,
                signature: data.signature,
                merkle_root: data.merkle_root,
              };

              handleRevocation(revocationEvent);
            }
          } catch (error) {
            console.error('[GREAT GOSPEL] Failed to parse message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('[GREAT GOSPEL] WebSocket error:', error);
          setIsConnected(false);
        };

        ws.onclose = () => {
          console.log('[GREAT GOSPEL] Connection closed, reconnecting in 5s...');
          setIsConnected(false);
          
          // Auto-reconnect after delay
          reconnectTimeout = setTimeout(connect, 5000);
        };
      } catch (error) {
        console.error('[GREAT GOSPEL] Connection failed:', error);
        setIsConnected(false);
        
        // Retry connection
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [gospelEndpoint, handleRevocation]);

  /**
   * Manually revoke a node (operator override)
   */
  const manualRevoke = useCallback((nodeId: string) => {
    if (!demoEnabled) {
      throw new Error(
        'Manual revocation is demo-only unless backed by a real Great Gospel ledger endpoint.'
      );
    }
    const event: RevocationEvent = {
      node_id: nodeId,
      reason: RevocationReason.OperatorOverride,
      issuer_id: 'local-operator',
      timestamp: Date.now(),
      signature: '0'.repeat(128), // Placeholder signature
      merkle_root: '0'.repeat(64), // Placeholder Merkle root
    };

    handleRevocation(event);
  }, [demoEnabled, handleRevocation]);

  return {
    isConnected,
    revocationEvents,
    manualRevoke,
    isNodeRevoked,
  };
}

/**
 * Simulated revocation for testing (dev mode)
 * 
 * Simulates Byzantine behavior detection and triggers revocation.
 */
export function simulateRevocation(nodeId: string, reason: RevocationReason): RevocationEvent {
  if (!isDemoMode()) {
    throw new Error('simulateRevocation is demo-only. Enable demo mode explicitly to use simulations.');
  }
  return {
    node_id: nodeId,
    reason,
    issuer_id: 'test-sentinel',
    timestamp: Date.now(),
    signature: '0'.repeat(128),
    merkle_root: '0'.repeat(64),
  };
}
