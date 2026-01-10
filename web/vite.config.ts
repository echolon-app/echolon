import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import corePkg from '../core/package.json';
import pkg from './package.json';

const isLibBuild = process.env.BUILD_MODE === 'lib';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(corePkg.version),
    __ENV__:JSON.stringify(process.env.ENV),
    'process.env.WEB_MODE': JSON.stringify('true'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../core/renderer'),
      '@shared': path.resolve(__dirname, '../core/shared'),
    },
  },
  build: isLibBuild
    ? {
        // Library build for npm distribution
        outDir: 'dist',
        lib: {
          entry: path.resolve(__dirname, 'index.tsx'),
          name: 'EcholonWeb',
          fileName: (format) => `echolon-web.${format}.js`,
          formats: ['umd', 'es'],
        },
        rollupOptions: {
          output: {
            globals: {},
            assetFileNames: (assetInfo) => {
              if (assetInfo.name === 'style.css') return 'echolon-web.css';
              return assetInfo.name || 'asset';
            },
          },
        },
        cssCodeSplit: false,
        sourcemap: true,
      }
    : {
        // App build for web deployment
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
          output: {
            // Use stable filenames without hashes for public embedding
            entryFileNames: 'assets/index-latest.js',
            chunkFileNames: 'assets/[name]-latest.js',
            assetFileNames: (assetInfo) => {
              // Keep CSS with stable name
              if (assetInfo.name?.endsWith('.css')) {
                return 'assets/index-latest.css';
              }
              return 'assets/[name]-[hash][extname]';
            },
          },
        },
      },
});

