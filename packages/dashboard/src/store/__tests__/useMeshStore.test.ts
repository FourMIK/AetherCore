/**
 * Mesh Store Tests - Link Quality Computation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMeshStore } from '../useMeshStore';

describe('useMeshStore - Link Quality Metrics', () => {
  beforeEach(() => {
    // Reset store before each test
    useMeshStore.getState().clearMetrics();
  });

  describe('updateLinkMetrics', () => {
    it('should compute link score for excellent connection', () => {
      const { updateLinkMetrics, linkMetrics } = useMeshStore.getState();

      updateLinkMetrics('peer1', {
        peerName: 'Node-001',
        rttMs: 10,
        packetLossPercent: 0.001,
        trustScore: 0.95,
        snrDb: 30,
      });

      const link = linkMetrics.get('peer1');
      expect(link).toBeDefined();
      expect(link?.linkScore).toBeGreaterThan(0.9);
      expect(link?.linkQuality).toBe('excellent');
    });

    it('should compute link score for poor connection', () => {
      const { updateLinkMetrics, linkMetrics } = useMeshStore.getState();

      updateLinkMetrics('peer2', {
        peerName: 'Node-002',
        rttMs: 300,
        packetLossPercent: 0.15,
        trustScore: 0.5,
        snrDb: 5,
      });

      const link = linkMetrics.get('peer2');
      expect(link).toBeDefined();
      expect(link?.linkScore).toBeLessThan(0.5);
      expect(link?.linkQuality).toMatch(/poor|critical/);
    });

    it('should compute link score for good connection', () => {
      const { updateLinkMetrics, linkMetrics } = useMeshStore.getState();

      updateLinkMetrics('peer3', {
        peerName: 'Node-003',
        rttMs: 50,
        packetLossPercent: 0.02,
        trustScore: 0.85,
        snrDb: 20,
      });

      const link = linkMetrics.get('peer3');
      expect(link).toBeDefined();
      // With these metrics, computed score should be around 0.8
      // rttScore: 0.9, lossScore: 0.98, trustScore: 0.85, snrScore: 0.75
      // (0.9*0.3 + 0.98*0.3 + 0.85*0.2 + 0.75*0.2) = 0.864
      expect(link?.linkScore).toBeCloseTo(0.864, 1);
      expect(link?.linkQuality).toBe('good');
    });

    it('should handle missing SNR gracefully', () => {
      const { updateLinkMetrics, linkMetrics } = useMeshStore.getState();

      updateLinkMetrics('peer4', {
        peerName: 'Node-004',
        rttMs: 25,
        packetLossPercent: 0.01,
        trustScore: 0.9,
        // snrDb not provided
      });

      const link = linkMetrics.get('peer4');
      expect(link).toBeDefined();
      expect(link?.linkScore).toBeGreaterThan(0);
      expect(link?.snrDb).toBeUndefined();
    });

    it('should update existing metrics', () => {
      const { updateLinkMetrics, linkMetrics } = useMeshStore.getState();

      // Initial update
      updateLinkMetrics('peer5', {
        peerName: 'Node-005',
        rttMs: 100,
        packetLossPercent: 0.05,
        trustScore: 0.8,
      });

      const initial = linkMetrics.get('peer5');
      expect(initial?.rttMs).toBe(100);

      // Update with better metrics
      updateLinkMetrics('peer5', {
        rttMs: 20,
        packetLossPercent: 0.01,
      });

      const updated = linkMetrics.get('peer5');
      expect(updated?.rttMs).toBe(20);
      expect(updated?.trustScore).toBe(0.8); // Preserved
      expect(updated?.linkScore).toBeGreaterThan(initial?.linkScore ?? 0);
    });
  });

  describe('computeAggregateStats', () => {
    it('should compute correct aggregate stats', () => {
      const { updateLinkMetrics, meshStats } = useMeshStore.getState();

      updateLinkMetrics('peer1', {
        rttMs: 10,
        packetLossPercent: 0.01,
        trustScore: 0.9,
      });

      updateLinkMetrics('peer2', {
        rttMs: 30,
        packetLossPercent: 0.02,
        trustScore: 0.85,
      });

      updateLinkMetrics('peer3', {
        rttMs: 50,
        packetLossPercent: 0.03,
        trustScore: 0.8,
      });

      expect(meshStats.totalPeers).toBe(3);
      expect(meshStats.connectedPeers).toBe(3); // All above critical threshold
      expect(meshStats.averageRttMs).toBe((10 + 30 + 50) / 3);
      expect(meshStats.averagePacketLoss).toBeCloseTo(0.02, 3);
    });

    it('should handle zero peers', () => {
      const { meshStats } = useMeshStore.getState();

      expect(meshStats.totalPeers).toBe(0);
      expect(meshStats.connectedPeers).toBe(0);
      expect(meshStats.averageRttMs).toBe(0);
      expect(meshStats.averagePacketLoss).toBe(0);
    });

    it('should only count good connections as connected', () => {
      const { updateLinkMetrics, meshStats } = useMeshStore.getState();

      // Good connection
      updateLinkMetrics('peer1', {
        rttMs: 20,
        packetLossPercent: 0.01,
        trustScore: 0.9,
      });

      // Critical connection (score < 0.3)
      updateLinkMetrics('peer2', {
        rttMs: 450,
        packetLossPercent: 0.5,
        trustScore: 0.2,
      });

      expect(meshStats.totalPeers).toBe(2);
      expect(meshStats.connectedPeers).toBe(1); // Only peer1
    });
  });

  describe('removePeer', () => {
    it('should remove peer and update stats', () => {
      const { updateLinkMetrics, removePeer, linkMetrics, meshStats } = useMeshStore.getState();

      updateLinkMetrics('peer1', {
        rttMs: 20,
        packetLossPercent: 0.01,
        trustScore: 0.9,
      });

      updateLinkMetrics('peer2', {
        rttMs: 30,
        packetLossPercent: 0.02,
        trustScore: 0.85,
      });

      expect(meshStats.totalPeers).toBe(2);

      removePeer('peer1');

      expect(linkMetrics.has('peer1')).toBe(false);
      expect(linkMetrics.has('peer2')).toBe(true);
      expect(meshStats.totalPeers).toBe(1);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all metrics', () => {
      const { updateLinkMetrics, clearMetrics, linkMetrics, meshStats } = useMeshStore.getState();

      updateLinkMetrics('peer1', {
        rttMs: 20,
        packetLossPercent: 0.01,
        trustScore: 0.9,
      });

      expect(meshStats.totalPeers).toBe(1);

      clearMetrics();

      expect(linkMetrics.size).toBe(0);
      expect(meshStats.totalPeers).toBe(0);
      expect(meshStats.averageRttMs).toBe(0);
    });
  });
});
