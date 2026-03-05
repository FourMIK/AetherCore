/**
 * Bootstrap Store
 * Manages initialization state for the tablet app
 */

import { create } from 'zustand';
import { initializeMockData } from '../services/mockDataService';
import { initializeIdentity } from '../services/identityService';

interface BootstrapState {
  isBootstrapped: boolean;
  isInitializing: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  reset: () => void;
}

export const useBootstrapStore = create<BootstrapState>((set) => ({
  isBootstrapped: false,
  isInitializing: true,
  error: null,

  initialize: async () => {
    set({ isInitializing: true, error: null });
    try {
      // Initialize identity (device fingerprint)
      await initializeIdentity();

      // Initialize mock data engine
      await initializeMockData();

      set({ isBootstrapped: true, isInitializing: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Bootstrap failed:', errorMessage);
      set({
        isBootstrapped: false,
        isInitializing: false,
        error: errorMessage,
      });
    }
  },

  reset: () => {
    set({ isBootstrapped: false, isInitializing: false, error: null });
  },
}));

