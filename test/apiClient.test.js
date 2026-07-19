import test from 'node:test';
import assert from 'node:assert/strict';

test('API client module keeps transport errors inside its response contract', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 502, statusText: 'Bad Gateway' });

    try {
        const { api } = await import(`../frontend/api.js?test=${Date.now()}`);
        const result = await api.fetchSyncStatus('test-token');
        assert.equal(result.ok, false);
        assert.equal(result.status, 0);
        assert.equal(result.data.error, 'transport_error');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
