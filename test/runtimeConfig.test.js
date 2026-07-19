import test from 'node:test';
import assert from 'node:assert/strict';
import { getJwtSecret, getRuntimeConfigurationStatus, isSecureJwtSecret } from '../backend/runtimeConfig.js';

const secureSecret = 'this-is-a-secure-jwt-secret-with-more-than-32-chars';

test('JWT configuration rejects defaults and requires a strong production secret', () => {
    assert.equal(isSecureJwtSecret('default_secret'), false);
    assert.equal(isSecureJwtSecret(secureSecret), true);
    assert.throws(() => getJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET must be configured/);
    assert.equal(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secureSecret }), secureSecret);
});

test('runtime configuration status contains only safe flags and actionable issues', () => {
    const status = getRuntimeConfigurationStatus({ NODE_ENV: 'production' });
    assert.equal(status.valid, false);
    assert.equal(status.syncWriteEnabled, false);
    assert.equal(status.notificationEncryptionEnabled, false);
    assert.equal(status.issues.length, 3);
});
