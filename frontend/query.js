// query.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState } from './state.js';
import { handleApiResponse } from './auth.js';
import { exportToCsv } from './utils.js';

export async function loadSavedQueries(selectedId = '') {
    if (!appState.token) return;
    try {
        const response = await api.fetchSavedQueries(appState.token);
        if (handleApiResponse(response)) {
            appState.savedQueries = response.data;
            ui.renderSavedQueriesDropdown(response.data, selectedId);
        }
    } catch (e) {
        console.error('Error loading saved queries:', e);
    }
}

export async function loadQueryHistory() {
    if (!appState.token) return;
    try {
        const response = await api.fetchQueryHistory(appState.token);
        if (handleApiResponse(response)) {
            appState.queryHistory = response.data.history || [];
            ui.renderQueryHistory(appState.queryHistory, handleQueryHistorySelect);
        }
    } catch (error) {
        console.error('Error loading query history:', error);
    }
}

export async function loadHipdataCodes() {
    if (!appState.token) return;
    try {
        const response = await api.fetchHipdata(appState.token);
        if (!handleApiResponse(response)) return;

        const codes = response.data.selected_codes || response.data.codes || [];
        const sqlList = response.data.sql_list || codes.map(code => `'${code}'`).join(',');
        appState.hipdataCodes = codes;

        const hipdataInput = document.getElementById('query-hipdata');
        const datalist = document.getElementById('hipdata-code-options');
        if (hipdataInput && sqlList) {
            hipdataInput.value = sqlList;
        }
        if (datalist) {
            datalist.innerHTML = '';
            codes.forEach(code => {
                const option = document.createElement('option');
                option.value = `'${code}'`;
                datalist.appendChild(option);
            });
            if (sqlList) {
                const allOption = document.createElement('option');
                allOption.value = sqlList;
                datalist.prepend(allOption);
            }
        }
    } catch (error) {
        console.error('Error loading hipdata codes:', error);
    }
}

export function handleQueryHistorySelect(item) {
    if (!item) return;
    const editor = document.getElementById('sql-editor');
    const dbType = document.getElementById('query-db-type');
    const dateInput = document.getElementById('query-visit-date');
    const hipdataInput = document.getElementById('query-hipdata');
    const templateSelect = document.getElementById('query-template-select');
    const queryName = document.getElementById('new-query-name');

    if (editor) editor.value = item.query_text || '';
    if (dbType) dbType.value = item.db_type || 'hosxp';
    if (dateInput && item.visit_date) dateInput.value = String(item.visit_date).split('T')[0];
    if (hipdataInput && item.hipdata_code) hipdataInput.value = item.hipdata_code;
    if (templateSelect) templateSelect.value = '';
    if (queryName) queryName.value = '';
    document.getElementById('query-info-msg').textContent = 'โหลดคำสั่งจากประวัติแล้ว พร้อมรันหรือบันทึกเป็น Template ใหม่';
}

export async function handleClearQueryHistory() {
    if (!confirm('ต้องการล้างประวัติคำสั่ง SQL ล่าสุดของผู้ใช้นี้ทั้งหมดหรือไม่?')) return;

    ui.setLoading(true);
    try {
        const response = await api.clearQueryHistory(appState.token);
        if (handleApiResponse(response)) {
            appState.queryHistory = [];
            ui.renderQueryHistory([], handleQueryHistorySelect);
            document.getElementById('query-info-msg').textContent = response.data.message || 'ล้างประวัติคำสั่ง SQL แล้ว';
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'ไม่สามารถล้างประวัติ SQL ได้');
        }
    } catch (error) {
        console.error('Error clearing query history:', error);
        alert('เกิดข้อผิดพลาดในการล้างประวัติ SQL');
    } finally {
        ui.setLoading(false);
    }
}

export function handleQueryTemplateSelect(e) {
    const queryId = e.target.value;
    const selected = appState.savedQueries.find(q => String(q.id) === String(queryId));
    if (selected) {
        document.getElementById('sql-editor').value = selected.query_text;
        document.getElementById('query-db-type').value = selected.db_type;
        document.getElementById('new-query-name').value = selected.name;
    }
}

