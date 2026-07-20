// api.js
const API_BASE = '/api';

const rawApi = {
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

    async processSync(date, file, token, excelMapping = null) {
        const formData = new FormData();
        formData.append('visit_date', date);
        formData.append('excel', file);
        if (excelMapping) {
            formData.append('excel_mapping', JSON.stringify(excelMapping));
        }
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

    async triggerPortalSync(date, token) {
        const res = await fetch(`${API_BASE}/sync/nhso-portal-download`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visit_date: date })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchSyncStatus(token) {
        const res = await fetch(`${API_BASE}/sync/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchDashboard(date, token) {
        const params = new URLSearchParams({ date, _ts: String(Date.now()) });
        const res = await fetch(`${API_BASE}/tracking/dashboard?${params.toString()}`, {
            cache: 'no-store',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchGroupInsights(date, token, groupBy = 'department', hipdataCode = "'OFC','UCS','OTH','BMT','XXX','LGO','STP','SSS','SSI','A2','BKK','PTY','A9'") {
        const params = new URLSearchParams({ date, group_by: groupBy, hipdata_code: hipdataCode, _ts: String(Date.now()) });
        const res = await fetch(`${API_BASE}/tracking/group-insights?${params.toString()}`, {
            cache: 'no-store',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchRightsTrackingTable(date, token) {
        const params = new URLSearchParams({ date, _ts: String(Date.now()) });
        const res = await fetch(`${API_BASE}/tracking/rights-table?${params.toString()}`, {
            cache: 'no-store',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchLiveDashboardData(date, token) {
        const res = await fetch(`${API_BASE}/dashboard/live-data?date=${date}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchVisitsTodayByTambon(token) {
        const res = await fetch(`${API_BASE}/visits/today-by-tambon`, {
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

    async fetchHipdata(token) {
        const res = await fetch(`${API_BASE}/hipdata`, {
            cache: 'no-store',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            }
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
    },

    async fetchQueryHistory(token) {
        const res = await fetch(`${API_BASE}/query-history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async clearQueryHistory(token) {
        const res = await fetch(`${API_BASE}/query-history`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchUsers(token) {
        const res = await fetch(`${API_BASE}/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async createUser(userData, token) {
        const res = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async updateUser(id, userData, token) {
        const res = await fetch(`${API_BASE}/admin/users/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async deleteUser(id, token) {
        const res = await fetch(`${API_BASE}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async testNotification(type, tokenVal, targetVal, token) {
        const res = await fetch(`${API_BASE}/admin/users/test-notification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type, token: tokenVal, target: targetVal })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async testStoredNotification(id, type, token) {
        const res = await fetch(`${API_BASE}/admin/users/${id}/test-notification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchSchedules(token) {
        const res = await fetch(`${API_BASE}/admin/schedules`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchSyncRuns(token) {
        const res = await fetch(`${API_BASE}/admin/sync-runs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async fetchAuditLogs(token) {
        const res = await fetch(`${API_BASE}/admin/audit-logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async createSchedule(time, token) {
        const res = await fetch(`${API_BASE}/admin/schedules`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ schedule_time: time })
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async updateSchedule(id, scheduleData, token) {
        const res = await fetch(`${API_BASE}/admin/schedules/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scheduleData)
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    },

    async deleteSchedule(id, token) {
        const res = await fetch(`${API_BASE}/admin/schedules/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    }
};

// A Vite proxy error (for example 502 while the backend is restarting) can
// return an empty HTML response. Keep that transport failure from crashing UI
// flows that otherwise expect every API response to contain JSON.
export const api = Object.fromEntries(
    Object.entries(rawApi).map(([name, request]) => [name, async (...args) => {
        try {
            return await request(...args);
        } catch (error) {
            console.warn(`API request failed (${name}): ${error.message}`);
            return {
                ok: false,
                status: 0,
                data: {
                    success: false,
                    error: 'transport_error',
                    message: 'ไม่สามารถติดต่อหรืออ่านผลตอบกลับจากเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า backend ทำงานอยู่แล้วลองใหม่อีกครั้ง'
                }
            };
        }
    }])
);
