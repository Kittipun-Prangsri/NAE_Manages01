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
      '/api.js': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/app.js': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ui.js': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/utils.js': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/style.css': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
});
