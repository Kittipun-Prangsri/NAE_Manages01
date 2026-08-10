import { defineConfig } from 'vite';

export default defineConfig({
  root: './frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 5174,
    hmr: false,
    watch: {
      ignored: [
        '**/downloads/**',
        '**/screenshots/**',
        '**/puppeteer_session/**',
        '**/_logs/**',
        '**/.git/**',
        '**/.kob/**',
        '**/.agents/**',
        '**/.npm_cache/**',
        '**/*.png',
        '**/*.img',
        '**/*.pdf',
        '**/*.xlsx',
        '**/*.xls'
      ]
    },
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
