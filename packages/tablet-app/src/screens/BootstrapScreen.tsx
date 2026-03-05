/**
 * Bootstrap Screen
 * Initial setup and verification screen
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useBootstrapStore } from '../store/useBootstrapStore';
import { getDeviceInfo } from '../services/identityService';

export function BootstrapScreen() {
  const { initialize, error } = useBootstrapStore();
  const [steps, setSteps] = useState<Array<{ label: string; status: 'pending' | 'running' | 'complete' }>>([
    { label: 'Initializing device identity', status: 'pending' },
    { label: 'Loading mock data', status: 'pending' },
    { label: 'Starting telemetry engine', status: 'pending' },
  ]);

  useEffect(() => {
    async function bootstrap() {
      try {
        // Simulate progressive initialization
        setSteps((prev) => [
          { ...prev[0], status: 'running' },
          prev[1],
          prev[2],
        ]);

        await new Promise((resolve) => setTimeout(resolve, 500));

        setSteps((prev) => [
          { ...prev[0], status: 'complete' },
          { ...prev[1], status: 'running' },
          prev[2],
        ]);

        await new Promise((resolve) => setTimeout(resolve, 500));

        setSteps((prev) => [
          prev[0],
          { ...prev[1], status: 'complete' },
          { ...prev[2], status: 'running' },
        ]);

        // Perform actual initialization
        await initialize();

        setSteps((prev) => [
          prev[0],
          prev[1],
          { ...prev[2], status: 'complete' },
        ]);
      } catch (err) {
        console.error('Bootstrap error:', err);
      }
    }

    bootstrap();
  }, [initialize]);

  const deviceInfo = getDeviceInfo();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>AETHERCORE</Text>
        <Text style={styles.subtitle}>Tactical Trust System</Text>
      </View>

      {/* Device Info */}
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceLabel}>{deviceInfo.model}</Text>
        {deviceInfo.isTablet && <Text style={styles.deviceTag}>TABLET MODE</Text>}
      </View>

      {/* Bootstrap Steps */}
      <View style={styles.stepsContainer}>
        {steps.map((step, index) => (
          <View key={index} style={styles.stepRow}>
            <View style={styles.stepIndicator}>
              {step.status === 'pending' && <View style={styles.stepDot} />}
              {step.status === 'running' && <ActivityIndicator color="#00ff9f" />}
              {step.status === 'complete' && (
                <Text style={styles.stepCheck}>✓</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, step.status === 'complete' && styles.stepComplete]}>
              {step.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Error Message */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}

      {/* Version Info */}
      <View style={styles.footer}>
        <Text style={styles.versionText}>AetherCore v0.1.0</Text>
        <Text style={styles.copyrightText}>© 2026 AetherCore Defense Systems</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  header: {
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#00ff9f',
    letterSpacing: 3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#7a7a7a',
    letterSpacing: 2,
  },
  deviceInfo: {
    alignItems: 'center',
    marginBottom: 40,
  },
  deviceLabel: {
    fontSize: 16,
    color: '#00d9ff',
    fontWeight: '600',
    marginBottom: 8,
  },
  deviceTag: {
    fontSize: 11,
    color: '#00ff9f',
    backgroundColor: '#00ff9f20',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  stepsContainer: {
    marginVertical: 40,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  stepIndicator: {
    width: 30,
    height: 30,
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  stepCheck: {
    fontSize: 20,
    color: '#00ff9f',
    fontWeight: 'bold',
  },
  stepLabel: {
    fontSize: 14,
    color: '#aaa',
    flex: 1,
  },
  stepComplete: {
    color: '#00ff9f',
  },
  errorContainer: {
    backgroundColor: '#ff4444',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 12,
  },
  footer: {
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 4,
  },
  copyrightText: {
    fontSize: 10,
    color: '#333',
  },
});

