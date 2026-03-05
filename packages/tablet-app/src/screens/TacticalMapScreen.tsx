/**
 * Tactical Map Screen
 * Main map view showing node locations and trust status
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView } from 'react-native';
import { useTacticalStore } from '../store/useTacticalStore';
import { TrustScoreIndicator } from '../components/TrustScoreIndicator';
import { getDeviceInfo } from '../services/identityService';

export function TacticalMapScreen() {
  const nodes = useTacticalStore((state) => state.getAllNodes());
  const selectedNodeId = useTacticalStore((state) => state.selectedNodeId);
  const selectNode = useTacticalStore((state) => state.selectNode);
  const meshConnected = useTacticalStore((state) => state.meshConnected);

  const [mapZoom, setMapZoom] = useState(1);
  const selectedNode = selectedNodeId ? useTacticalStore((state) => state.getNode(selectedNodeId)) : null;
  const deviceInfo = getDeviceInfo();

  const healthyCount = nodes.filter((n) => n.status === 'healthy').length;
  const suspectCount = nodes.filter((n) => n.status === 'suspect').length;
  const quarantinedCount = nodes.filter((n) => n.status === 'quarantined').length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>TACTICAL MAP</Text>
          <Text style={styles.headerSubtitle}>{nodes.length} nodes detected</Text>
        </View>
        <View style={styles.meshIndicator}>
          <View style={[styles.meshDot, meshConnected && styles.meshConnected]} />
          <Text style={styles.meshLabel}>{meshConnected ? 'MESH' : 'OFFLINE'}</Text>
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        {/* Map Area (Placeholder) */}
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapTitle}>2D TACTICAL DISPLAY</Text>
          <View style={styles.mapGrid}>
            {nodes.map((node) => (
              <Pressable
                key={node.id}
                onPress={() => selectNode(selectedNodeId === node.id ? null : node.id)}
                style={[
                  styles.mapNode,
                  {
                    left: `${((node.longitude + 118.27) * 1000) % 90}%`,
                    top: `${((node.latitude - 34) * 1000) % 90}%`,
                  },
                  node.status === 'healthy' && styles.nodeHealthy,
                  node.status === 'suspect' && styles.nodeSuspect,
                  node.status === 'quarantined' && styles.nodeQuarantined,
                  selectedNodeId === node.id && styles.nodeSelected,
                ]}
              >
                <Text style={styles.mapNodeLabel}>{node.trustScore.toFixed(2)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Right Panel - Node List or Details */}
        {selectedNode ? (
          <View style={styles.detailsPanel}>
            <View style={styles.detailsHeader}>
              <Text style={styles.detailsTitle}>NODE DETAILS</Text>
              <Pressable onPress={() => selectNode(null)}>
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Name:</Text>
                <Text style={styles.detailValue}>{selectedNode.name}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Trust Score:</Text>
                <View style={styles.detailValue}>
                  <TrustScoreIndicator score={selectedNode.trustScore} showLabel={true} />
                </View>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status:</Text>
                <Text style={[styles.detailValue, styles[`status${selectedNode.status}`]]}>
                  {selectedNode.status.toUpperCase()}
                </Text>
              </View>

              <View style={styles.divider} />

              <Text style={styles.metricsTitle}>INTEGRITY METRICS</Text>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Signature Fail Rate:</Text>
                <Text style={styles.metricValue}>{(selectedNode.signatureFailRate * 100).toFixed(1)}%</Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Replay Events:</Text>
                <Text style={styles.metricValue}>{selectedNode.replayEventCount}</Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Packet Loss:</Text>
                <Text style={styles.metricValue}>{(selectedNode.packetLossRate * 100).toFixed(1)}%</Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Uptime:</Text>
                <Text style={styles.metricValue}>{selectedNode.uptime}%</Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Hardware-Backed:</Text>
                <Text style={styles.metricValue}>{selectedNode.isHardwareBacked ? 'Yes' : 'No'}</Text>
              </View>
            </ScrollView>
          </View>
        ) : (
          <View style={styles.statsPanel}>
            <Text style={styles.statsTitle}>NETWORK STATUS</Text>

            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{healthyCount}</Text>
                <Text style={[styles.statLabel, styles.labelHealthy]}>HEALTHY</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statValue}>{suspectCount}</Text>
                <Text style={[styles.statLabel, styles.labelSuspect]}>SUSPECT</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statValue}>{quarantinedCount}</Text>
                <Text style={[styles.statLabel, styles.labelQuarantined]}>QUARANTINED</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <Text style={styles.statsTitle}>DEVICE INFO</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Device:</Text>
              <Text style={styles.infoValue}>{deviceInfo.model}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>OS:</Text>
              <Text style={styles.infoValue}>{deviceInfo.osVersion}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: '#1a1f3a',
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  meshIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1a1f3a',
    borderRadius: 6,
  },
  meshDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#666',
    marginRight: 8,
  },
  meshConnected: {
    backgroundColor: '#00ff9f',
  },
  meshLabel: {
    fontSize: 11,
    color: '#aaa',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  mapPlaceholder: {
    flex: 1,
    margin: 12,
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    padding: 16,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    overflow: 'hidden',
  },
  mapTitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    letterSpacing: 1,
  },
  mapGrid: {
    flex: 1,
    backgroundColor: '#000a15',
    borderRadius: 4,
    position: 'relative',
  },
  mapNode: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  nodeHealthy: {
    backgroundColor: '#00ff9f30',
    borderColor: '#00ff9f',
  },
  nodeSuspect: {
    backgroundColor: '#ffaa0030',
    borderColor: '#ffaa00',
  },
  nodeQuarantined: {
    backgroundColor: '#ff444430',
    borderColor: '#ff4444',
  },
  nodeSelected: {
    borderWidth: 3,
    shadowColor: '#fff',
    elevation: 10,
  },
  mapNodeLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },
  detailsPanel: {
    width: 320,
    margin: 12,
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: '#2a2f4a',
    borderBottomWidth: 1,
  },
  detailsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 1,
  },
  closeBtn: {
    fontSize: 18,
    color: '#666',
  },
  detailsContent: {
    flex: 1,
    padding: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 11,
    color: '#888',
  },
  detailValue: {
    fontSize: 11,
    color: '#00d9ff',
    fontWeight: '600',
  },
  statusHealthy: {
    color: '#00ff9f',
  },
  statusSuspect: {
    color: '#ffaa00',
  },
  statusQuarantined: {
    color: '#ff4444',
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2f4a',
    marginVertical: 12,
  },
  metricsTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#666',
    letterSpacing: 1,
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricLabel: {
    fontSize: 10,
    color: '#888',
  },
  metricValue: {
    fontSize: 10,
    color: '#aaa',
    fontWeight: '600',
  },
  statsPanel: {
    width: 320,
    margin: 12,
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    padding: 16,
  },
  statsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 1,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#0a0e27',
    borderRadius: 6,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  labelHealthy: {
    color: '#00ff9f',
  },
  labelSuspect: {
    color: '#ffaa00',
  },
  labelQuarantined: {
    color: '#ff4444',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 10,
    color: '#888',
  },
  infoValue: {
    fontSize: 10,
    color: '#aaa',
    fontWeight: '600',
  },
});

