import crypto from 'crypto';

let developmentJwtSecret = null;

export function isSecureJwtSecret(value) {
    const secret = String(value || '');
    return secret.length >= 32
        && !['default_secret', 'your_super_secret_key_change_me'].includes(secret);
}

export function getJwtSecret(env = process.env) {
    if (isSecureJwtSecret(env.JWT_SECRET)) return env.JWT_SECRET;
    if (env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be configured with at least 32 non-default characters in production.');
    }
    if (!developmentJwtSecret) {
        developmentJwtSecret = crypto.randomBytes(48).toString('base64url');
        console.warn('⚠️ JWT_SECRET is not configured. Using an ephemeral development-only secret; all sessions reset when the server restarts.');
    }
    return developmentJwtSecret;
}

export function getRuntimeConfigurationStatus(env = process.env) {
    const issues = [];
    if (!isSecureJwtSecret(env.JWT_SECRET)) issues.push('JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษรและห้ามใช้ค่า default');
    if (!env.HOSXP_HOST || !env.HOSXP_USER || !env.HOSXP_PASS || !env.HOSXP_DB) issues.push('การเชื่อมต่อ HOSxP read-only ยังตั้งค่าไม่ครบ');
    if (!env.TRACKER_HOST || !env.TRACKER_USER || !env.TRACKER_PASS || !env.TRACKER_DB) issues.push('การเชื่อมต่อ Tracker DB ยังตั้งค่าไม่ครบ');
    return {
        valid: issues.length === 0,
        syncWriteEnabled: Boolean(env.HOSXP_WRITE_USER && env.HOSXP_WRITE_PASS),
        notificationEncryptionEnabled: Boolean(env.NOTIFICATION_CREDENTIALS_KEY && String(env.NOTIFICATION_CREDENTIALS_KEY).length >= 32),
        issues
    };
}
