import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlerter, describeLineError } from '../backend/alerts.js';
import { checkHealthUrl, createHealthMonitor } from '../backend/healthMonitor.js';

test('one alert per kind per cooldown, then the held count', async () => {
    const sent = [];
    let clock = 0;
    const alert = createAlerter({ send: async text => sent.push(text), cooldownMs: 100, now: () => clock });

    await alert('a', 'first');
    await alert('a', 'first');
    await alert('a', 'first');
    await alert('b', 'other kind');
    clock = 150;
    await alert('a', 'later');

    assert.equal(sent.length, 3);
    assert.deepEqual(sent.slice(0, 2), ['first', 'other kind']);
    assert.match(sent[2], /^later\n.*2 ครั้ง/);
});

test('a failing alert channel never throws', async () => {
    const alert = createAlerter({ send: async () => { throw new Error('telegram down'); } });
    assert.equal(await alert('a', 'x'), false);
});

test('LINE errors are summarised with their details', () => {
    assert.equal(
        describeLineError(400, { message: 'Invalid message', details: [{ property: 'messages[0]', message: 'bad flex' }] }),
        'HTTP 400 Invalid message\nmessages[0]: bad flex'
    );
});

test('monitor ignores a single failure, alerts on repeats and reports recovery', async () => {
    const results = [false, true, false, false, false, true, true];
    const sent = [];
    const tick = createHealthMonitor({
        check: async () => ({ ok: results.shift(), detail: 'HTTP 503' }),
        notify: async text => sent.push(text)
    });
    for (let i = 0; i < 7; i += 1) await tick();

    assert.equal(sent.length, 2);
    assert.match(sent[0], /มีปัญหา.*2 ครั้ง[\s\S]*HTTP 503/);
    assert.match(sent[1], /กลับมาใช้งานได้/);
});

test('health check names what is down without leaking database error text', async () => {
    const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

    assert.deepEqual(await checkHealthUrl('u', reply(200, { success: true })), { ok: true, detail: '' });
    const down = await checkHealthUrl('u', reply(503, {
        success: false, database: { tracker: true, hosxp: false }, hosxpError: 'connect ECONNREFUSED 10.0.0.1'
    }));
    assert.deepEqual(down, { ok: false, detail: 'HTTP 503 — ฐานข้อมูลต่อไม่ได้: hosxp' });
    const unreachable = await checkHealthUrl('u', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
    assert.match(unreachable.detail, /ECONNREFUSED/);
});
