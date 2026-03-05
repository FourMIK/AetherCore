/**
 * Settings Screen
 * Device info and application settings
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { useBootstrapStore } from '../store/useBootstrapStore';
import { getDeviceInfo, getDeviceIdentity } from '../services/identityService';
import { simulateByzantineAttack, simulateNodeRecovery } from '../services/mockDataService';
import { useTacticalStore } from '../store/useTacticalStore';

export function SettingsScreen() {
  const deviceInfo = getDeviceInfo();
  const deviceIdentity = getDeviceIdentity();
  const [enableMockEvents, setEnableMockEvents] = useState(true);
  const [testMode, setTestMode] = useState(false);
  const nodes = useTacticalStore((state) => state.getAllNodes());

  const handleSimulateAttack = () => {
    if (nodes.length > 0) {
      const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
      simulateByzantineAttack(randomNode.id);
    }
  };

  const handleSimulateRecovery = () => {
    if (nodes.length > 0) {
      const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
      simulateNodeRecovery(randomNode.id);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Device Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DEVICE INFORMATION</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Device Model:</Text>
            <Text style={styles.value}>{deviceInfo.model}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Brand:</Text>
            <Text style={styles.value}>{deviceInfo.brand}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>OS Version:</Text>
            <Text style={styles.value}>{deviceInfo.osVersion}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Device Type:</Text>
            <Text style={styles.value}>Tablet</Text>
          </View>
        </View>
      </View>

      {/* Node Identity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NODE IDENTITY</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Node ID:</Text>
            <Text style={styles.value}>{deviceIdentity.nodeId}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Device ID:</Text>
            <Text style={styles.valueSmall} numberOfLines={1}>
              {deviceIdentity.deviceId.substring(0, 32)}...
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Public Key:</Text>
            <Text style={styles.valueSmall} numberOfLines={1}>
              {deviceIdentity.publicKey.substring(0, 32)}...
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Hardware-Backed:</Text>
            <Text style={[styles.value, deviceIdentity.isHardwareBacked && styles.valueGood]}>
              {deviceIdentity.isHardwareBacked ? 'Yes' : 'No'}
            </Text>
          </View>
        </View>
      </View>

      {/* Application Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>APPLICATION SETTINGS</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Mock Event Generation</Text>
              <Text style={styles.settingDescription}>Automatically generate test events</Text>
            </View>
            <Switch
              value={enableMockEvents}
              onValueChange={setEnableMockEvents}
              trackColor={{ false: '#1a1f3a', true: '#00ff9f30' }}
              thumbColor={enableMockEvents ? '#00ff9f' : '#666'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Test Mode</Text>
              <Text style={styles.settingDescription}>Enable debugging features</Text>
            </View>
            <Switch
              value={testMode}
              onValueChange={setTestMode}
              trackColor={{ false: '#1a1f3a', true: '#00ff9f30' }}
              thumbColor={testMode ? '#00ff9f' : '#666'}
            />
          </View>
        </View>
      </View>

      {/* Testing Utilities */}
      {testMode && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TESTING UTILITIES</Text>
          <View style={styles.card}>
            <Pressable style={styles.testBtn} onPress={handleSimulateAttack}>
              <Text style={styles.testBtnText}>Simulate Byzantine Attack</Text>
            </Pressable>

            <View style={styles.divider} />

            <Pressable style={[styles.testBtn, styles.recoveryBtn]} onPress={handleSimulateRecovery}>
              <Text style={styles.testBtnText}>Simulate Node Recovery</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Application Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>APPLICATION</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>App Name:</Text>
            <Text style={styles.value}>AetherCore Tactical</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Version:</Text>
            <Text style={styles.value}>0.1.0</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Build Type:</Text>
            <Text style={styles.value}>Development</Text>
          </View>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ABOUT</Text>
        <View style={styles.card}>
          <Text style={styles.aboutText}>
            AetherCore is a hardware-rooted trust fabric for contested multi-domain environments.
            This standalone tablet application demonstrates trust assessment and Byzantine fault detection capabilities.
          </Text>
          <Text style={styles.copyright}>
            © 2026 AetherCore Defense Systems
          </Text>
        </View>
      </View>

      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 1,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#1a1f3a',
    borderRadius: 8,
    borderColor: '#2a2f4a',
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: '#2a2f4a',
    borderBottomWidth: 1,
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
  valueSmall: {
    fontSize: 10,
    color: '#00d9ff',
    fontWeight: '600',
    maxWidth: 150,
  },
  valueGood: {
    color: '#00ff9f',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 10,
    color: '#666',
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2f4a',
  },
  testBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recoveryBtn: {
    paddingTop: 12,
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00ff9f',
  },
  aboutText: {
    fontSize: 11,
    color: '#aaa',
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  copyright: {
    fontSize: 10,
    color: '#555',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  footer: {
    height: 60,
  },
});

