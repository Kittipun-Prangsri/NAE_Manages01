/**
 * PM2 production process definition.
 *
 * Keep exactly one worker: it owns cron schedules and Telegram long polling.
 * The web server has background jobs disabled to prevent duplicate work.
 */
module.exports = {
    apps: [
        {
            // Vite serves the frontend and proxies /api and /screenshots to
            // nae-server (see vite.config.js).  Keep this as a separate PM2
            // process so a frontend restart cannot interrupt API or worker jobs.
            name: 'nae-frontend',
            script: './node_modules/vite/bin/vite.js',
            args: 'preview --host 0.0.0.0 --port 5174',
            cwd: __dirname,
            interpreter: 'node',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            max_memory_restart: '400M',
            time: true,
            env: {
                PORT: 5174,
                NODE_ENV: 'development'
            },
            env_production: {
                PORT: 5174,
                NODE_ENV: 'development'
            }
        },
        {
            name: 'nae-server',
            script: 'backend/server.js',
            cwd: __dirname,
            interpreter: 'node',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            max_memory_restart: '700M',
            time: true,
            env: {
                PORT: 3005,
                NODE_ENV: 'development',
                ENABLE_SERVER_BACKGROUND_JOBS: 'false'
            },
            env_production: {
                PORT: 3005,
                NODE_ENV: 'production',
                ENABLE_SERVER_BACKGROUND_JOBS: 'false'
            }
        }
    ]
};

