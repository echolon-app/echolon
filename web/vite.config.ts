import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import corePkg from '../core/package.json';
import pkg from './package.json';

const isLibBuild = process.env.BUILD_MODE === 'lib';

// Plugin to inject process polyfill for browser builds
const processPolyfillPlugin = (): Plugin => {
  const processPolyfill = `var process = typeof process !== 'undefined' ? process : { env: { WEB_MODE: 'true', NODE_ENV: 'production' } };`;
  
  return {
    name: 'process-polyfill',
    renderChunk(code, chunk, options) {
      // Only inject for library builds (UMD and ES formats)
      if (options.format === 'umd' || options.format === 'es' || options.format === 'iife') {
        // Inject at the very beginning of entry chunks
        if (chunk.isEntry) {
          return `${processPolyfill}\n${code}`;
        }
      }
      return code;
    },
  };
};

export default defineConfig({
  server: {
    port: 5174,
  },
  define: {
    __APP_VERSION__: JSON.stringify(corePkg.version),
    __ENV__: JSON.stringify(process.env.ENV),
    // Replace process.env with a browser-safe object
    'process.env.WEB_MODE': JSON.stringify('true'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    react(),
    // Add process polyfill plugin for library builds
    ...(isLibBuild ? [processPolyfillPlugin()] : []),
  ],
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
            // Disable code splitting for ES modules - create a single file
            inlineDynamicImports: true,
            assetFileNames: (assetInfo) => {
              if (assetInfo.name === 'style.css') return 'echolon-web.css';
              return assetInfo.name || 'asset';
            },
          },
          // Define process for browser compatibility
          external: [],
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

