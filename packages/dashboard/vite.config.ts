import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createRequire } from 'node:module';
import cesium from 'vite-plugin-cesium';

const require = createRequire(import.meta.url);
const cesiumPackagePath = require.resolve('cesium/package.json');
const cesiumRoot = path.resolve(path.dirname(cesiumPackagePath), 'Build');

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
      '@aethercore/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
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
        },
      },
    },
  },
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei'],
  },
});
