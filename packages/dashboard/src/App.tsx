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
  const connectToMesh = useTacticalStore((s) => s.connectToMesh);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // PRODUCTION: Connect to live C2 mesh on mount
  // In production, this establishes connection to the authenticated c2-router
  // endpoint with TLS 1.3 and hardware-rooted identity verification.
  useEffect(() => {
    connectToMesh().catch((err) => {
      console.error('Failed to connect to C2 mesh:', err);
    });
  }, [connectToMesh]);

  return (
    <MapProvider>
      <DashboardLayout />
    </MapProvider>
  );
};

export default App;
