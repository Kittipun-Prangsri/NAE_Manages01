import { defineConfig } from 'vite';

export default defineConfig({
  root: './frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api/': {
        target: 'http://127.0.0.1:3005',
        changeOrigin: true,
      },
      '/screenshots/': {
        target: 'http://127.0.0.1:3005',
        changeOrigin: true,
      },
    },
  },
});
