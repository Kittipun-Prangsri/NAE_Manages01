import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function getKey(keyMaterial = process.env.NOTIFICATION_CREDENTIALS_KEY) {
    if (!keyMaterial || String(keyMaterial).length < 32) {
        throw new Error('NOTIFICATION_CREDENTIALS_KEY must be configured with at least 32 characters before saving notification tokens.');
    }
    return crypto.createHash('sha256').update(String(keyMaterial)).digest();
}

export function encryptNotificationToken(value, keyMaterial) {
    if (!value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(keyMaterial), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptNotificationToken(value, keyMaterial) {
    if (!value) return null;
    const serialized = String(value);
    // Existing installations may contain plaintext values. Keep them working
    // until an administrator saves the profile again, which encrypts the token.
    if (!serialized.startsWith(PREFIX)) return serialized;

    const [, , ivValue, authTagValue, ciphertextValue] = serialized.split(':');
    if (!ivValue || !authTagValue || !ciphertextValue) {
        throw new Error('Stored notification token has an invalid encrypted format.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(keyMaterial), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncryptedNotificationToken(value) {
    return Boolean(value && String(value).startsWith(PREFIX));
}
