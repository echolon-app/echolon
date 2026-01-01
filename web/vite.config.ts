import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isLibBuild = process.env.BUILD_MODE === 'lib';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../core/renderer'),
      '@shared': path.resolve(__dirname, '../core/shared'),
    },
  },
  define: {
    'process.env.WEB_MODE': JSON.stringify('true'),
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
      },
});

