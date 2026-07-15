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
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      '/screenshots/': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      // style.css is served directly by Vite (no proxy needed)
    },
  },
});

