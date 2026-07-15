import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidDateString, isValidTimeString, normalizeChannels, normalizeReportTypes } from '../backend/validation.js';

test('isValidDateString accepts only YYYY-MM-DD dates', () => {
    assert.equal(isValidDateString('2026-07-13'), true);
    assert.equal(isValidDateString('13/07/2026'), false);
    assert.equal(isValidDateString('2026-02-31'), false);
    assert.equal(isValidDateString('not-a-date'), false);
});

test('isValidTimeString accepts HH:MM in 24 hour format', () => {
    assert.equal(isValidTimeString('08:30'), true);
    assert.equal(isValidTimeString('23:59'), true);
    assert.equal(isValidTimeString('24:00'), false);
});

test('normalizers keep only supported notification options', () => {
    assert.deepEqual(normalizeChannels(['line', 'email']), ['line']);
    assert.deepEqual(normalizeReportTypes(['summary', 'pdf']), ['summary']);
});
