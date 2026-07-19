import test from 'node:test';
import assert from 'node:assert/strict';
import { runHosxpSync } from '../backend/dataService.js';

function createWritePool({ failQuery = false } = {}) {
    const events = [];
    const connection = {
        async beginTransaction() { events.push('begin'); },
        async query() {
            events.push('query');
            if (failQuery) throw new Error('query failed');
        },
        async commit() { events.push('commit'); },
        async rollback() { events.push('rollback'); },
        release() { events.push('release'); }
    };
    return { events, pool: { async getConnection() { return connection; } } };
}

test('HOSxP sync commits the complete import/update unit', async () => {
    const { pool, events } = createWritePool();
    await runHosxpSync([], '2026-07-19', pool);
    assert.deepEqual(events, ['begin', 'query', 'commit', 'release']);
});

test('HOSxP sync rolls back and releases the connection on failure', async () => {
    const { pool, events } = createWritePool({ failQuery: true });
    await assert.rejects(() => runHosxpSync([], '2026-07-19', pool), /query failed/);
    assert.deepEqual(events, ['begin', 'query', 'rollback', 'release']);
});
