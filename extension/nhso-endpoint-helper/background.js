// Talks to the NHSO Tracker API for the content script and popup.  Runs in the
// extension's own origin with host permission, so the hospital server needs no
// CORS change.  The login token is kept in chrome.storage.local on this PC.

const DEFAULT_SERVER = 'https://naeline.khostime.site';

async function settings() {
    const { server = DEFAULT_SERVER, token = null, user = null } = await chrome.storage.local.get(['server', 'token', 'user']);
    return { server: server.replace(/\/$/, ''), token, user };
}

async function api(path, { method = 'GET', body } = {}) {
    const { server, token } = await settings();
    if (!token) return { ok: false, status: 401, data: { message: 'ยังไม่ได้เข้าสู่ระบบ NHSO Tracker (กดไอคอนส่วนเสริม)' } };
    const res = await fetch(`${server}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 && /token/i.test(data.message || '')) {
        await chrome.storage.local.remove(['token', 'user']);
    }
    return { ok: res.ok, status: res.status, data };
}

async function login(server, username, password) {
    const base = (server || DEFAULT_SERVER).replace(/\/$/, '');
    const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) return { ok: false, data };
    await chrome.storage.local.set({ server: base, token: data.token, user: data.user });
    return { ok: true, data: { user: data.user } };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    (async () => {
        try {
            if (message.type === 'api') return reply(await api(message.path, message.options));
            if (message.type === 'login') return reply(await login(message.server, message.username, message.password));
            if (message.type === 'logout') {
                await chrome.storage.local.remove(['token', 'user']);
                return reply({ ok: true });
            }
            if (message.type === 'whoami') return reply({ ok: true, data: await settings() });
            reply({ ok: false, data: { message: 'unknown message' } });
        } catch (err) {
            reply({ ok: false, data: { message: `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${err.message}` } });
        }
    })();
    return true; // async reply
});
