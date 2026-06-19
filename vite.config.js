import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5175,
    proxy: {
      '/api/': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});

