module.exports = {
  apps: [
    {
      name: 'nae-manage-server',
      script: './server.js',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3005,
        DISABLE_BACKGROUND_JOBS: 'true'
      }
    },
    {
      name: 'nae-manage-worker',
      script: './jobs/worker.js',
      watch: false,
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'nae-manage-frontend',
      script: 'node_modules/vite/bin/vite.js',
      watch: false,
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};
