/**
 * Tactical Navigation
 * Main navigation structure with bottom tabs for tablet landscape
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import { MapIcon, AlertTriangleIcon, ActivityIcon, SettingsIcon } from 'lucide-react-native';
import { TacticalMapScreen } from '../screens/TacticalMapScreen';
import { TrustGuardianScreen } from '../screens/TrustGuardianScreen';
import { ByzantineAlertsScreen } from '../screens/ByzantineAlertsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

export function TacticalNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#00ff9f',
        tabBarInactiveTintColor: '#555',
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarIconStyle: styles.tabBarIcon,
      }}
    >
      <Tab.Screen
        name="Map"
        component={TacticalMapScreen}
        options={{
          tabBarLabel: 'Tactical Map',
          tabBarIcon: ({ color, size }) => (
            <MapIcon color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Trust"
        component={TrustGuardianScreen}
        options={{
          tabBarLabel: 'Trust Guardian',
          tabBarIcon: ({ color, size }) => (
            <ActivityIcon color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={ByzantineAlertsScreen}
        options={{
          tabBarLabel: 'Byzantine Alerts',
          tabBarIcon: ({ color, size }) => (
            <AlertTriangleIcon color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <SettingsIcon color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0a0e27',
    borderTopColor: '#1a1f3a',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 8,
    height: 70,
  },
  tabBarLabel: {
    fontSize: 11,
    marginTop: 4,
  },
  tabBarIcon: {
    marginBottom: 4,
  },
});

