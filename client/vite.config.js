import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Code-split heavy deps to keep initial bundle ≤ 250 KB gzip (SRS NFR-perf)
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          zxcvbn: ['@zxcvbn-ts/core', '@zxcvbn-ts/language-common', '@zxcvbn-ts/language-en'],
          recharts: ['recharts'],
          qrcode: ['qrcode.react'],
          papaparse: ['papaparse'],
          webauthn: ['@simplewebauthn/browser'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
