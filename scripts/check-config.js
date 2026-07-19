import dotenv from 'dotenv';
import { getRuntimeConfigurationStatus } from '../backend/runtimeConfig.js';
import { getAllowedCorsOrigins } from '../backend/securityConfig.js';
import { getHosxpWritePool, hosxpPool, trackerPool } from '../backend/db.js';

dotenv.config();

const shouldCheckDatabases = process.argv.includes('--check-db');
const isProduction = process.env.NODE_ENV === 'production';
const status = getRuntimeConfigurationStatus();
const errors = [...status.issues];
const warnings = [];
const writePool = status.syncWriteEnabled ? getHosxpWritePool() : null;

function formatDatabaseCheckError(label, error) {
    if (error?.code === 'EPERM') {
        return `${label}: network connection was blocked by this runtime (${error.message}). Run this check from the application host or permit outbound TCP to the database.`;
    }
    if (error?.code === 'ECONNREFUSED') {
        return `${label}: connection was refused (${error.message}). Check host, port, database service, and firewall rules.`;
    }
    if (error?.code === 'ETIMEDOUT') {
        return `${label}: connection timed out (${error.message}). Check network routing and firewall rules.`;
    }
    return `${label}: ${error.message}`;
}

if (!status.syncWriteEnabled) errors.push('HOSxP write account ยังตั้งค่าไม่ครบ; ฟีเจอร์ Sync จะใช้งานไม่ได้');
if (!status.notificationEncryptionEnabled) warnings.push('NOTIFICATION_CREDENTIALS_KEY ยังไม่พร้อม; จะไม่สามารถบันทึก token แจ้งเตือนใหม่แบบเข้ารหัสได้');
if (isProduction && getAllowedCorsOrigins().length === 0) warnings.push('CORS_ORIGINS ยังว่างอยู่; ระบบจะรับเฉพาะ same-origin');

if (shouldCheckDatabases && errors.length === 0) {
    const checks = [
        ['Tracker DB', trackerPool],
        ['HOSxP read-only DB', hosxpPool],
        ['HOSxP write DB', writePool]
    ];
    for (const [label, pool] of checks) {
        try {
            await pool.query('SELECT 1');
            console.log(`✅ ${label}: connected`);
        } catch (error) {
            errors.push(formatDatabaseCheckError(label, error));
        }
    }
}

if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(error => console.error(`   - ${error}`));
}
if (warnings.length > 0) {
    console.warn('⚠️ Configuration warnings:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
}
if (errors.length === 0) {
    console.log(`✅ Configuration is ready for ${isProduction ? 'production' : 'development'}.`);
}

await Promise.allSettled([hosxpPool.end(), trackerPool.end()]);
if (writePool) await writePool.end();
process.exitCode = errors.length > 0 ? 1 : 0;
