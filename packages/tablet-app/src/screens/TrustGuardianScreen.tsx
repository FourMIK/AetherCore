/**
 * Trust Guardian Screen
 * Node list with trust scores and health status
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView } from 'react-native';
import { useTacticalStore } from '../store/useTacticalStore';
import { TrustScoreIndicator } from '../components/TrustScoreIndicator';

export function TrustGuardianScreen() {
  const nodes = useTacticalStore((state) => state.getAllNodes());
  const selectedNodeId = useTacticalStore((state) => state.selectedNodeId);
  const selectNode = useTacticalStore((state) => state.selectNode);
  const [sortBy, setSortBy] = useState<'trust' | 'name'>('trust');

  const sortedNodes = [...nodes].sort((a, b) => {
    if (sortBy === 'trust') {
      return b.trustScore - a.trustScore;
    }
    return a.name.localeCompare(b.name);
  });

  const selectedNode = selectedNodeId ? useTacticalStore((state) => state.getNode(selectedNodeId)) : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>TRUST GUARDIAN</Text>
        <View style={styles.sortControls}>
          <Pressable
            onPress={() => setSortBy('trust')}
            style={[styles.sortBtn, sortBy === 'trust' && styles.sortBtnActive]}
          >
            <Text style={[styles.sortBtnText, sortBy === 'trust' && styles.sortBtnTextActive]}>
              By Trust
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortBy('name')}
            style={[styles.sortBtn, sortBy === 'name' && styles.sortBtnActive]}
          >
            <Text style={[styles.sortBtnText, sortBy === 'name' && styles.sortBtnTextActive]}>
              By Name
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        {/* Node List */}
        <View style={styles.listPanel}>
          <FlatList
            data={sortedNodes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => selectNode(selectedNodeId === item.id ? null : item.id)}
                style={[
                  styles.nodeItem,
                  selectedNodeId === item.id && styles.nodeItemSelected,
                ]}
              >
                <View style={styles.nodeInfo}>
                  <Text style={styles.nodeName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.nodeDomain}>{item.domain}</Text>
                </View>
                <TrustScoreIndicator score={item.trustScore} size="medium" />
              </Pressable>
            )}
            scrollEnabled={true}
            showsVerticalScrollIndicator={true}
          />
        </View>

        {/* Details Panel */}
        {selectedNode ? (
          <View style={styles.detailsPanel}>
            <View style={styles.detailsHeader}>
              <Text style={styles.detailsTitle}>NODE ANALYSIS</Text>
              <Pressable onPress={() => selectNode(null)}>
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
              {/* Trust Score */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>TRUST ASSESSMENT</Text>
                <View style={styles.scoreContainer}>
                  <TrustScoreIndicator score={selectedNode.trustScore} size="large" showLabel={true} />
                </View>
              </View>

              {/* Node Details */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>IDENTITY</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Node ID:</Text>
                  <Text style={styles.value} numberOfLines={1}>
                    {selectedNode.id.substring(0, 12)}...
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Public Key:</Text>
                  <Text style={styles.value} numberOfLines={1}>
                    {selectedNode.publicKey.substring(0, 16)}...
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Hardware-Backed:</Text>
                  <Text style={[styles.value, selectedNode.isHardwareBacked && styles.valueGood]}>
                    {selectedNode.isHardwareBacked ? 'Yes' : 'No'}
                  </Text>
                </View>
              </View>

              {/* Metrics */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>INTEGRITY METRICS</Text>
                <View style={styles.metricBar}>
                  <Text style={styles.metricLabel}>Signature Fail Rate</Text>
                  <View style={styles.metricBarBg}>
                    <View
                      style={[
                        styles.metricBarFill,
                        {
                          width: `${Math.min(100, selectedNode.signatureFailRate * 100)}%`,
                          backgroundColor: selectedNode.signatureFailRate > 0.05 ? '#ff4444' : '#00ff9f',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.metricValue}>
                    {(selectedNode.signatureFailRate * 100).toFixed(2)}%
                  </Text>
                </View>

                <View style={styles.metricBar}>
                  <Text style={styles.metricLabel}>Packet Loss Rate</Text>
                  <View style={styles.metricBarBg}>
                    <View
                      style={[
                        styles.metricBarFill,
                        {
                          width: `${Math.min(100, selectedNode.packetLossRate * 100)}%`,
                          backgroundColor: selectedNode.packetLossRate > 0.1 ? '#ff4444' : '#00ff9f',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.metricValue}>
                    {(selectedNode.packetLossRate * 100).toFixed(2)}%
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.label}>Replay Events:</Text>
                  <Text style={[styles.value, selectedNode.replayEventCount > 0 && styles.valueBad]}>
                    {selectedNode.replayEventCount}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.label}>Uptime:</Text>
                  <Text style={styles.value}>{selectedNode.uptime}%</Text>
                </View>
              </View>

              {/* Location */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>LOCATION</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Latitude:</Text>
                  <Text style={styles.value}>{selectedNode.latitude.toFixed(4)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Longitude:</Text>
                  <Text style={styles.value}>{selectedNode.longitude.toFixed(4)}</Text>
                </View>
              </View>

              {/* Last Update */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>STATUS</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Last Update:</Text>
                  <Text style={styles.value}>
                    {new Date(selectedNode.lastUpdate).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        ) : (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyText}>Select a node to view details</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: '#1a1f3a',
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 2,
    marginBottom: 12,
  },
  sortControls: {
    flexDirection: 'row',
    gap: 8,
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#1a1f3a',
    borderColor: '#2a2f4a',
    borderWidth: 1,
  },
  sortBtnActive: {
    backgroundColor: '#00ff9f20',
    borderColor: '#00ff9f',
  },
  sortBtnText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
  },
  sortBtnTextActive: {
    color: '#00ff9f',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  listPanel: {
    flex: 0.4,
    margin: 12,
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    overflow: 'hidden',
  },
  nodeItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomColor: '#2a2f4a',
    borderBottomWidth: 1,
  },
  nodeItemSelected: {
    backgroundColor: '#00ff9f15',
    borderLeftColor: '#00ff9f',
    borderLeftWidth: 3,
    paddingLeft: 9,
  },
  nodeInfo: {
    flex: 1,
    marginRight: 12,
  },
  nodeName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  nodeDomain: {
    fontSize: 10,
    color: '#666',
  },
  detailsPanel: {
    flex: 0.6,
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
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#666',
    letterSpacing: 1,
    marginBottom: 12,
  },
  scoreContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    color: '#888',
  },
  value: {
    fontSize: 11,
    color: '#00d9ff',
    fontWeight: '600',
  },
  valueGood: {
    color: '#00ff9f',
  },
  valueBad: {
    color: '#ff4444',
  },
  metricBar: {
    marginBottom: 16,
  },
  metricLabel: {
    fontSize: 10,
    color: '#888',
    marginBottom: 4,
  },
  metricBarBg: {
    height: 6,
    backgroundColor: '#0a0e27',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  metricBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricValue: {
    fontSize: 10,
    color: '#aaa',
    textAlign: 'right',
  },
  emptyPanel: {
    flex: 1,
    margin: 12,
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    letterSpacing: 1,
  },
});

