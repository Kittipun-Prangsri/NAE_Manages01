// แก้ไขไฟล์ vite.config.js
export default defineConfig({
  // ...
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api/': {
        target: 'http://127.0.0.1:3005', // เปลี่ยนจาก localhost เป็น 127.0.0.1
        changeOrigin: true,
      },
      '/screenshots/': {
        target: 'http://127.0.0.1:3005', // เปลี่ยนจาก localhost เป็น 127.0.0.1
        changeOrigin: true,
      },
    },
  },
});
