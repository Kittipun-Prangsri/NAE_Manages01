import { trackerPool } from './db.js';

export async function writeAuditLog(req, action, entityType, entityId = null, details = null) {
    try {
        const username = req?.user?.username || null;
        const role = req?.user?.role || null;
        const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
        const userAgent = req?.headers?.['user-agent'] || null;
        const payload = details ? JSON.stringify(details).slice(0, 65000) : null;

        await trackerPool.query(
            `INSERT INTO audit_logs (username, role, action, entity_type, entity_id, details, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, role, action, entityType, entityId ? String(entityId) : null, payload, ipAddress, userAgent]
        );
    } catch (error) {
        console.warn('⚠️ Failed to write audit log:', error.message);
    }
}
