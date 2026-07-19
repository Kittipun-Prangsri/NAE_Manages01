import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireSchedulerLock, getSchedulerLockTtlSeconds, releaseSchedulerLock } from '../backend/schedulerLock.js';

test('scheduler lock uses a safe default or a valid configured TTL', () => {
    assert.equal(getSchedulerLockTtlSeconds(undefined), 1800);
    assert.equal(getSchedulerLockTtlSeconds('90'), 90);
    assert.equal(getSchedulerLockTtlSeconds('30'), 1800);
});

test('scheduler lock is acquired only by its current holder and released safely', async () => {
    const calls = [];
    const pool = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.startsWith('SELECT holder_id')) return [[{ holder_id: 'worker-a' }]];
            return [{}];
        }
    };

    assert.equal(await acquireSchedulerLock(pool, 'nhso_sync_and_capture', 'worker-a', 90), true);
    assert.equal(await acquireSchedulerLock(pool, 'nhso_sync_and_capture', 'worker-b', 90), false);
    await releaseSchedulerLock(pool, 'nhso_sync_and_capture', 'worker-a');
    assert.match(calls.at(-1).sql, /^DELETE FROM scheduler_locks/);
});