export async function handleRunQuery() {
    const query = document.getElementById('sql-editor').value;
    const dbType = document.getElementById('query-db-type').value;
    const date = document.getElementById('query-visit-date').value;
    const hipdataCode = document.getElementById('query-hipdata').value;

    if (!query) {
        alert('กรุณากรอกคำสั่ง SQL');
        return;
    }

    ui.setLoading(true);
    try {
        const response = await api.runCustomQuery(query, dbType, date, hipdataCode, appState.token);
        if (handleApiResponse(response) && response.data.success) {
            appState.currentQueryResults = response.data.rows;
            appState.querySortBy = '';
            appState.querySortDesc = false;

            const searchVal = document.getElementById('query-search-input').value;
            ui.renderGrafanaTable(response.data.rows, '', false, searchVal, handleQueryHeaderClick);

            document.getElementById('query-info-msg').textContent =
                `พบผลลัพธ์ ${response.data.rows.length.toLocaleString()} แถว | ใช้เวลาประมวลผล ${response.data.executionTimeMs} ms`;
            loadQueryHistory();
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการรัน SQL');
            document.getElementById('query-info-msg').textContent = response.data.message || 'การเรียกใช้ SQL ล้มเหลว';
            ui.renderGrafanaTable([], '', false, '', null);
        }
    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message);
    } finally {
        ui.setLoading(false);
    }
}

export function handleQueryHeaderClick(column) {
    if (appState.querySortBy === column) {
        appState.querySortDesc = !appState.querySortDesc;
    } else {
        appState.querySortBy = column;
        appState.querySortDesc = false;
    }

    const searchVal = document.getElementById('query-search-input').value;
    ui.renderGrafanaTable(
        appState.currentQueryResults,
        appState.querySortBy,
        appState.querySortDesc,
        searchVal,
        handleQueryHeaderClick
    );
}

export function handleQueryExport() {
    if (!appState.currentQueryResults || appState.currentQueryResults.length === 0) {
        alert('ไม่มีข้อมูลให้ส่งออก');
        return;
    }

    const dbType = document.getElementById('query-db-type').value;
    const date = document.getElementById('query-visit-date').value;

    const exportData = appState.currentQueryResults.map(row => {
        const formatted = {};
        for (const [key, value] of Object.entries(row)) {
            if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
                try {
                    const decoder = new TextDecoder('utf-8');
                    const bytes = new Uint8Array(value.data);
                    formatted[key] = decoder.decode(bytes);
                } catch (e) {
                    formatted[key] = '[Binary]';
                }
            } else {
                formatted[key] = value;
            }
        }
        return formatted;
    });

    exportToCsv(`SQL_Report_${dbType}_${date}.csv`, exportData);
}

export async function handleSaveQuery() {
    const name = document.getElementById('new-query-name').value.trim();
    const queryText = document.getElementById('sql-editor').value;
    const dbType = document.getElementById('query-db-type').value;

    if (!name || !queryText) {
        alert('กรุณากรอกชื่อและคำสั่ง SQL ก่อนกดบันทึก');
        return;
    }

    ui.setLoading(true);
    try {
        const response = await api.saveQuery(name, queryText, dbType, appState.token);
        if (handleApiResponse(response)) {
            alert('บันทึกคำสั่งสำเร็จ');
            await loadSavedQueries();
            const newlySaved = appState.savedQueries.find(q => q.name === name);
            if (newlySaved) {
                document.getElementById('query-template-select').value = newlySaved.id;
            }
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'บันทึกล้มเหลว');
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        ui.setLoading(false);
    }
}

export async function handleDeleteQuery() {
    const select = document.getElementById('query-template-select');
    const queryId = select.value;

    if (!queryId) {
        alert('กรุณาเลือกคำสั่งที่ต้องการลบใน Dropdown ก่อน');
        return;
    }

    const selected = appState.savedQueries.find(q => String(q.id) === String(queryId));
    if (!selected) return;

    if (!confirm(`คุณต้องการลบคำสั่ง "${selected.name}" หรือไม่?`)) return;

    ui.setLoading(true);
    try {
        const response = await api.deleteSavedQuery(queryId, appState.token);
        if (handleApiResponse(response)) {
            alert('ลบสำเร็จ');
            document.getElementById('sql-editor').value = '';
            document.getElementById('new-query-name').value = '';
            await loadSavedQueries();
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'ลบล้มเหลว');
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        ui.setLoading(false);
    }
}

export function handleQuerySearch(e) {
    const query = e.target.value;
    if (!appState.currentQueryResults) return;

    ui.renderGrafanaTable(
        appState.currentQueryResults,
        appState.querySortBy,
        appState.querySortDesc,
        query,
        handleQueryHeaderClick
    );
}
