import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorsOptions, getAllowedCorsOrigins, getExcelUploadLimitBytes } from '../backend/securityConfig.js';

test('upload limit accepts only safe byte ranges', () => {
    assert.equal(getExcelUploadLimitBytes('5242880'), 5242880);
    assert.equal(getExcelUploadLimitBytes('1024'), 20 * 1024 * 1024);
    assert.equal(getExcelUploadLimitBytes('999999999'), 20 * 1024 * 1024);
});

test('production CORS accepts only configured origins while development remains open', async () => {
    assert.deepEqual(getAllowedCorsOrigins('https://app.example, https://admin.example '), ['https://app.example', 'https://admin.example']);
    assert.equal(createCorsOptions({ nodeEnv: 'development' }).origin, true);

    const production = createCorsOptions({ nodeEnv: 'production', corsOrigins: 'https://app.example' });
    await new Promise((resolve, reject) => production.origin('https://app.example', error => error ? reject(error) : resolve()));
    await assert.rejects(
        () => new Promise((resolve, reject) => production.origin('https://other.example', error => error ? reject(error) : resolve())),
        { code: 'CORS_ORIGIN_DENIED' }
    );
});
