/**
 * Byzantine Alerts Screen
 * Real-time Byzantine fault detection feed
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useTacticalStore } from '../store/useTacticalStore';
import { AlertTriangleIcon, XCircleIcon } from 'lucide-react-native';

export function ByzantineAlertsScreen() {
  const faultEvents = useTacticalStore((state) => state.getFaultEvents());
  const nodes = useTacticalStore((state) => state.getAllNodes());
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const sortedEvents = [...faultEvents].sort((a, b) => b.timestamp - a.timestamp);

  const getNodeName = (nodeId: string): string => {
    return nodes.find((n) => n.id === nodeId)?.name || 'Unknown Node';
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical':
        return '#ff4444';
      case 'high':
        return '#ff8844';
      case 'medium':
        return '#ffaa00';
      default:
        return '#ffdd00';
    }
  };

  const getFaultTypeIcon = (faultType: string): string => {
    switch (faultType) {
      case 'InvalidSignature':
        return '✕';
      case 'BrokenHashChain':
        return '⚡';
      case 'DoubleVote':
        return '⚖';
      case 'ReplayDetected':
        return '⟳';
      default:
        return '!';
    }
  };

  const getFaultTypeLabel = (faultType: string): string => {
    return faultType.replace(/([A-Z])/g, ' $1').trim();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>BYZANTINE ALERTS</Text>
        <View style={styles.alertCount}>
          <Text style={styles.alertCountText}>{faultEvents.length}</Text>
        </View>
      </View>

      {/* Alert Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>CRITICAL</Text>
          <Text style={[styles.statValue, { color: '#ff4444' }]}>
            {faultEvents.filter((e) => e.severity === 'critical').length}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>HIGH</Text>
          <Text style={[styles.statValue, { color: '#ff8844' }]}>
            {faultEvents.filter((e) => e.severity === 'high').length}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>MEDIUM</Text>
          <Text style={[styles.statValue, { color: '#ffaa00' }]}>
            {faultEvents.filter((e) => e.severity === 'medium').length}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>LOW</Text>
          <Text style={[styles.statValue, { color: '#ffdd00' }]}>
            {faultEvents.filter((e) => e.severity === 'low').length}
          </Text>
        </View>
      </View>

      {/* Alerts List */}
      <View style={styles.alertsContainer}>
        {faultEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No Byzantine faults detected</Text>
            <Text style={styles.emptyStateSubtext}>Network is healthy</Text>
          </View>
        ) : (
          <FlatList
            data={sortedEvents}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isExpanded = expandedEventId === item.id;
              const severityColor = getSeverityColor(item.severity);
              const nodeName = getNodeName(item.nodeId);

              return (
                <Pressable
                  onPress={() => setExpandedEventId(isExpanded ? null : item.id)}
                  style={[
                    styles.alertCard,
                    isExpanded && styles.alertCardExpanded,
                  ]}
                >
                  {/* Alert Header */}
                  <View style={styles.alertHeader}>
                    <View style={[styles.severityIcon, { borderColor: severityColor }]}>
                      <Text style={{ color: severityColor, fontWeight: 'bold' }}>
                        {getFaultTypeIcon(item.faultType)}
                      </Text>
                    </View>

                    <View style={styles.alertTitleSection}>
                      <Text style={[styles.alertType, { color: severityColor }]}>
                        {getFaultTypeLabel(item.faultType)}
                      </Text>
                      <Text style={styles.alertNode} numberOfLines={1}>
                        {nodeName}
                      </Text>
                    </View>

                    <View style={styles.alertMeta}>
                      <Text style={[styles.severity, { color: severityColor }]}>
                        {item.severity.toUpperCase()}
                      </Text>
                      <Text style={styles.timestamp}>
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                  </View>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <View style={styles.alertDetails}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Fault Type:</Text>
                        <Text style={styles.detailValue}>
                          {getFaultTypeLabel(item.faultType)}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Node ID:</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>
                          {item.nodeId.substring(0, 16)}...
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Severity:</Text>
                        <Text
                          style={[
                            styles.detailValue,
                            { color: severityColor },
                          ]}
                        >
                          {item.severity.toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Timestamp:</Text>
                        <Text style={styles.detailValue}>
                          {new Date(item.timestamp).toLocaleString()}
                        </Text>
                      </View>

                      <View style={styles.descriptionRow}>
                        <Text style={styles.description}>{item.description}</Text>
                      </View>

                      {/* Action Buttons */}
                      <View style={styles.actionButtons}>
                        <Pressable style={styles.actionBtn}>
                          <Text style={styles.actionBtnText}>INVESTIGATE</Text>
                        </Pressable>
                        <Pressable style={[styles.actionBtn, styles.quarantineBtn]}>
                          <Text style={styles.actionBtnText}>QUARANTINE NODE</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </Pressable>
              );
            }}
            scrollEnabled={true}
            showsVerticalScrollIndicator={true}
          />
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
  },
  alertCount: {
    backgroundColor: '#ff4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  alertCountText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  statItem: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1a1f3a',
    borderRadius: 6,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  alertsContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 12,
    color: '#444',
  },
  alertCard: {
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    marginBottom: 12,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    overflow: 'hidden',
  },
  alertCardExpanded: {
    borderColor: '#ff4444',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  severityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0e27',
  },
  alertTitleSection: {
    flex: 1,
  },
  alertType: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  alertNode: {
    fontSize: 10,
    color: '#666',
  },
  alertMeta: {
    alignItems: 'flex-end',
  },
  severity: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  timestamp: {
    fontSize: 9,
    color: '#555',
  },
  alertDetails: {
    backgroundColor: '#0a0e27',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopColor: '#2a2f4a',
    borderTopWidth: 1,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 10,
    color: '#888',
  },
  detailValue: {
    fontSize: 10,
    color: '#00d9ff',
    fontWeight: '600',
  },
  descriptionRow: {
    marginVertical: 12,
    paddingVertical: 8,
    borderTopColor: '#2a2f4a',
    borderTopWidth: 1,
    borderBottomColor: '#2a2f4a',
    borderBottomWidth: 1,
  },
  description: {
    fontSize: 11,
    color: '#aaa',
    lineHeight: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1a1f3a',
    borderColor: '#00ff9f',
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
  },
  quarantineBtn: {
    borderColor: '#ff4444',
  },
  actionBtnText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#00ff9f',
  },
});

