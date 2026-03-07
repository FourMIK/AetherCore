/**
 * AetherCore Tactical Tablet App
 * Main Application Entry Point
 *
 * Standalone tablet application that demonstrates AetherCore's
 * trust assessment and Byzantine fault detection capabilities
 * without requiring ATAK-Civ installation.
 */

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useBootstrapStore } from './src/store/useBootstrapStore';
import { TacticalNavigator } from './src/navigation/TacticalNavigator';
import { BootstrapScreen } from './src/screens/BootstrapScreen';

// Keep splash screen visible while we initialize
SplashScreen.preventAutoHideAsync();

const RootStack = createNativeStackNavigator();

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const { isBootstrapped, initialize } = useBootstrapStore();

  useEffect(() => {
    async function prepare() {
      try {
        // Initialize bootstrap state
        await initialize();
        // Small delay for visual transition
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn('Bootstrap initialization error:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  useEffect(() => {
    if (appIsReady) {
      SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  if (!appIsReady) {
    return null;
  }

  return (
    <>
      <StatusBar style="light" hidden />
      <NavigationContainer>
        <RootStack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'none',
          }}
        >
          {!isBootstrapped ? (
            <RootStack.Screen
              name="Bootstrap"
              component={BootstrapScreen}
            />
          ) : (
            <RootStack.Screen
              name="Tactical"
              component={TacticalNavigator}
            />
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    </>
  );
}

