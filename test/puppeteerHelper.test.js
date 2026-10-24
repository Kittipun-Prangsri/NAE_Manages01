import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEnoughMemoryForBrowser, getMinFreeMemoryMb } from '../backend/puppeteerHelper.js';

const MB = 1024 * 1024;

test('browser launch is refused when available memory is below the minimum', () => {
    assert.doesNotThrow(() => assertEnoughMemoryForBrowser(2048 * MB, 1024));
    assert.throws(() => assertEnoughMemoryForBrowser(512 * MB, 1024), /512 MB/);
});

test('minimum free memory defaults to 1024 MB and accepts a valid override', () => {
    assert.equal(getMinFreeMemoryMb(undefined), 1024);
    assert.equal(getMinFreeMemoryMb('1500'), 1500);
    assert.equal(getMinFreeMemoryMb('0'), 0);
    assert.equal(getMinFreeMemoryMb('abc'), 1024);
});
