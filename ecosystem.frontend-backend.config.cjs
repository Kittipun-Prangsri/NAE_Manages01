/**
 * PM2 configuration for the web application only.
 *
 * Starts the Vite frontend and Express backend, but deliberately omits the
 * worker process (cron schedules, Telegram polling, NHSO keep-alive, and
 * browser automation).
 */
module.exports = {
    apps: [
        {
            name: 'nae-frontend',
            script: './node_modules/vite/bin/vite.js',
            cwd: __dirname,
            interpreter: 'node',
            args: '--host 0.0.0.0 --port 5174',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 3000,
            max_memory_restart: '500M',
            time: true,
            env: {
                NODE_ENV: 'development'
            }
        },
        {
            name: 'nae-backend',
            script: 'backend/server.js',
            cwd: __dirname,
            interpreter: 'node',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 3000,
            max_memory_restart: '700M',
            time: true,
            env: {
                NODE_ENV: 'development',
                ENABLE_SERVER_BACKGROUND_JOBS: 'false',
                ENABLE_DASHBOARD_MODULES: 'false',
                ENABLE_SYNC_REPORTS: 'false'
            }
        }
    ]
};
