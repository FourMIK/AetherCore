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
import './index.css';

export const App: React.FC = () => {
  const theme = useTacticalStore((s) => s.theme);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // PRODUCTION: Connect to live C2 mesh on mount
  // In production, this establishes connection to the authenticated c2-router
  // endpoint with TLS 1.3 and hardware-rooted identity verification.
  useEffect(() => {
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
    }, 100);
  }, []);

  return (
    <MapProvider>
      <DashboardLayout />
    </MapProvider>
  );
};

export default App;
