import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfigurationStatus } from '../backend/runtimeConfig.js';

test('configuration readiness requires a write account for sync-capable deployments', () => {
    const base = {
        JWT_SECRET: 'a-secure-jwt-secret-with-more-than-thirty-two-characters',
        HOSXP_HOST: 'db', HOSXP_USER: 'read', HOSXP_PASS: 'pass', HOSXP_DB: 'hos',
        TRACKER_HOST: 'db', TRACKER_USER: 'tracker', TRACKER_PASS: 'pass', TRACKER_DB: 'tracker'
    };
    assert.equal(getRuntimeConfigurationStatus(base).valid, true);
    assert.equal(Boolean(base.HOSXP_WRITE_USER && base.HOSXP_WRITE_PASS), false);
});
