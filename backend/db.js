import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Pool for HOSxP reads. Configure this account with SELECT-only privileges.
export const hosxpPool = mysql.createPool({
    host: process.env.HOSXP_HOST,
    user: process.env.HOSXP_USER,
    password: process.env.HOSXP_PASS,
    database: process.env.HOSXP_DB,
    port: process.env.HOSXP_PORT || 3306,
    charset: 'tis620',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 5000,
    maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
});

// HOSxP writes are intentionally isolated from the read pool.  Sync actions
// must be configured explicitly instead of silently reusing the read account.
const hasHosxpWriteCredentials = Boolean(
    process.env.HOSXP_WRITE_USER && process.env.HOSXP_WRITE_PASS
);

export const hosxpWritePool = hasHosxpWriteCredentials
    ? mysql.createPool({
        host: process.env.HOSXP_WRITE_HOST || process.env.HOSXP_HOST,
        user: process.env.HOSXP_WRITE_USER,
        password: process.env.HOSXP_WRITE_PASS,
        database: process.env.HOSXP_WRITE_DB || process.env.HOSXP_DB,
        port: process.env.HOSXP_WRITE_PORT || process.env.HOSXP_PORT || 3306,
        charset: 'tis620',
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        // The sync procedure deliberately executes an atomic batch of SQL.
        multipleStatements: true,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 5000,
        maxIdle: 5,
        idleTimeout: 60000
    })
    : null;

export function getHosxpWritePool() {
    if (!hosxpWritePool) {
        throw new Error('HOSxP write access is not configured. Set HOSXP_WRITE_USER and HOSXP_WRITE_PASS for sync operations.');
    }
    return hosxpWritePool;
}

// Pool for Internal Tracking DB
export const trackerPool = mysql.createPool({
    host: process.env.TRACKER_HOST,
    user: process.env.TRACKER_USER,
    password: process.env.TRACKER_PASS,
    database: process.env.TRACKER_DB,
    port: process.env.TRACKER_PORT || 3306,
    charset: process.env.TRACKER_CHARSET || 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 5000,
    maxIdle: 10,
    idleTimeout: 60000
});

// Helper to check connections
export async function checkConnections() {
    try {
        const hosxpConn = await hosxpPool.getConnection();
        console.log('✅ Connected to HOSxP Database');
        hosxpConn.release();

        const trackerConn = await trackerPool.getConnection();
        console.log('✅ Connected to Internal Tracker Database');
        trackerConn.release();

        if (!hosxpWritePool) {
            console.warn('ℹ️ HOSxP write pool is not configured; sync operations that modify HOSxP are disabled.');
        }
    } catch (error) {
        console.error('❌ Database Connection Error:', error);
        // We don't exit here because the internal DB might not exist yet
    }
}
