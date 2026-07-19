import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalDashboardUrl } from '../jobs/captureConfig.js';

test('capture uses the Vite development port by default', () => {
    assert.equal(getLocalDashboardUrl({}), 'http://localhost:5174');
    assert.equal(getLocalDashboardUrl({ LOCAL_DASHBOARD_URL: 'http://192.168.1.20:5174' }), 'http://192.168.1.20:5174');
});

test('capture uses the local backend in production', () => {
    assert.equal(getLocalDashboardUrl({ NODE_ENV: 'production', PORT: '3005' }), 'http://127.0.0.1:3005');
});
