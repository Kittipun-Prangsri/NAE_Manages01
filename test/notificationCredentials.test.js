import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptNotificationToken, encryptNotificationToken, isEncryptedNotificationToken } from '../backend/notificationCredentials.js';

const testKey = 'a-test-only-notification-key-that-is-long-enough';

test('notification tokens are encrypted and decrypted without exposing plaintext', () => {
    const token = 'sensitive-token-value';
    const encrypted = encryptNotificationToken(token, testKey);

    assert.notEqual(encrypted, token);
    assert.equal(isEncryptedNotificationToken(encrypted), true);
    assert.equal(decryptNotificationToken(encrypted, testKey), token);
});

test('legacy plaintext tokens remain readable during migration', () => {
    assert.equal(decryptNotificationToken('legacy-token', testKey), 'legacy-token');
});
