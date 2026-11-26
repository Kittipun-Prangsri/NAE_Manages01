import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { captureRawBody, checkLineSignature, isValidLineSignature } from '../backend/lineSignature.js';
import { GET, POST } from '../api/line/webhook.js';

const SECRET = 'test-channel-secret';
const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('base64');

function useEnv(t, values) {
    for (const [name, value] of Object.entries(values)) {
        const previous = process.env[name];
        process.env[name] = value;
        t.after(() => {
            if (previous === undefined) delete process.env[name];
            else process.env[name] = previous;
        });
    }
}

const webhookRequest = (body, signature) => new Request('https://example.test/api/line/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-line-signature': signature } : {}) },
    body
});

// A command that replies without reading any database.
const HELP_EVENT = JSON.stringify({
    events: [{ type: 'message', replyToken: 'reply-token', source: { userId: 'U1' }, message: { type: 'text', text: 'help' } }]
});

test('a signature is valid only for the exact bytes and the channel secret', () => {
    const body = Buffer.from('{"events":[],"note":"ทดสอบ"}');
    assert.equal(isValidLineSignature(body, sign(body), SECRET), true);
    assert.equal(isValidLineSignature(Buffer.from(`${body} `), sign(body), SECRET), false);
    assert.equal(isValidLineSignature(body, sign(body, 'another-secret'), SECRET), false);
    for (const signature of [undefined, '', 'not-a-signature', sign(body).slice(0, 20)]) {
        assert.equal(isValidLineSignature(body, signature, SECRET), false, String(signature));
    }
    assert.equal(isValidLineSignature(undefined, sign(body), SECRET), false);
});

test('without a channel secret every request is refused', () => {
    const body = Buffer.from('{}');
    assert.equal(checkLineSignature(body, sign(body, ''), '').status, 503);
    assert.equal(checkLineSignature(body, 'wrong', SECRET).status, 401);
    assert.deepEqual(checkLineSignature(body, sign(body), SECRET), { ok: true });
});

test('express keeps the raw bytes, so the signature verifies after JSON parsing', async t => {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.post('/hook', (req, res) => res.json(checkLineSignature(req.rawBody, req.get('x-line-signature'), SECRET)));
    const server = app.listen(0);
    t.after(() => server.close());
    await new Promise(resolve => server.once('listening', resolve));

    // Unusual spacing would be lost if the body were re-serialized.
    const body = '{ "events" : [ ] , "note": "ทดสอบ" }';
    const send = async signature => (await fetch(`http://127.0.0.1:${server.address().port}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-line-signature': signature },
        body
    })).json();

    assert.equal((await send(sign(body))).ok, true);
    assert.equal((await send(sign(JSON.stringify(JSON.parse(body))))).ok, false);
});

test('the Vercel webhook ignores unsigned and forged requests', async t => {
    useEnv(t, { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token' });
    const outbound = t.mock.method(globalThis, 'fetch', async () => Response.json({}));

    for (const signature of [null, sign(HELP_EVENT, 'another-secret'), sign('{}')]) {
        const response = await POST(webhookRequest(HELP_EVENT, signature));
        assert.equal(response.status, 401);
    }
    assert.equal(outbound.mock.callCount(), 0);
});

test('the Vercel webhook is closed until the channel secret is configured', async t => {
    useEnv(t, { LINE_CHANNEL_SECRET: '', LINE_CHANNEL_ACCESS_TOKEN: 'test-token' });
    const outbound = t.mock.method(globalThis, 'fetch', async () => Response.json({}));

    const response = await POST(webhookRequest(HELP_EVENT, sign(HELP_EVENT)));

    assert.equal(response.status, 503);
    assert.equal(outbound.mock.callCount(), 0);
});

test('the Vercel webhook answers a signed command before responding', async t => {
    useEnv(t, { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token' });
    const outbound = t.mock.method(globalThis, 'fetch', async () => Response.json({}));

    const response = await POST(webhookRequest(HELP_EVENT, sign(HELP_EVENT)));

    assert.equal(response.status, 200);
    assert.equal(outbound.mock.callCount(), 1);
    const [url, options] = outbound.mock.calls[0].arguments;
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    assert.equal(JSON.parse(options.body).replyToken, 'reply-token');
});

test('the Vercel webhook accepts the signed empty check from the LINE console', async t => {
    useEnv(t, { LINE_CHANNEL_SECRET: SECRET });
    const body = '{"destination":"U0","events":[]}';

    assert.equal((await POST(webhookRequest(body, sign(body)))).status, 200);
    assert.equal(GET().status, 200);
});
