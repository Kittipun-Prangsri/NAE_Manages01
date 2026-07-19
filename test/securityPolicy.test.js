import test from 'node:test';
import assert from 'node:assert/strict';
import { applySecurityHeaders, isPublicScreenshotAccessEnabled } from '../backend/securityPolicy.js';

test('screenshots are private unless explicitly enabled', () => {
    assert.equal(isPublicScreenshotAccessEnabled(undefined), false);
    assert.equal(isPublicScreenshotAccessEnabled('false'), false);
    assert.equal(isPublicScreenshotAccessEnabled('true'), true);
});

test('security headers are applied without enabling browser permissions', () => {
    const headers = new Map();
    let continued = false;
    applySecurityHeaders({}, { setHeader(key, value) { headers.set(key, value); } }, () => { continued = true; });
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
    assert.equal(continued, true);
});
