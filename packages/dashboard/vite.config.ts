import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import cesium from 'vite-plugin-cesium';

const cesiumRoot = path.resolve(__dirname, '../../node_modules/cesium/Build');

export default defineConfig({
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath: cesiumRoot,
      cesiumBuildPath: path.join(cesiumRoot, 'Cesium'),
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          cesium: ['cesium'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei'],
  },
});
