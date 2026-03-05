/**
 * Trust Score Indicator
 * Visual representation of node trust level
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TrustScoreIndicatorProps {
  score: number;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

export function TrustScoreIndicator({
  score,
  size = 'medium',
  showLabel = false,
}: TrustScoreIndicatorProps) {
  const getColor = (score: number) => {
    if (score >= 0.9) return '#00ff9f';
    if (score >= 0.6) return '#ffaa00';
    return '#ff4444';
  };

  const getLabel = (score: number) => {
    if (score >= 0.9) return 'HEALTHY';
    if (score >= 0.6) return 'SUSPECT';
    return 'QUARANTINED';
  };

  const color = getColor(score);
  const label = getLabel(score);

  const sizeStyles = {
    small: { width: 24, height: 24, fontSize: 10 },
    medium: { width: 40, height: 40, fontSize: 12 },
    large: { width: 60, height: 60, fontSize: 14 },
  };

  const style = sizeStyles[size];

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.circle,
          {
            width: style.width,
            height: style.height,
            borderColor: color,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              fontSize: style.fontSize,
              color,
            },
          ]}
        >
          {(score * 100).toFixed(0)}
        </Text>
      </View>
      {showLabel && (
        <Text style={[styles.label, { color }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  circle: {
    borderWidth: 2,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1f3a',
  },
  text: {
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 8,
    letterSpacing: 1,
  },
});

