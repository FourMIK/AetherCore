/**
 * App.tsx
 * Main application entry point for AetherCore Tactical Glass
 */

import React, { useEffect } from 'react';
import { MapProvider } from './map-engine/MapContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { useTacticalStore } from './store/useTacticalStore';
import { initializeComms } from './store/initComms';
import { initDummyData } from './store/initDummyData';
import { getWebSocketManager } from './services/api/WebSocketManager';
import { getRuntimeConfig } from './config/runtime';
import {
  BootstrapOnboarding,
  shouldRunBootstrapOnboarding,
} from './components/onboarding/BootstrapOnboarding';
import './index.css';

export const App: React.FC = () => {
  const theme = useTacticalStore((s) => s.theme);
  const [bootstrapReady, setBootstrapReady] = React.useState(false);
  const [bootstrapCheckComplete, setBootstrapCheckComplete] = React.useState(false);

  useEffect(() => {
    let mounted = true;
    shouldRunBootstrapOnboarding().then((shouldRun) => {
      if (!mounted) {
        return;
      }
      setBootstrapReady(!shouldRun);
      setBootstrapCheckComplete(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // PRODUCTION: Connect to live C2 mesh on mount
  // In production, this establishes connection to the authenticated c2-router
  // endpoint with TLS 1.3 and hardware-rooted identity verification.
  useEffect(() => {
    if (!bootstrapCheckComplete || !bootstrapReady) {
      return;
    }

    // Add a small delay to ensure store is hydrated
    setTimeout(() => {
      // Initialize communications
      initializeComms();
      
      // Initialize dummy data for demos/screenshots
      try {
        initDummyData();
      } catch (err) {
        console.error('Failed to initialize dummy data:', err);
      }

      // Initialize Aetheric Link (signed heartbeat protocol)
      // In production, use wss:// endpoint from environment or config
      const { wsUrl } = getRuntimeConfig();
      const gatewayUrl = wsUrl;
      try {
        const wsManager = getWebSocketManager(gatewayUrl);
        // SignalR connect is async, but we don't need to await here
        // Connection will establish in background
        wsManager.connect().catch(err => {
          console.error('[AETHERIC LINK] Connection failed:', err);
        });
        console.log('[AETHERIC LINK] WebSocket manager initialized');
      } catch (err) {
        console.error('[AETHERIC LINK] Failed to initialize WebSocket manager:', err);
      }
    }, 100);

    // Cleanup on unmount
    return () => {
      try {
        const wsManager = getWebSocketManager();
        wsManager.disconnect();
      } catch (err) {
        // Ignore errors during cleanup
      }
    };
  }, [bootstrapReady]);

  if (!bootstrapCheckComplete) {
    return null;
  }

  if (!bootstrapReady) {
    return <BootstrapOnboarding onReady={() => setBootstrapReady(true)} />;
  }

  return (
    <MapProvider>
      <DashboardLayout />
    </MapProvider>
  );
};

export default App;
