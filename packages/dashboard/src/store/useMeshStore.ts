/**
 * Mesh Store - Link Quality and Metrics
 * 
 * Tracks real-time mesh network link quality metrics for the tactical dashboard.
 * Replaces hard-coded placeholders with actual measurements.
 */

import { create } from 'zustand';

// Bandwidth estimation constants (Mbps)
// Based on typical RF link quality characteristics
const BANDWIDTH_EXCELLENT = 100; // Excellent links: 100 Mbps
const BANDWIDTH_GOOD = 50;       // Good links: 50 Mbps
const BANDWIDTH_FAIR = 20;       // Fair links: 20 Mbps
const BANDWIDTH_POOR = 5;        // Poor links: 5 Mbps
const BANDWIDTH_CRITICAL = 1;    // Critical links: 1 Mbps

// Link quality metrics for a peer connection
export interface LinkMetrics {
  peerId: string;
  peerName?: string;
  // RTT (Round-Trip Time) in milliseconds
  rttMs: number;
  // Packet loss percentage (0.0 to 1.0)
  packetLossPercent: number;
  // Signal-to-Noise Ratio in dB (if available from radio layer)
  snrDb?: number;
  // Trust score (0.0 to 1.0) from trust mesh
  trustScore: number;
  // Last measurement timestamp
  lastMeasured: Date;
  // Computed link score (0.0 to 1.0, higher is better)
  linkScore: number;
  // Human-readable link quality label
  linkQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

// Aggregate mesh statistics
export interface MeshStats {
  totalPeers: number;
  connectedPeers: number;
  averageRttMs: number;
  averagePacketLoss: number;
  averageLinkScore: number;
  totalBandwidthMbps: number;
  lastUpdated: Date;
}

interface MeshState {
  // Link metrics for each peer
  linkMetrics: Map<string, LinkMetrics>;
  
  // Aggregate stats
  meshStats: MeshStats;
  
  // Actions
  updateLinkMetrics: (peerId: string, metrics: Partial<Omit<LinkMetrics, 'linkScore' | 'linkQuality'>>) => void;
  removePeer: (peerId: string) => void;
  clearMetrics: () => void;
  computeAggregateStats: () => void;
}

/**
 * Compute link score from metrics
 * Returns 0.0 to 1.0 (higher is better)
 */
function computeLinkScore(
  rttMs: number,
  packetLoss: number,
  trustScore: number,
  snrDb?: number
): number {
  // RTT component (0-1, lower RTT is better)
  // Assume 0ms = 1.0, 500ms = 0.0
  const rttScore = Math.max(0, 1 - rttMs / 500);
  
  // Packet loss component (0-1, lower loss is better)
  const lossScore = 1 - packetLoss;
  
  // Trust component (0-1, higher trust is better)
  const trustComponent = trustScore;
  
  // SNR component (0-1, higher SNR is better)
  // Assume 0dB = 0.5, 30dB = 1.0, -10dB = 0.0
  const snrScore = snrDb !== undefined
    ? Math.max(0, Math.min(1, (snrDb + 10) / 40))
    : 0.7; // Default neutral if not available
  
  // Weighted average: RTT(30%), Loss(30%), Trust(20%), SNR(20%)
  const score = (
    rttScore * 0.3 +
    lossScore * 0.3 +
    trustComponent * 0.2 +
    snrScore * 0.2
  );
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Get human-readable quality label from score
 */
function getLinkQualityLabel(score: number): LinkMetrics['linkQuality'] {
  if (score >= 0.9) return 'excellent';
  if (score >= 0.7) return 'good';
  if (score >= 0.5) return 'fair';
  if (score >= 0.3) return 'poor';
  return 'critical';
}

export const useMeshStore = create<MeshState>((set, get) => ({
  linkMetrics: new Map(),
  meshStats: {
    totalPeers: 0,
    connectedPeers: 0,
    averageRttMs: 0,
    averagePacketLoss: 0,
    averageLinkScore: 0,
    totalBandwidthMbps: 0,
    lastUpdated: new Date(),
  },

  updateLinkMetrics: (peerId, updates) => {
    set((state) => {
      const existing = state.linkMetrics.get(peerId);
      
      // Merge updates with existing or create new
      const merged: LinkMetrics = {
        peerId,
        peerName: updates.peerName ?? existing?.peerName,
        rttMs: updates.rttMs ?? existing?.rttMs ?? 0,
        packetLossPercent: updates.packetLossPercent ?? existing?.packetLossPercent ?? 0,
        snrDb: updates.snrDb ?? existing?.snrDb,
        trustScore: updates.trustScore ?? existing?.trustScore ?? 1.0,
        lastMeasured: updates.lastMeasured ?? new Date(),
        linkScore: 0, // Will be computed below
        linkQuality: 'good', // Will be computed below
      };
      
      // Compute derived metrics
      merged.linkScore = computeLinkScore(
        merged.rttMs,
        merged.packetLossPercent,
        merged.trustScore,
        merged.snrDb
      );
      merged.linkQuality = getLinkQualityLabel(merged.linkScore);
      
      const newMetrics = new Map(state.linkMetrics);
      newMetrics.set(peerId, merged);
      
      return { linkMetrics: newMetrics };
    });
    
    // Update aggregate stats
    get().computeAggregateStats();
  },

  removePeer: (peerId) => {
    set((state) => {
      const newMetrics = new Map(state.linkMetrics);
      newMetrics.delete(peerId);
      return { linkMetrics: newMetrics };
    });
    
    get().computeAggregateStats();
  },

  clearMetrics: () => {
    set({
      linkMetrics: new Map(),
      meshStats: {
        totalPeers: 0,
        connectedPeers: 0,
        averageRttMs: 0,
        averagePacketLoss: 0,
        averageLinkScore: 0,
        totalBandwidthMbps: 0,
        lastUpdated: new Date(),
      },
    });
  },

  computeAggregateStats: () => {
    const metrics = Array.from(get().linkMetrics.values());
    
    if (metrics.length === 0) {
      set({
        meshStats: {
          totalPeers: 0,
          connectedPeers: 0,
          averageRttMs: 0,
          averagePacketLoss: 0,
          averageLinkScore: 0,
          totalBandwidthMbps: 0,
          lastUpdated: new Date(),
        },
      });
      return;
    }
    
    const avgRtt = metrics.reduce((sum, m) => sum + m.rttMs, 0) / metrics.length;
    const avgLoss = metrics.reduce((sum, m) => sum + m.packetLossPercent, 0) / metrics.length;
    const avgScore = metrics.reduce((sum, m) => sum + m.linkScore, 0) / metrics.length;
    
    // Estimate bandwidth based on link quality using predefined constants
    const totalBandwidth = metrics.reduce((sum, m) => {
      const bw = m.linkQuality === 'excellent' ? BANDWIDTH_EXCELLENT :
                 m.linkQuality === 'good' ? BANDWIDTH_GOOD :
                 m.linkQuality === 'fair' ? BANDWIDTH_FAIR :
                 m.linkQuality === 'poor' ? BANDWIDTH_POOR :
                 BANDWIDTH_CRITICAL;
      return sum + bw;
    }, 0);
    
    set({
      meshStats: {
        totalPeers: metrics.length,
        connectedPeers: metrics.filter(m => m.linkScore > 0.3).length, // Fair or better
        averageRttMs: avgRtt,
        averagePacketLoss: avgLoss,
        averageLinkScore: avgScore,
        totalBandwidthMbps: totalBandwidth,
        lastUpdated: new Date(),
      },
    });
  },
}));
