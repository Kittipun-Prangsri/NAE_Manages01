import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Pool for HOSxP (Read-Only)
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
    multipleStatements: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 20000,
    maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
});

// Pool for Internal Tracking DB
export const trackerPool = mysql.createPool({
    host: process.env.TRACKER_HOST,
    user: process.env.TRACKER_USER,
    password: process.env.TRACKER_PASS,
    database: process.env.TRACKER_DB,
    port: process.env.TRACKER_PORT || 3306,
    charset: 'tis620',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 20000,
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
    } catch (error) {
        console.error('❌ Database Connection Error:', error);
        // We don't exit here because the internal DB might not exist yet
    }
}
