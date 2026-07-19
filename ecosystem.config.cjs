/**
 * PM2 production process definition.
 *
 * Keep exactly one worker: it owns cron schedules and Telegram long polling.
 * The web server has background jobs disabled to prevent duplicate work.
 */
module.exports = {
    apps: [
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
            env_production: {
                NODE_ENV: 'production',
                ENABLE_SERVER_BACKGROUND_JOBS: 'false'
            }
        },
        {
            name: 'nae-worker',
            script: 'jobs/worker.js',
            cwd: __dirname,
            interpreter: 'node',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            max_memory_restart: '700M',
            time: true,
            env_production: {
                NODE_ENV: 'production',
                ENABLE_SERVER_BACKGROUND_JOBS: 'false'
            }
        }
    ]
};
