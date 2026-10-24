import crypto from 'crypto';

const DEFAULT_TTL_SECONDS = 30 * 60;

export function getSchedulerLockTtlSeconds(value = process.env.SCHEDULER_LOCK_TTL_SECONDS) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 60 ? parsed : DEFAULT_TTL_SECONDS;
}

export function createSchedulerHolderId() {
    return `${process.env.HOSTNAME || 'host'}:${process.pid}:${crypto.randomUUID()}`;
}

export async function acquireSchedulerLock(pool, lockKey, holderId, ttlSeconds = getSchedulerLockTtlSeconds()) {
    await pool.query(
        `INSERT INTO scheduler_locks (lock_key, holder_id, expires_at)
         VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE
            holder_id = IF(expires_at < UTC_TIMESTAMP(3), VALUES(holder_id), holder_id),
            expires_at = IF(expires_at < UTC_TIMESTAMP(3), VALUES(expires_at), expires_at)`,
        [lockKey, holderId, ttlSeconds]
    );
    const [[lock]] = await pool.query('SELECT holder_id FROM scheduler_locks WHERE lock_key = ?', [lockKey]);
    return lock?.holder_id === holderId;
}

export async function releaseSchedulerLock(pool, lockKey, holderId) {
    await pool.query('DELETE FROM scheduler_locks WHERE lock_key = ? AND holder_id = ?', [lockKey, holderId]);
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

/**
 * Deletes a lock whose holder was a process on this host that no longer exists
 * (e.g. killed by a PM2 restart mid-job), instead of waiting for the TTL.
 * Returns true when a stale lock was removed.
 */
export async function releaseLockIfHolderDead(pool, lockKey, { isAlive = isProcessAlive } = {}) {
    const [[lock]] = await pool.query('SELECT holder_id FROM scheduler_locks WHERE lock_key = ?', [lockKey]);
    if (!lock?.holder_id) return false;
    const [host, pidText] = lock.holder_id.split(':');
    const pid = Number(pidText);
    const localHost = process.env.HOSTNAME || 'host';
    if (host !== localHost || !Number.isInteger(pid) || pid === process.pid || isAlive(pid)) return false;
    await pool.query('DELETE FROM scheduler_locks WHERE lock_key = ? AND holder_id = ?', [lockKey, lock.holder_id]);
    return true;
}
