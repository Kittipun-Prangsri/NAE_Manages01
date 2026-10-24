import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQueryDate, parseInputDate } from '../backend/dateInput.js';

test('parses AD, Thai BE and ISO dates', () => {
    assert.equal(parseInputDate('23/10/2569'), '2026-10-23');
    assert.equal(parseInputDate('23.10.2026'), '2026-10-23');
    assert.equal(parseInputDate('2026-10-23'), '2026-10-23');
    assert.equal(parseInputDate('1/2/2569'), '2026-02-01');
    assert.equal(parseInputDate('not a date'), null);
});

test('extracts the date from a chat command or defaults to today in Bangkok', () => {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    assert.equal(extractQueryDate('ดึงข้อมูล 23/10/2569'), '2026-10-23');
    assert.equal(extractQueryDate('/sync 2026-10-23'), '2026-10-23');
    assert.equal(extractQueryDate('ดึงข้อมูล'), today);
});
