/**
 * App.tsx
 * Main application entry point for AetherCore Tactical Glass
 */

import React, { useEffect } from 'react';
import { MapProvider } from './map-engine/MapContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { useTacticalStore } from './store/useTacticalStore';
import './index.css';

export const App: React.FC = () => {
  const theme = useTacticalStore((s) => s.theme);
  const connectToTestnet = useTacticalStore((s) => s.connectToTestnet);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Connect to testnet on mount
  useEffect(() => {
    connectToTestnet().catch((err) => {
      console.error('Failed to connect to testnet:', err);
    });
  }, [connectToTestnet]);

  return (
    <MapProvider>
      <DashboardLayout />
    </MapProvider>
  );
};

export default App;
