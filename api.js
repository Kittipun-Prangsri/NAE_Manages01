// api.js
const API_BASE = '/api';

export const api = {
    async login(username, password) {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async probeDate(file, token) {
        const formData = new FormData();
        formData.append('excel', file);
        const res = await fetch(`${API_BASE}/sync/probe-date`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async processSync(date, file, token) {
        const formData = new FormData();
        formData.append('visit_date', date);
        formData.append('excel', file);
        const res = await fetch(`${API_BASE}/sync/process`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async processSyncJson(date, jsonData, token) {
        const res = await fetch(`${API_BASE}/sync/process-json`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visit_date: date, data: jsonData })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async processSyncDirect(date, token) {
        const res = await fetch(`${API_BASE}/sync/nhso-direct-api`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visit_date: date })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchDashboard(date, token) {
        const res = await fetch(`${API_BASE}/tracking/dashboard?date=${date}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchSummary(token) {
        const res = await fetch(`${API_BASE}/tracking/summary`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async runCustomQuery(query, dbType, date, hipdataCode, token) {
        const res = await fetch(`${API_BASE}/custom-query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, db_type: dbType, visit_date: date, hipdata_code: hipdataCode })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchSavedQueries(token) {
        const res = await fetch(`${API_BASE}/saved-queries`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async saveQuery(name, queryText, dbType, token) {
        const res = await fetch(`${API_BASE}/saved-queries`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, query_text: queryText, db_type: dbType })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async deleteSavedQuery(id, token) {
        const res = await fetch(`${API_BASE}/saved-queries/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    }
};
