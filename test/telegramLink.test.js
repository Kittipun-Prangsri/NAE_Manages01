import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStartCode } from '../backend/telegramLink.js';

test('reads the one-time link code from the bot /start message', () => {
    assert.equal(parseStartCode('/start 3f9a1c2b4d5e6f708192a3b4'), '3f9a1c2b4d5e6f708192a3b4');
    assert.equal(parseStartCode('/start'), null);
    assert.equal(parseStartCode('/start x'), null);
    assert.equal(parseStartCode('/start abc; DROP TABLE users'), null);
    assert.equal(parseStartCode('endpoint บันทึก'), null);
});
