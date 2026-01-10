import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { builtinModules } from 'module';
import pkg from './package.json';

console.log('ENV', process.env.ENV);

// Generate build timestamp in local time (format: YYYY-MM-DD HH:mm:ss)
const now = new Date();
const buildTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
console.log('BUILD_TIMESTAMP', buildTimestamp);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __ENV__: JSON.stringify(process.env.ENV),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'main/index.ts',
        onstart({ startup }) {
          startup();
        },
        vite: {
          build: {
            outDir: 'dist/main',
            sourcemap: 'inline',
            minify: false,
            rollupOptions: {
              external: [
                'electron',
                'electron-updater',
                ...builtinModules,
                ...builtinModules.map(m => `node:${m}`),
              ],
            },
          },
        },
      },
      {
        entry: 'main/preload.ts',
        onstart({ reload }) {
          // Only reload renderer, don't start new Electron instance
          reload();
        },
        vite: {
          build: {
            outDir: 'dist/preload',
            sourcemap: 'inline',
            minify: false,
            rollupOptions: {
              external: [
                'electron',
                ...builtinModules,
                ...builtinModules.map(m => `node:${m}`),
              ],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  root: '.',
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
