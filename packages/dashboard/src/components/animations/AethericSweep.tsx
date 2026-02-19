/**
 * AethericSweep.tsx
 * 
 * Tactical Glass visualization for the Aetheric Sweep protocol.
 * Renders node purge animations with fail-visible design principles.
 * 
 * ## Design Philosophy
 * - Hardware-Rooted Trust: Only display nodes with valid TPM attestation
 * - Fail-Visible: All integrity violations projected with sub-second latency
 * - Byzantine Detection: Visual feedback for Identity Collapse signatures
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

// Animation constants
const PULSE_ANIMATION_PERIOD_MS = 200;
const PURGE_ANIMATION_DURATION_MS = 5000;
const SWEEP_CIRCLE_COUNT = 3;
const SWEEP_CIRCLE_DELAY = 0.3;

/**
 * Revocation reason enumeration (matches Rust backend)
 */
export enum RevocationReason {
  AttestationFailure = 'AttestationFailure',
  ByzantineDetection = 'ByzantineDetection',
  OperatorOverride = 'OperatorOverride',
  IdentityCollapse = 'IdentityCollapse',
}

/**
 * Node health status (matches crates/trust_mesh/src/node_health.rs)
 */
export enum NodeHealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  COMPROMISED = 'COMPROMISED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Node visualization state
 */
interface Node {
  id: string;
  x: number;
  y: number;
  status: NodeHealthStatus;
  trustScore: number;
  lastSeenNs: number;
  rootAgreementRatio?: number;
  chainBreakCount?: number;
  signatureFailureCount?: number;
  payloadFreshnessMs?: number;
  payloadSignatureValid?: boolean;
  isStalePayload?: boolean;
  beingPurged?: boolean;
  purgeReason?: RevocationReason;
}

/**
 * Revocation certificate from Gospel ledger
 */
interface RevocationCertificate {
  node_id: string;
  revocation_reason: RevocationReason;
  issuer_id: string;
  timestamp_ns: number;
  signature: string; // Hex-encoded Ed25519 signature
  merkle_root: string; // Hex-encoded BLAKE3 root
}

/**
 * WebSocket message from unit-status service
 */
interface MeshHealthMessage {
  node_id: string;
  status: NodeHealthStatus;
  trust_score: number;
  last_seen_ns: number;
  metrics: {
    root_agreement_ratio: number;
    chain_break_count: number;
    signature_failure_count: number;
  };
  payload_freshness_ms?: number;
  payload_signature_valid?: boolean;
  stale_payload?: boolean;
}

type SeverityLevel = 'high' | 'medium' | 'low';

const STALE_PAYLOAD_THRESHOLD_MS = 30_000;

const getSeverityLevel = (trustPercent: number): SeverityLevel => {
  if (trustPercent >= 80) return 'high';
  if (trustPercent >= 50) return 'medium';
  return 'low';
};

const getTrustLevelLabel = (severity: SeverityLevel): string => {
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  return 'Low';
};

const getNodeFreshnessAgeMs = (node: Node): number => {
  const lastSeenMs = Math.floor(node.lastSeenNs / 1_000_000);
  return Math.max(Date.now() - lastSeenMs, 0);
};

const isNodePayloadStale = (node: Node): boolean => {
  if (node.isStalePayload) return true;
  if (typeof node.payloadFreshnessMs === 'number') {
    return node.payloadFreshnessMs > STALE_PAYLOAD_THRESHOLD_MS;
  }
  return getNodeFreshnessAgeMs(node) > STALE_PAYLOAD_THRESHOLD_MS;
};

const hasInvalidPayloadSignature = (node: Node): boolean => {
  if (node.payloadSignatureValid === false) return true;
  return (node.signatureFailureCount ?? 0) > 0;
};

const getMeshIntegrityLabel = (node: Node): string => {
  if (hasInvalidPayloadSignature(node)) return 'Invalid signature';
  if (isNodePayloadStale(node)) return 'Stale payload';
  if (node.status === NodeHealthStatus.COMPROMISED) return 'Compromised';
  if (node.status === NodeHealthStatus.DEGRADED) return 'Degraded';
  if (node.status === NodeHealthStatus.UNKNOWN) return 'Unknown';
  return 'Healthy';
};

