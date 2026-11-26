import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOtherRightsFlexContents, getOtherRightsPending } from '../backend/endpointRights.js';

const fakePool = rows => {
    const calls = [];
    return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [rows]; } };
};

test('pending อปท./การรถไฟ: one row per right, zero when a right has none', async () => {
    const pool = fakePool([{ pttype: '16', cnt: 2, money: '1250.50' }]);
    assert.deepEqual(await getOtherRightsPending(pool, '2026-11-24', 'hosxp'), [
        { label: 'อปท.', count: 2, money: 1250.5 },
        { label: 'การรถไฟ', count: 0, money: 0 }
    ]);
    assert.deepEqual(pool.calls[0].params, ['2026-11-24', ['16', '43']]);
    assert.match(pool.calls[0].sql, /FROM vn_stat/);

    const tracker = fakePool([]);
    await getOtherRightsPending(tracker, '2026-11-24', 'tracker');
    assert.match(tracker.calls[0].sql, /FROM visit_tracking/);
});

test('flex section shows the total, count and amount per right', () => {
    const [header, lgo, railway] = buildOtherRightsFlexContents([
        { label: 'อปท.', count: 2, money: 1250 },
        { label: 'การรถไฟ', count: 1, money: 480 }
    ]);
    assert.deepEqual(header.contents.map(c => c.text), ['อปท./การรถไฟ ไม่ได้ปิดสิทธิ', '3']);
    assert.deepEqual(lgo.contents.map(c => c.text), [' - อปท.', '2', '1,250.00 บาท']);
    assert.deepEqual(railway.contents.map(c => c.text), [' - การรถไฟ', '1', '480.00 บาท']);
});

test('unreadable data is shown as missing, never as zero', () => {
    const [header, note] = buildOtherRightsFlexContents(null);
    assert.equal(header.contents[1].text, '-');
    assert.match(note.text, /ไม่มีข้อมูล/);
});
