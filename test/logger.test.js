import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createLoggerOptions } from '../backend/logger.js';

function capture() {
    const lines = [];
    const logger = pino(createLoggerOptions('info'), { write: line => lines.push(JSON.parse(line)) });
    return { logger, lines };
}

test('an error or object after the message is kept', () => {
    const { logger, lines } = capture();
    logger.error('failed:', new Error('boom'));
    logger.error('LINE said:', { message: 'Invalid reply token' });
    logger.warn('why:', 'no reason');

    assert.equal(lines[0].msg, 'failed:');
    assert.equal(lines[0].err.message, 'boom');
    assert.match(lines[0].err.stack, /boom/);
    assert.deepEqual(lines[1].detail, { message: 'Invalid reply token' });
    assert.equal(lines[2].detail, 'no reason');
});

test('the usual pino forms behave as before', () => {
    const { logger, lines } = capture();
    logger.info('plain');
    logger.info({ count: 2 }, 'with context');
    logger.info('value %s', 'x');
    logger.warn({ err: 'just text' }, 'string err');

    assert.deepEqual(lines.map(line => line.msg), ['plain', 'with context', 'value x', 'string err']);
    assert.equal(lines[1].count, 2);
    assert.equal(lines[3].err, 'just text');
});

test('statements, tokens, one-time codes and ID numbers are not written', () => {
    const { logger, lines } = capture();
    const error = Object.assign(new Error("Duplicate entry '1234567890123' at https://x.test/cb?code=abc123&a=1"), {
        sql: "SELECT * FROM patient WHERE cid = '1234567890123'",
        sqlMessage: "Duplicate entry '1234567890123'"
    });
    logger.error('query failed:', error);
    logger.error({ err: error }, 'same error as context');
    logger.warn('request:', { url: 'https://api.telegram.org/bot123456:AAbb-cc_dd/sendMessage', vn: '691124085344' });

    const written = JSON.stringify(lines);
    for (const secret of ['1234567890123', 'abc123', 'AAbb-cc_dd', 'FROM patient']) {
        assert.equal(written.includes(secret), false, secret);
    }
    // A 12-digit VN is needed to find the case.
    assert.match(written, /691124085344/);
});