const getNodeVisualStatus = (node: Node): NodeHealthStatus => {
  if (hasInvalidPayloadSignature(node)) return NodeHealthStatus.COMPROMISED;
  if (isNodePayloadStale(node) && node.status === NodeHealthStatus.HEALTHY) {
    return NodeHealthStatus.DEGRADED;
  }
  return node.status;
};

/**
 * Props for AethericSweep component
 */
interface AethericSweepProps {
  /** WebSocket endpoint for mesh health feed */
  websocketUrl: string;
  /** Update frequency in Hz (1 Hz normal, 10 Hz during sweep) */
  updateFrequencyHz?: number;
  /** Canvas width in pixels */
  width?: number;
  /** Canvas height in pixels */
  height?: number;
}

/**
 * AethericSweep: Real-time mesh health visualization with node purge animations
 * 
 * ## Protocol Behavior
 * - Connects to WSS endpoint for encrypted telemetry feed
 * - Displays nodes as icons with color-coded trust scores
 * - Animates purge propagation with expanding concentric circles
 * - Marks revoked nodes as grayed out with PURGED status
 * 
 * ## Fail-Visible Design
 * - STATUS_UNVERIFIED → Yellow warning icon
 * - STATUS_SPOOFED → Red alert icon with pulsing effect
 * - Attestation failures → Immediate visual feedback
 */
