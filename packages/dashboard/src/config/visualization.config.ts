/**
 * Visualization Configuration
 * Central config for map rendering, Cesium Ion, and visual settings
 */

export const visualizationConfig = {
  // Cesium Ion Configuration
  cesium: {
    // IMPORTANT: Replace with actual token from environment
    // DO NOT commit actual token to repository
    ionToken: process.env.CESIUM_ION_TOKEN || 'YOUR_CESIUM_ION_TOKEN_HERE',
    terrainProvider: 'Cesium World Terrain',
    imageryProvider: 'Bing Maps Aerial',
  },

  // Map View Settings
  map: {
    defaultCenter: {
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: 10000,
    },
    defaultZoom: 10,
    minZoom: 1,
    maxZoom: 20,
  },

  // Three.js Scene Settings
  three: {
    camera: {
      fov: 75,
      near: 0.1,
      far: 10000,
      position: [50, 100, 50],
    },
    grid: {
      size: 200,
      divisions: 20,
      color: '#00D4FF',
    },
    lighting: {
      ambient: 0.3,
      directional: 1.0,
      point: 0.5,
    },
  },

  // Node Visualization
  nodes: {
    size: 2,
    segments: 16,
    trustColors: {
      high: '#39FF14', // >= 80
      medium: '#FFAE00', // >= 50
      low: '#FF2A2A', // < 50
    },
    emissiveIntensity: {
      verified: 0.5,
      unverified: 0.2,
    },
  },

  // Animation Settings
  animations: {
    sweep: {
      duration: 3000, // ms
      circles: 3,
      delay: 0.3, // between circles
    },
    purge: {
      duration: 2000, // ms
    },
    fadeIn: {
      duration: 300, // ms
    },
  },

  // Trust Score Thresholds
  trust: {
    high: 80,
    medium: 50,
    low: 0,
  },
};

export default visualizationConfig;
