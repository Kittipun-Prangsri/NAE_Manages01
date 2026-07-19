export function getLocalDashboardUrl(env = process.env) {
    const port = env.PORT || 3000;
    const isProduction = env.NODE_ENV === 'production' || typeof env.pm_id !== 'undefined';
    if (isProduction) return `http://127.0.0.1:${port}`;
    // Keep this in sync with vite.config.js.
    return env.LOCAL_DASHBOARD_URL || 'http://localhost:5174';
}