export const AethericSweep: React.FC<AethericSweepProps> = ({
  websocketUrl,
  updateFrequencyHz = 1,
  width = 800,
  height = 600,
}) => {
  const [nodes, setNodes] = useState<Map<string, Node>>(new Map());
  const [purgeAnimations, setPurgeAnimations] = useState<Map<string, number>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationFrameRef = useRef<number>();

  /**
   * Establish WebSocket connection with auto-reconnect
   */
  useEffect(() => {
    // Skip WebSocket connection if URL is empty (web mode)
    if (!websocketUrl) {
      console.info('[AethericSweep] Running in demo mode (no WebSocket)');
      return;
    }

    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(websocketUrl);
        
        ws.onopen = () => {
          console.info('[AethericSweep] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const message: MeshHealthMessage | RevocationCertificate = JSON.parse(event.data);
            
            // Handle revocation certificate (Aetheric Sweep)
            if ('revocation_reason' in message) {
              handleRevocationCertificate(message as RevocationCertificate);
            } else {
              // Handle node health update
              handleMeshHealthUpdate(message as MeshHealthMessage);
            }
          } catch (error) {
            console.error('[AethericSweep] Failed to parse message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('[AethericSweep] WebSocket error:', error);
        };

        ws.onclose = () => {
          console.warn('[AethericSweep] WebSocket closed, reconnecting in 5s...');
          setTimeout(connectWebSocket, 5000);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('[AethericSweep] Failed to connect WebSocket:', error);
        setTimeout(connectWebSocket, 5000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [websocketUrl]);

  /**
   * Handle incoming mesh health update
   */
  const handleMeshHealthUpdate = useCallback((message: MeshHealthMessage) => {
    setNodes((prevNodes) => {
      const newNodes = new Map(prevNodes);
      const existingNode = newNodes.get(message.node_id);

      const node: Node = {
        id: message.node_id,
        x: existingNode?.x ?? Math.random() * (width - 100) + 50,
        y: existingNode?.y ?? Math.random() * (height - 100) + 50,
        status: message.status,
        trustScore: message.trust_score,
        lastSeenNs: message.last_seen_ns,
        rootAgreementRatio: message.metrics.root_agreement_ratio,
        chainBreakCount: message.metrics.chain_break_count,
        signatureFailureCount: message.metrics.signature_failure_count,
        payloadFreshnessMs: message.payload_freshness_ms,
        payloadSignatureValid: message.payload_signature_valid,
        isStalePayload: message.stale_payload,
        beingPurged: existingNode?.beingPurged ?? false,
        purgeReason: existingNode?.purgeReason,
      };

      newNodes.set(message.node_id, node);
      return newNodes;
    });
  }, [width, height]);

  /**
   * Handle incoming revocation certificate (Aetheric Sweep initiated)
   */
  const handleRevocationCertificate = useCallback((cert: RevocationCertificate) => {
    console.warn(`[AethericSweep] Node purge initiated: ${cert.node_id}, reason: ${cert.revocation_reason}`);

    setNodes((prevNodes) => {
      const newNodes = new Map(prevNodes);
      const node = newNodes.get(cert.node_id);

      if (node) {
        node.beingPurged = true;
        node.purgeReason = cert.revocation_reason;
        newNodes.set(cert.node_id, node);
      }

      return newNodes;
    });

    // Start purge animation
    setPurgeAnimations((prev) => {
      const newAnimations = new Map(prev);
      newAnimations.set(cert.node_id, Date.now());
      return newAnimations;
    });

    // Remove animation after completion
    setTimeout(() => {
      setPurgeAnimations((prev) => {
        const newAnimations = new Map(prev);
        newAnimations.delete(cert.node_id);
        return newAnimations;
      });
    }, PURGE_ANIMATION_DURATION_MS);
  }, []);

  /**
   * Animation loop for canvas rendering
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      // Clear canvas
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      ctx.strokeStyle = '#1a2332';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw nodes
      nodes.forEach((node) => {
        drawNode(ctx, node);
      });

      // Draw purge animations
      purgeAnimations.forEach((startTime, nodeId) => {
        const node = nodes.get(nodeId);
        if (node) {
          drawPurgeAnimation(ctx, node, startTime);
        }
      });

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [nodes, purgeAnimations, width, height]);

  /**
   * Draw individual node on canvas
   */
  const drawNode = (ctx: CanvasRenderingContext2D, node: Node) => {
    const radius = 12;

    // Determine color based on status and trust score
    let color = '#00ff88'; // HEALTHY (green)
    const visualStatus = getNodeVisualStatus(node);

    if (node.beingPurged) {
      color = '#ff0044'; // PURGED (red)
    } else if (visualStatus === NodeHealthStatus.COMPROMISED) {
      color = '#ff4400';
    } else if (visualStatus === NodeHealthStatus.DEGRADED) {
      color = '#ffaa00';
    } else if (visualStatus === NodeHealthStatus.UNKNOWN) {
      color = '#888888';
    }

    // Draw node circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fill();

    // Draw trust score indicator
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI * node.trustScore);
    ctx.stroke();

    // Draw node ID
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(node.id, node.x, node.y + radius + 15);

    const trustPercent = Math.max(0, Math.min(100, node.trustScore * 100));
    const trustLevel = getTrustLevelLabel(getSeverityLevel(trustPercent));
    ctx.fillStyle = '#9cc4ff';
    ctx.fillText(`${trustPercent.toFixed(0)}% • ${trustLevel}`, node.x, node.y - radius - 10);

    // Pulsing effect for purged nodes
    if (node.beingPurged) {
      const pulse = Math.sin(Date.now() / PULSE_ANIMATION_PERIOD_MS) * 0.3 + 0.7;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ff0044';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  };

  /**
   * Draw expanding concentric circles for purge propagation
   */
  const drawPurgeAnimation = (
    ctx: CanvasRenderingContext2D,
    node: Node,
    startTime: number
  ) => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / PURGE_ANIMATION_DURATION_MS, 1.0);

    // Draw 3 expanding circles
    for (let i = 0; i < SWEEP_CIRCLE_COUNT; i++) {
      const delay = i * SWEEP_CIRCLE_DELAY;
      const circleProgress = Math.max(0, Math.min((progress - delay) / (1 - delay), 1.0));
      const radius = circleProgress * 200;
      const opacity = (1 - circleProgress) * 0.6;

      ctx.strokeStyle = `rgba(255, 0, 68, ${opacity})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  };

  return (
    <div style={{ position: 'relative', width, height, backgroundColor: '#0a0e1a' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const clickX = event.clientX - rect.left;
          const clickY = event.clientY - rect.top;

          let nearestId: string | null = null;
          let nearestDistance = Number.POSITIVE_INFINITY;

          nodes.forEach((node) => {
            const distance = Math.hypot(node.x - clickX, node.y - clickY);
            if (distance < 24 && distance < nearestDistance) {
              nearestDistance = distance;
              nearestId = node.id;
            }
          });

          setSelectedNodeId(nearestId);
        }}
        style={{ display: 'block' }}
      />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          color: '#00ff88',
          fontFamily: 'monospace',
          fontSize: '12px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '10px',
          borderRadius: '4px',
        }}
      >
        <div>Mesh Nodes: {nodes.size}</div>
        <div>
          Healthy:{' '}
          {Array.from(nodes.values()).filter((n) => getNodeVisualStatus(n) === NodeHealthStatus.HEALTHY).length}
        </div>
        <div>
          Degraded:{' '}
          {Array.from(nodes.values()).filter((n) => getNodeVisualStatus(n) === NodeHealthStatus.DEGRADED).length}
        </div>
        <div>
          Compromised:{' '}
          {Array.from(nodes.values()).filter((n) => getNodeVisualStatus(n) === NodeHealthStatus.COMPROMISED)
            .length}
        </div>
        <div>Active Purges: {purgeAnimations.size}</div>
      </div>
      {selectedNodeId && nodes.get(selectedNodeId) && (
        <div
          data-testid="node-detail-panel"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            color: '#d8e6ff',
            fontFamily: 'monospace',
            fontSize: '12px',
            backgroundColor: 'rgba(9, 14, 26, 0.92)',
            border: '1px solid rgba(255,255,255,0.16)',
            padding: '10px 12px',
            borderRadius: '6px',
            minWidth: '230px',
          }}
        >
          {(() => {
            const node = nodes.get(selectedNodeId)!;
            const trustPercent = Math.max(0, Math.min(100, node.trustScore * 100));
            const severity = getSeverityLevel(trustPercent);
            const trustColor = severity === 'high' ? '#00ff88' : severity === 'medium' ? '#ffaa00' : '#ff4400';
            const freshnessMs = node.payloadFreshnessMs ?? getNodeFreshnessAgeMs(node);
            const stale = isNodePayloadStale(node);
            const invalidSignature = hasInvalidPayloadSignature(node);
            const integrity = getMeshIntegrityLabel(node);

            return (
              <>
                <div style={{ marginBottom: 8, fontWeight: 700 }}>Node {node.id}</div>
                <div>Trust Percent: <span style={{ color: trustColor }}>{trustPercent.toFixed(0)}%</span></div>
                <div>
                  Trust Level: <span style={{ color: trustColor, border: `1px solid ${trustColor}`, padding: '0 6px', borderRadius: 999 }}>{getTrustLevelLabel(severity)}</span>
                </div>
                <div>
                  Mesh Integrity Status:{' '}
                  <span style={{ color: invalidSignature ? '#ff4400' : stale ? '#ffaa00' : '#00ff88' }}>
                    {integrity}
                  </span>
                </div>
                <div>
                  Freshness Indicator:{' '}
                  <span style={{ color: stale ? '#ffaa00' : '#00ff88' }}>
                    {stale ? 'Stale' : 'Fresh'} ({freshnessMs.toFixed(0)}ms)
                  </span>
                </div>
                <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.16)', paddingTop: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Integrity Metrics</div>
                  <div>Root Agreement: {((node.rootAgreementRatio ?? 0) * 100).toFixed(1)}%</div>
                  <div>Chain Breaks: {node.chainBreakCount ?? 0}</div>
                  <div>Signature Failures: {node.signatureFailureCount ?? 0}</div>
                </div>
                {invalidSignature && (
                  <div style={{ marginTop: 8, color: '#ff4400' }}>Error: Invalid signature payload</div>
                )}
                {!invalidSignature && stale && (
                  <div style={{ marginTop: 8, color: '#ffaa00' }}>Warning: Stale payload window exceeded</div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default AethericSweep;
