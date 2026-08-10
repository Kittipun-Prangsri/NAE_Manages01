// app.js
import { api } from './api.js';
import { ui } from './ui.js';
import { isTokenExpired } from './utils.js';

import {
    appState,
    domRefs,
    LIVE_DASHBOARD_REFRESH_MS,
    TRACKER_PAGE_SIZE
} from './state.js';

import {
    handleLogin,
    handleLogout,
    handleAdminQuickLogin,
    updateAdminLoginBtnVisibility,
    openAdminLoginModal,
    closeAdminLoginModal,
    handleApiResponse
} from './auth.js';

import {
    setupFileUpload,
    handleFileSelection,
    closeExcelMappingModal,
    saveExcelMappingFromModal
} from './uploader.js';

import {
    handleApiSync,
    handleAutoPortalSync,
    handlePasteSync,
    handleSyncProcess
} from './sync.js';

import {
    setupTrackerColumnFilters,
    closeTrackerColumnFilterMenu,
    renderTrackerTable,
    clearTrackerDashboardFilter,
    handleExportErrors,
    openUcPendingListModal,
    handleGroupInsightDepartmentClick,
    applyTrackerDashboardFilter
} from './tracker.js';

import {
    loadSavedQueries,
    loadQueryHistory,
    loadHipdataCodes,
    handleQueryHistorySelect,
    handleClearQueryHistory,
    handleQueryTemplateSelect,
    handleRunQuery,
    handleQueryExport,
    handleSaveQuery,
    handleDeleteQuery,
    handleQuerySearch
} from './query.js';

import {
    loadAdminUsers,
    closeUserModal,
    handleUserFormSubmit,
    handleAdminSubtabSwitch,
    loadAdminSyncRuns,
    loadAdminAuditLogs,
    handleAddSchedule
} from './admin.js';

// Callbacks container to avoid circular dependencies
const callbacks = {
    loadDashboardData,
    loadHipdataCodes,
    loadWeeklySummary,
    stopLiveDashboardAutoRefresh,
    handleTabSwitch
};

// Initialize Application
function init() {
    if (typeof document === 'undefined') return;

    ui.initTheme();
    ui.initSidebar();
    applyLiveTvMode(appState.isTvMode);

    // Fetch elements safely and assign to shared state DOM references
    domRefs.visitDateInput = document.getElementById('visit-date');
    domRefs.excelFileInput = document.getElementById('excel-file');

    if (appState.token && appState.user) {
        if (isTokenExpired(appState.token)) {
            console.warn('Session expired (checked locally). Logging out.');
            handleLogout(callbacks);
            return;
        }
        ui.showDashboard(appState.user.full_name || appState.user.name);
        updateAdminLoginBtnVisibility();
        if (appState.user.role === 'admin') {
            document.getElementById('tab-admin')?.classList.remove('hidden');
        }
        if (domRefs.visitDateInput) domRefs.visitDateInput.valueAsDate = new Date();
        loadDashboardData();
        loadHipdataCodes();
        loadSavedQueries();
        loadQueryHistory();
    } else {
        ui.showLogin();
    }

    setupEventListeners();
    ui.initTiltEffect();
}

function setupEventListeners() {
    // Theme & UX
    document.getElementById('theme-toggle')?.addEventListener('click', ui.toggleTheme);
    document.getElementById('sidebar-toggle')?.addEventListener('click', ui.toggleSidebar.bind(ui));
    document.getElementById('toggle-list-btn')?.addEventListener('click', ui.togglePatientList);
    document.getElementById('live-tv-toggle')?.addEventListener('click', handleLiveTvToggle);
    document.getElementById('live-fullscreen-btn')?.addEventListener('click', handleLiveFullscreen);
    document.getElementById('live-refresh-btn')?.addEventListener('click', loadLiveDashboardData);
    document.getElementById('live-auto-toggle-btn')?.addEventListener('click', handleLiveAutoToggle);
    document.querySelectorAll('.group-insights-toggle').forEach(btn => {
        btn.addEventListener('click', () => handleGroupInsightsToggle(btn.dataset.groupBy));
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    setupBackToTop();

    // Authentication
    document.getElementById('login-form')?.addEventListener('submit', (e) => handleLogin(e, callbacks));
    document.getElementById('logout-btn')?.addEventListener('click', () => handleLogout(callbacks));

    // Main Actions
    document.getElementById('sync-btn')?.addEventListener('click', () => handleSyncProcess(callbacks));
    document.getElementById('paste-sync-btn')?.addEventListener('click', () => handlePasteSync(callbacks));
    document.getElementById('api-sync-btn')?.addEventListener('click', () => handleApiSync(callbacks));
    document.getElementById('auto-portal-btn')?.addEventListener('click', () => handleAutoPortalSync(callbacks));
    document.getElementById('refresh-btn')?.addEventListener('click', () => loadDashboardData());
    document.getElementById('uc-pending-total-count-card')?.addEventListener('click', openUcPendingListModal);
    document.getElementById('uc-insight-refresh-btn')?.addEventListener('click', refreshGroupInsights);
    domRefs.visitDateInput?.addEventListener('change', () => loadDashboardData());

    // Homepage table sorting
    document.querySelectorAll('#tracking-table-thead th[data-sort]').forEach(th => {
        const sortTableByHeader = () => {
            const field = th.getAttribute('data-sort');
            if (appState.trackerSortBy === field) {
                appState.trackerSortDesc = !appState.trackerSortDesc;
            } else {
                appState.trackerSortBy = field;
                appState.trackerSortDesc = false;
            }
            renderTrackerTable();
        };
        th.tabIndex = 0;
        th.setAttribute('aria-label', `เรียงข้อมูลตาม ${th.textContent.trim()}`);
        th.addEventListener('click', sortTableByHeader);
        th.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            sortTableByHeader();
        });
    });

    setupTrackerColumnFilters();

    // Homepage table search input (with debounce to prevent table flickering while typing)
    let trackerSearchTimeout = null;
    document.getElementById('tracker-search-input')?.addEventListener('input', (e) => {
        const val = e.target.value;
        clearTimeout(trackerSearchTimeout);
        trackerSearchTimeout = setTimeout(() => {
            appState.trackerSearchFilter = val;
            appState.trackerCurrentPage = 1;
            renderTrackerTable();
        }, 200);
    });
    document.getElementById('clear-tracker-dashboard-filter')?.addEventListener('click', clearTrackerDashboardFilter);
    
    document.addEventListener('tracker-page-change', (e) => {
        if (e.detail && e.detail.page) {
            appState.trackerCurrentPage = e.detail.page;
            renderTrackerTable();
        }
    });
    document.querySelectorAll('[data-tracker-status-filter]').forEach(button => {
        button.addEventListener('click', () => {
            const status = button.dataset.trackerStatusFilter;
            if (status === 'all') {
                clearTrackerDashboardFilter();
                return;
            }
            const labels = {
                GREEN: 'สมบูรณ์แล้ว',
                RED: 'ยังไม่เปิด Authen',
                YELLOW: 'รอปิด Endpoint'
            };
            applyTrackerDashboardFilter('status', status, labels[status] || status, {}, callbacks);
        });
    });

    // Export Data
    document.getElementById('export-error-btn')?.addEventListener('click', handleExportErrors);

    // File Upload & Drag-Drop (with Auto-Date Detection)
    setupFileUpload(callbacks);

    // Tab Switcher Events
    document.getElementById('tab-tracker')?.addEventListener('click', () => handleTabSwitch('tab-tracker'));
    document.getElementById('tab-live-dashboard')?.addEventListener('click', () => handleTabSwitch('tab-live-dashboard'));
    document.getElementById('tab-grafana')?.addEventListener('click', () => handleTabSwitch('tab-grafana'));
    document.getElementById('tab-embed-grafana')?.addEventListener('click', () => handleTabSwitch('tab-embed-grafana'));
    document.getElementById('tab-admin')?.addEventListener('click', () => handleTabSwitch('tab-admin'));

    // Admin user management listeners
    document.getElementById('add-user-btn')?.addEventListener('click', () => openUserModal());
    document.getElementById('close-user-modal')?.addEventListener('click', closeUserModal);
    document.getElementById('cancel-user-modal')?.addEventListener('click', closeUserModal);
    document.getElementById('user-form')?.addEventListener('submit', handleUserFormSubmit);

    // Admin subtab navigation events
    document.getElementById('admin-subtab-users')?.addEventListener('click', () => handleAdminSubtabSwitch('users'));
    document.getElementById('admin-subtab-schedules')?.addEventListener('click', () => handleAdminSubtabSwitch('schedules'));
    document.getElementById('admin-subtab-sync-runs')?.addEventListener('click', () => handleAdminSubtabSwitch('sync-runs'));
    document.getElementById('admin-subtab-audit-logs')?.addEventListener('click', () => handleAdminSubtabSwitch('audit-logs'));
    document.getElementById('add-schedule-form')?.addEventListener('submit', handleAddSchedule);
    document.getElementById('refresh-sync-runs-btn')?.addEventListener('click', loadAdminSyncRuns);
    document.getElementById('refresh-audit-logs-btn')?.addEventListener('click', loadAdminAuditLogs);
    document.getElementById('close-excel-mapping-modal')?.addEventListener('click', () => closeExcelMappingModal(false));
    document.getElementById('cancel-excel-mapping-btn')?.addEventListener('click', () => closeExcelMappingModal(false));
    document.getElementById('save-excel-mapping-btn')?.addEventListener('click', saveExcelMappingFromModal);

    // Admin quick login modal listeners
    document.getElementById('admin-login-btn')?.addEventListener('click', openAdminLoginModal);
    document.getElementById('close-admin-login-modal')?.addEventListener('click', closeAdminLoginModal);
    document.getElementById('cancel-admin-login-modal')?.addEventListener('click', closeAdminLoginModal);
    document.getElementById('admin-login-form')?.addEventListener('submit', (e) => handleAdminQuickLogin(e, callbacks));

    // Quick Sync Modal listeners & keyboard shortcuts
    document.getElementById('quick-sync-trigger-btn')?.addEventListener('click', openQuickSyncModal);
    document.getElementById('quick-sync-sidebar-btn')?.addEventListener('click', openQuickSyncModal);
    document.getElementById('close-quick-sync-modal')?.addEventListener('click', closeQuickSyncModal);
    document.getElementById('cancel-quick-sync-btn')?.addEventListener('click', closeQuickSyncModal);
    document.getElementById('open-standalone-popup-btn')?.addEventListener('click', () => {
        closeQuickSyncModal();
        window.open('quick-sync.html', 'NAE_QuickSync_Popup', 'width=460,height=560,resizable=yes,scrollbars=yes');
    });
    document.getElementById('quick-sync-form')?.addEventListener('submit', handleQuickSyncSubmit);
    document.getElementById('quick-sync-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeQuickSyncModal();
    });

    // Keyboard shortcuts (Alt+S to open, Escape to close)
    document.addEventListener('keydown', (e) => {
        if ((e.altKey && e.key.toLowerCase() === 's') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's')) {
            e.preventDefault();
            const modal = document.getElementById('quick-sync-modal');
            if (modal?.classList.contains('hidden')) {
                openQuickSyncModal();
            } else {
                closeQuickSyncModal();
            }
        }
        if (e.key === 'Escape') {
            const modal = document.getElementById('quick-sync-modal');
            if (modal && !modal.classList.contains('hidden')) {
                closeQuickSyncModal();
            }
        }
    });

    // Grafana SQL Panel Action Events
    document.getElementById('query-template-select')?.addEventListener('change', handleQueryTemplateSelect);
    document.getElementById('run-query-btn')?.addEventListener('click', handleRunQuery);
    document.getElementById('save-query-btn')?.addEventListener('click', handleSaveQuery);
    document.getElementById('delete-query-btn')?.addEventListener('click', handleDeleteQuery);
    document.getElementById('refresh-query-history-btn')?.addEventListener('click', loadQueryHistory);
    document.getElementById('clear-query-history-btn')?.addEventListener('click', handleClearQueryHistory);
    document.getElementById('query-export-btn')?.addEventListener('click', handleQueryExport);
    document.getElementById('query-search-input')?.addEventListener('input', handleQuerySearch);

    // Editor shortcut: Ctrl + Enter to run query
    document.getElementById('sql-editor')?.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            handleRunQuery();
        }
    });
}

function setupTrackerColumnFilters() {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('#tracking-table-thead th[data-sort]').forEach(th => {
        if (th.dataset.columnFilterReady === 'true') return;
        const field = th.getAttribute('data-sort');
        const meta = TRACKER_COLUMN_FILTERS.find(item => item.field === field);
        if (!field || !meta) return;

        th.dataset.columnFilterReady = 'true';
        th.dataset.columnLabel = meta.label;
        th.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center justify-between gap-2';

        const labelWrapper = document.createElement('span');
        labelWrapper.className = 'inline-flex items-center gap-1 min-w-0';

        const label = document.createElement(meta.help ? 'abbr' : 'span');
        label.className = 'truncate';
        label.textContent = meta.label;
        if (meta.help) label.title = meta.help;

        const sortIndicator = document.createElement('span');
        sortIndicator.dataset.sortIndicator = field;
        sortIndicator.className = 'text-[10px] leading-none';

        const filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.dataset.columnFilter = field;
        filterButton.className = 'tracker-column-filter-btn shrink-0 text-slate-400 hover:text-blue-600 dark:hover:text-blue-300 transition cursor-pointer';
        filterButton.title = `กรอง ${meta.label}`;
        filterButton.innerHTML = '<i class="fas fa-filter text-[11px] pointer-events-none"></i>';
        filterButton.addEventListener('click', event => {
            event.stopPropagation();
            openTrackerColumnFilterMenu(field, filterButton);
        });

        labelWrapper.append(label, sortIndicator);
        wrapper.append(labelWrapper, filterButton);
        th.appendChild(wrapper);
    });

    document.addEventListener('click', event => {
        const menu = document.getElementById('tracker-column-filter-menu');
        if (!menu || menu.contains(event.target) || event.target.closest('.tracker-column-filter-btn')) return;
        closeTrackerColumnFilterMenu();
    });
}

function closeTrackerColumnFilterMenu() {
    document.getElementById('tracker-column-filter-menu')?.remove();
    activeColumnFilterField = null;
}

function openTrackerColumnFilterMenu(field, anchor) {
    const rows = appState.lgoTableData.length > 0 ? appState.lgoTableData : appState.rawTableData;
    const values = getTrackerColumnFilterValues(rows, field);
    const meta = TRACKER_COLUMN_FILTERS.find(item => item.field === field);
    const existingFilter = appState.trackerColumnFilters[field];
    const selectedValues = new Set(Array.isArray(existingFilter) ? existingFilter : values.map(item => item.value));

    if (activeColumnFilterField === field) {
        closeTrackerColumnFilterMenu();
        return;
    }
    closeTrackerColumnFilterMenu();
    activeColumnFilterField = field;

    const menu = document.createElement('div');
    menu.id = 'tracker-column-filter-menu';
    menu.className = 'fixed z-[9999] w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-2xl p-3 text-xs text-slate-700 dark:text-slate-200';
    menu.addEventListener('click', event => event.stopPropagation());

    const title = document.createElement('div');
    title.className = 'font-extrabold text-slate-700 dark:text-slate-200 mb-2 flex items-center justify-between';
    title.innerHTML = `<span>Filter: ${meta?.label || field}</span><span class="text-slate-400">${values.length.toLocaleString()} ค่า</span>`;

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'ค้นหาค่าในคอลัมน์นี้';
    search.className = 'w-full mb-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/30';

    const list = document.createElement('div');
    list.className = 'max-h-64 overflow-auto custom-scrollbar border border-slate-100 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800';

    values.forEach(item => {
        const row = document.createElement('label');
        row.className = 'tracker-column-filter-option flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer';
        row.dataset.filterText = item.label.toLowerCase();

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.value;
        checkbox.checked = selectedValues.has(item.value);
        checkbox.className = 'rounded border-slate-300 text-blue-600 focus:ring-blue-500';

        const text = document.createElement('span');
        text.className = item.value === '' ? 'text-slate-400 italic' : 'font-semibold';
        text.textContent = item.label;

        row.append(checkbox, text);
        list.appendChild(row);
    });

    const actionRow = document.createElement('div');
    actionRow.className = 'flex items-center justify-between gap-2 mt-3';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold';
    selectAllBtn.textContent = 'เลือกทั้งหมด';
    selectAllBtn.addEventListener('click', () => {
        list.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
    });

    const clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold';
    clearAllBtn.textContent = 'ล้างทั้งหมด';
    clearAllBtn.addEventListener('click', () => {
        list.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    });

    const footer = document.createElement('div');
    footer.className = 'flex items-center justify-end gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800';

    const clearFilterBtn = document.createElement('button');
    clearFilterBtn.type = 'button';
    clearFilterBtn.className = 'mr-auto text-blue-600 dark:text-blue-300 font-bold hover:underline';
    clearFilterBtn.textContent = 'Clear filter';
    clearFilterBtn.addEventListener('click', () => {
        delete appState.trackerColumnFilters[field];
        appState.trackerVisibleRows = TRACKER_PAGE_SIZE;
        closeTrackerColumnFilterMenu();
        renderTrackerTable();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeTrackerColumnFilterMenu);

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold shadow-sm';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => {
        const checkedValues = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
        if (checkedValues.length === values.length) {
            delete appState.trackerColumnFilters[field];
        } else {
            appState.trackerColumnFilters[field] = checkedValues;
        }
        appState.trackerVisibleRows = TRACKER_PAGE_SIZE;
        closeTrackerColumnFilterMenu();
        renderTrackerTable();
    });

    search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        list.querySelectorAll('.tracker-column-filter-option').forEach(option => {
            option.classList.toggle('hidden', Boolean(query) && !option.dataset.filterText.includes(query));
        });
    });

    actionRow.append(selectAllBtn, clearAllBtn);
    footer.append(clearFilterBtn, cancelBtn, okBtn);
    menu.append(title, search, list, actionRow, footer);
    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 336);
    const top = Math.min(rect.bottom + 8, window.innerHeight - menu.offsetHeight - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${Math.max(12, top)}px`;
    search.focus();
}

// --- Handlers ---

function handleApiResponse(response) {
    if (!response.ok) {
        if (response.status === 401) {
            console.warn('Session expired or unauthorized. Logging out.');
            if (!isLoggingOut) {
                isLoggingOut = true;
                alert('เซสชั่นหมดอายุหรือคุณไม่มีสิทธิ์เข้าใช้งาน กรุณาเข้าสู่ระบบใหม่');
                handleLogout();
            }
            return false;
        }
        if (response.status === 403) {
            alert(response.data.message || 'คุณไม่มีสิทธิ์ในการดำเนินการนี้ (Forbidden)');
            return false;
        }
    }
    return response.ok;
}

async function handleLogin(e) {
    e.preventDefault();
    const userInp = document.getElementById('username').value;
    const passInp = document.getElementById('password').value;

    const { ok, data } = await api.login(userInp, passInp);
    if (ok) {
        appState.token = data.token;
        appState.user = data.user;

        // บันทึกข้อมูลลง LocalStorage
        localStorage.setItem('nhso_token', data.token);
        localStorage.setItem('nhso_user', JSON.stringify(data.user));

        // บันทึกข้อมูลแยกส่วน (ตามที่ผู้ใช้ต้องการให้ยกเลิกการคอมเมนต์หรือเพิ่มเติม)
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('fullname', data.user.full_name);
        localStorage.setItem('department', data.user.department || '');
        localStorage.setItem('role', data.user.role);

        if (data.user.role === 'admin') {
            document.getElementById('tab-admin')?.classList.remove('hidden');
        }
        updateAdminLoginBtnVisibility();
        ui.showDashboard(data.user.full_name);
        visitDateInput.valueAsDate = new Date();
        loadDashboardData();
        loadHipdataCodes();
        loadWeeklySummary();
    } else {
        ui.showLoginError(data.message || 'รหัสผ่านไม่ถูกต้อง');
    }
}

function handleLogout() {
    isLoggingOut = true;
    stopLiveDashboardAutoRefresh();
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('nhso_token');
        localStorage.removeItem('nhso_user');
        localStorage.removeItem('username');
        localStorage.removeItem('fullname');
        localStorage.removeItem('department');
        localStorage.removeItem('role');
    }
    if (typeof location !== 'undefined') {
        location.reload();
    }
}

// --- Auto-Date Detection (เมื่อเลือกไฟล์) ---
function setupFileUpload() {
    const dropzone = document.getElementById('dropzone');
    if (!dropzone || !excelFileInput) return;

    dropzone.addEventListener('click', () => excelFileInput.click());

    excelFileInput.addEventListener('change', (e) => {
        handleFileSelection(e.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            dropzone.classList.add('border-blue-500', 'bg-blue-50/20');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            dropzone.classList.remove('border-blue-500', 'bg-blue-50/20');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        handleFileSelection(file);

        // Sync to input file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        excelFileInput.files = dataTransfer.files;
    });
}

async function handleFileSelection(file) {
    if (!file) return;
    ui.updateDropzoneUI(file);
    appState.excelMapping = null;
    appState.excelHeaders = [];
    appState.excelMappingFields = [];

    // Auto-detect Date from Excel
    ui.setLoading(true);
    try {
        const response = await api.probeDate(file, appState.token);
        if (handleApiResponse(response)) {
            appState.excelMapping = response.data.mapping || null;
            appState.excelHeaders = response.data.headers || [];
            appState.excelMappingFields = response.data.mappingFields || [];
            if (response.data.detected_date) {
                visitDateInput.value = response.data.detected_date;
            }
            if (response.data.missingRequired?.length > 0) {
                openExcelMappingModal(response.data, 'ระบบอ่านบางคอลัมน์ไม่มั่นใจ กรุณาจับคู่คอลัมน์ที่จำเป็นก่อนกดประมวลผล');
            }
            if (visitDateInput.value) {
                // โหลดข้อมูล Dashboard ตามวันที่ที่จับได้
                await loadDashboardData();
                loadWeeklySummary();
            }
        }
    } catch (error) {
        console.warn("ไม่สามารถอ่านวันที่จากไฟล์อัตโนมัติได้:", error);
    } finally {
        ui.setLoading(false);
    }
}

function getMissingExcelMappingFields(mapping = appState.excelMapping || {}) {
    return (appState.excelMappingFields || [])
        .filter(field => field.required)
        .filter(field => !mapping[field.key]);
}

function openExcelMappingModal(payload = {}, message = '') {
    const modal = document.getElementById('excel-mapping-modal');
    const fieldsWrap = document.getElementById('excel-mapping-fields');
    const preview = document.getElementById('excel-mapping-preview');
    const messageEl = document.getElementById('excel-mapping-message');
    if (!modal || !fieldsWrap) return Promise.resolve(appState.excelMapping);

    const headers = payload.headers || appState.excelHeaders || [];
    const fields = payload.mappingFields || appState.excelMappingFields || [];
    const mapping = { ...(payload.mapping || appState.excelMapping || {}) };

    appState.excelHeaders = headers;
    appState.excelMappingFields = fields;
    appState.excelMapping = mapping;

    if (messageEl) {
        const missing = payload.missingRequired || getMissingExcelMappingFields(mapping);
        messageEl.textContent = message || (missing.length > 0
            ? `กรุณาเลือกคอลัมน์จำเป็น: ${missing.map(item => item.label).join(', ')}`
            : 'ตรวจสอบหรือปรับ mapping ก่อนประมวลผล');
    }

    fieldsWrap.innerHTML = fields.map(field => {
        const options = ['<option value="">-- ไม่ใช้ --</option>'].concat(headers.map(header => {
            const selected = mapping[field.key] === header ? 'selected' : '';
            return `<option value="${escapeHtml(header)}" ${selected}>${escapeHtml(header)}</option>`;
        })).join('');
        const requiredBadge = field.required ? '<span class="text-red-500">*</span>' : '';
        return `
            <label class="space-y-1">
                <span class="block text-slate-500 dark:text-slate-400">${escapeHtml(field.label)} ${requiredBadge}</span>
                <select class="excel-mapping-select w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30" data-field="${field.key}">
                    ${options}
                </select>
            </label>
        `;
    }).join('');

    if (preview) {
        preview.textContent = headers.length > 0
            ? `พบคอลัมน์ในไฟล์: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? ' ...' : ''}`
            : 'ยังไม่พบ header จากไฟล์ Excel';
    }

    modal.classList.remove('hidden');
    return new Promise(resolve => {
        appState.pendingExcelMappingResolve = resolve;
    });
}

function closeExcelMappingModal(confirmed) {
    const modal = document.getElementById('excel-mapping-modal');
    if (modal) modal.classList.add('hidden');
    if (appState.pendingExcelMappingResolve) {
        appState.pendingExcelMappingResolve(confirmed ? appState.excelMapping : null);
        appState.pendingExcelMappingResolve = null;
    }
}

function saveExcelMappingFromModal() {
    const selects = document.querySelectorAll('.excel-mapping-select');
    const mapping = {};
    selects.forEach(select => {
        if (select.value) mapping[select.dataset.field] = select.value;
    });

    const missing = getMissingExcelMappingFields(mapping);
    if (missing.length > 0) {
        alert(`กรุณาเลือกคอลัมน์จำเป็นให้ครบ: ${missing.map(item => item.label).join(', ')}`);
        return;
    }

    appState.excelMapping = mapping;
    closeExcelMappingModal(true);
}

async function ensureExcelMapping() {
    const missing = getMissingExcelMappingFields();
    if (missing.length === 0) return appState.excelMapping;
    return openExcelMappingModal({
        headers: appState.excelHeaders,
        mapping: appState.excelMapping,
        mappingFields: appState.excelMappingFields,
        missingRequired: missing
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function handleApiSync() {
    const visitDate = visitDateInput.value;
    if (!visitDate) {
        alert('กรุณาเลือกวันที่ต้องการตรวจสอบก่อน');
        return;
    }

    if (!confirm(`ระบบจะดึงข้อมูลจาก สปสช. ผ่าน API โดยอัตโนมัติสำหรับวันที่ ${visitDate}\nขั้นตอนนี้อาจใช้เวลาสักครู่ ขึ้นอยู่กับจำนวนผู้ป่วย\nต้องการเริ่มดำเนินการหรือไม่?`)) {
        return;
    }

    ui.setLoading(true);
    try {
        const response = await api.processSyncDirect(visitDate, appState.token);
        if (handleApiResponse(response)) {
            await loadDashboardData();
            loadWeeklySummary();
            alert(response.data.message || 'ดึงข้อมูลสำเร็จ');
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ API');
        }
    } catch (error) {
        console.error('API Sync error:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

async function handleAutoPortalSync() {
    const visitDate = visitDateInput.value;
    if (!visitDate) {
        alert('กรุณาเลือกวันที่ต้องการดึงข้อมูลก่อน');
        return;
    }

    if (!confirm(`คุณต้องการสั่งให้บอทดาวน์โหลดรายงานจากเว็บ สปสช. ของวันที่ ${visitDate} และประมวลผล Sync ข้อมูลโดยอัตโนมัติใช่หรือไม่?\n(คุณสามารถสแกน QR Code เพื่อล็อกอินผ่านทางหน้าจอนี้ หรือห้องแชท Telegram/LINE)`)) {
        return;
    }

    // Lookup elements
    const syncProgressModal = document.getElementById('sync-progress-modal');
    const closeSyncProgressBtn = document.getElementById('close-sync-progress-btn');
    const syncStatusMessage = document.getElementById('sync-status-message');
    const syncProgressIcon = document.getElementById('sync-progress-icon');
    const syncQrContainer = document.getElementById('sync-qr-container');
    const syncQrImage = document.getElementById('sync-qr-image');

    const stepBrowser = document.getElementById('step-browser');
    const stepAuth = document.getElementById('step-auth');
    const stepDownload = document.getElementById('step-download');
    const stepSync = document.getElementById('step-sync');

    const iconBrowser = document.getElementById('icon-browser');
    const iconAuth = document.getElementById('icon-auth');
    const iconDownload = document.getElementById('icon-download');
    const iconSync = document.getElementById('icon-sync');

    // Reset UI state
    syncProgressModal.classList.remove('hidden');
    closeSyncProgressBtn.disabled = true;
    syncQrContainer.classList.add('hidden');
    syncQrImage.src = '';
    syncStatusMessage.textContent = 'กำลังเริ่มต้นเชื่อมต่อบอท...';
    syncProgressIcon.className = 'fas fa-sync-alt animate-spin text-emerald-500';

    const steps = [stepBrowser, stepAuth, stepDownload, stepSync];
    const icons = [iconBrowser, iconAuth, iconDownload, iconSync];
    const originalIconsHTML = [
        '<i class="fas fa-chrome"></i>',
        '<i class="fas fa-key"></i>',
        '<i class="fas fa-cloud-download-alt"></i>',
        '<i class="fas fa-database"></i>'
    ];

    function resetStepsClasses() {
        steps.forEach(s => s.className = 'flex items-center space-x-3 transition-all duration-300 p-2 rounded-xl');
        icons.forEach((ic, idx) => {
            ic.className = 'w-6 h-6 rounded-full border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] bg-slate-50 dark:bg-slate-800';
            ic.innerHTML = originalIconsHTML[idx];
        });
    }

    function setStepState(activeIdx, status) {
        resetStepsClasses();
        for (let i = 0; i < steps.length; i++) {
            if (i < activeIdx) {
                steps[i].classList.add('step-completed');
                icons[i].className = 'w-6 h-6 rounded-full border border-emerald-500 bg-emerald-500 text-white flex items-center justify-center text-[10px]';
                icons[i].innerHTML = '<i class="fas fa-check"></i>';
            } else if (i === activeIdx) {
                if (status === 'failed') {
                    steps[i].classList.add('step-failed');
                    icons[i].className = 'w-6 h-6 rounded-full border border-red-500 bg-red-500 text-white flex items-center justify-center text-[10px]';
                    icons[i].innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                } else {
                    steps[i].classList.add('step-active');
                    icons[i].className = 'w-6 h-6 rounded-full border border-emerald-500 bg-emerald-500 text-white flex items-center justify-center text-[10px] animate-pulse';
                }
            }
        }
    }

    let pollInterval = null;

    // Bind Close Button action
    const handleClose = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        syncProgressModal.classList.add('hidden');
        closeSyncProgressBtn.removeEventListener('click', handleClose);
    };
    closeSyncProgressBtn.addEventListener('click', handleClose);

    // Call API to trigger sync
    try {
        const response = await api.triggerPortalSync(visitDate, appState.token);
        if (response.status === 409) {
            alert(response.data.message || 'ระบบกำลังทำงานอยู่แล้ว');
            syncProgressModal.classList.add('hidden');
            return;
        }

        if (!response.ok) {
            syncStatusMessage.textContent = response.data.message || 'เกิดข้อผิดพลาดในการเริ่มต้นดาวน์โหลดรายงาน';
            syncProgressIcon.className = 'fas fa-exclamation-triangle text-red-500';
            closeSyncProgressBtn.disabled = false;
            return;
        }

        // Start status polling
        pollInterval = setInterval(async () => {
            try {
                const statusRes = await api.fetchSyncStatus(appState.token);
                if (!statusRes.ok) return;

                const data = statusRes.data;
                syncStatusMessage.textContent = data.message || 'กำลังประมวลผล...';

                // Map step string to index
                let activeIdx = 0;
                if (data.step === 'starting_browser') {
                    activeIdx = 0;
                } else if (data.step === 'checking_session' || data.step === 'session_found' || data.step === 'generating_qr' || data.step === 'waiting_thaid_scan' || data.step === 'auth_success') {
                    activeIdx = 1;
                } else if (data.step === 'navigating_report' || data.step === 'searching_data' || data.step === 'downloading_file' || data.step === 'download_complete') {
                    activeIdx = 2;
                } else if (data.step === 'importing_database' || data.step === 'cross_checking' || data.step === 'completed') {
                    activeIdx = 3;
                }

                setStepState(activeIdx, data.status);

                // Handle ThaiD QR display
                if (data.step === 'waiting_thaid_scan' && data.qrCodeUrl) {
                    syncQrImage.src = data.qrCodeUrl;
                    syncQrContainer.classList.remove('hidden');
                } else {
                    syncQrContainer.classList.add('hidden');
                }

                // Handle termination (success or failed)
                if (data.status === 'idle') {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    syncProgressIcon.className = 'fas fa-exclamation-triangle text-yellow-500';
                    syncStatusMessage.textContent = 'เซิร์ฟเวอร์รีสตาร์ทหรือกระบวนการซิงก์ถูกรีเซ็ต กรุณาลองใหม่อีกครั้ง';
                    closeSyncProgressBtn.disabled = false;
                } else if (data.status === 'success') {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    syncProgressIcon.className = 'fas fa-check-circle text-emerald-500';
                    setStepState(4, 'success');
                    closeSyncProgressBtn.disabled = false;
                    loadDashboardData();
                    loadWeeklySummary();
                } else if (data.status === 'failed') {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    syncProgressIcon.className = 'fas fa-times-circle text-red-500';
                    setStepState(activeIdx, 'failed');
                    closeSyncProgressBtn.disabled = false;
                }
            } catch (err) {
                console.error('Error polling sync status:', err);
            }
        }, 1500);

    } catch (error) {
        console.error('Auto portal sync error:', error);
        syncStatusMessage.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์';
        syncProgressIcon.className = 'fas fa-exclamation-triangle text-red-500';
        closeSyncProgressBtn.disabled = false;
    }
}

// --- Workflow Consolidation (Sync & Process) ---
async function handlePasteSync() {
    const visitDate = visitDateInput.value;
    if (!visitDate) {
        alert('กรุณาเลือกวันที่ต้องการตรวจสอบก่อน');
        return;
    }

    try {
        const text = await navigator.clipboard.readText();
        if (!text || text.trim() === '') {
            alert('ไม่พบข้อมูลใน Clipboard กรุณา Copy ข้อมูลจากหน้าเว็บ สปสช. ก่อน');
            return;
        }

        const jsonData = parseTSV(text);
        if (jsonData.length === 0) {
            alert('ไม่สามารถอ่านข้อมูลได้ กรุณาตรวจสอบว่า Copy ตารางมาถูกต้องหรือไม่');
            return;
        }

        if (confirm(`พบข้อมูล ${jsonData.length} รายการ ต้องการ Sync หรือไม่?`)) {
            ui.setLoading(true);
            const response = await api.processSyncJson(visitDate, jsonData, appState.token);
            if (handleApiResponse(response)) {
                await loadDashboardData();
                loadWeeklySummary();
                alert(response.data.message || 'นำเข้าข้อมูลสำเร็จ');
            } else if (response.status !== 401 && response.status !== 403) {
                alert(response.data.message || 'เกิดข้อผิดพลาดในการประมวลผล');
            }
        }
    } catch (err) {
        console.error('Paste error:', err);
        alert('ไม่สามารถเข้าถึง Clipboard ได้ หรือรูปแบบข้อมูลไม่ถูกต้อง');
    } finally {
        ui.setLoading(false);
    }
}

function parseTSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 1) return [];

    // หาแถวที่เป็น Header โดยมองหาคำสำคัญ เช่น 'เลขบัตร' หรือ 'CLAIM CODE'
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('เลขบัตร') || lines[i].includes('CLAIM CODE') || lines[i].includes('CID')) {
            headerIndex = i;
            break;
        }
    }

    // ถ้าไม่เจอ Header ให้เดาว่าแถวแรกเป็น Header
    if (headerIndex === -1) headerIndex = 0;

    const headers = lines[headerIndex].split('\t').map(h => h.trim());
    const results = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cells = lines[i].split('\t');
        if (cells.length < headers.length * 0.5) continue; // ข้ามแถวที่ดูเหมือนไม่ใช่ข้อมูล

        const row = {};
        headers.forEach((header, index) => {
            if (header) {
                row[header] = (cells[index] || '').trim();
            }
        });
        results.push(row);
    }
    return results;
}

async function handleSyncProcess() {
    const visitDate = visitDateInput.value;
    const file = excelFileInput.files[0];

    if (!visitDate || !file) {
        alert('กรุณาเลือกวันที่และอัปโหลดไฟล์ Excel');
        return;
    }

    const excelMapping = await ensureExcelMapping();
    if (!excelMapping) return;

    ui.setLoading(true);
    try {
        let response = await api.processSync(visitDate, file, appState.token, excelMapping);
        if (response.status === 422) {
            ui.setLoading(false);
            const updatedMapping = await openExcelMappingModal(response.data, response.data.message);
            if (!updatedMapping) return;
            ui.setLoading(true);
            response = await api.processSync(visitDate, file, appState.token, updatedMapping);
        }
        if (handleApiResponse(response)) {
            // โหลดข้อมูลล่าสุดมาแสดงในตาราง
            await loadDashboardData();
            loadWeeklySummary();
            alert(response.data.message || 'ซิงก์ข้อมูลสำเร็จ');
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการประมวลผล');
        }
    } catch (error) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

function openQuickSyncModal() {
    const modal = document.getElementById('quick-sync-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeQuickSyncModal() {
    const modal = document.getElementById('quick-sync-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.getElementById('quick-sync-form')?.reset();
    }
}

async function handleQuickSyncSubmit(e) {
    e.preventDefault();
    const fileInput = document.getElementById('quick-import-file');
    const file = fileInput?.files?.[0];
    if (!file) {
        alert('กรุณาเลือกไฟล์ก่อนทำการ Sync');
        return;
    }

    const submitBtn = document.getElementById('quick-sync-submit-btn');
    const syncIcon = document.getElementById('quick-sync-icon');

    try {
        if (submitBtn) submitBtn.disabled = true;
        if (syncIcon) syncIcon.classList.add('animate-spin');

        if (excelFileInput) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            excelFileInput.files = dataTransfer.files;
        }

        await handleFileSelection(file);
        closeQuickSyncModal();
        await handleSyncProcess();
    } catch (error) {
        console.error('Quick Sync Error:', error);
        alert('เกิดข้อผิดพลาดในการประมวลผล Sync');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (syncIcon) syncIcon.classList.remove('animate-spin');
    }
}

async function loadWeeklySummary() {
    try {
        const response = await api.fetchSummary(appState.token);
        if (handleApiResponse(response)) {
            ui.renderWeeklySummary(response.data, (selectedDate) => {
                if (domRefs.visitDateInput) domRefs.visitDateInput.value = selectedDate;
                loadDashboardData();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    } catch (error) {
        console.error('Failed to load weekly summary:', error);
    }
}

async function loadDashboardData(isSilent = false) {
    const date = domRefs.visitDateInput?.value;
    if (!date) return;

    if (!isSilent) {
        ui.setLoading(true);
    }
    try {
        const [dashboardRes, rightsRes] = await Promise.all([
            api.fetchDashboard(date, appState.token),
            api.fetchRightsTrackingTable(date, appState.token).catch(err => {
                console.error('Failed to load rights tracking table:', err);
                return null;
            })
        ]);

        if (handleApiResponse(dashboardRes)) {
            const data = dashboardRes.data;
            appState.disableNotifications = data.disableNotifications;

            appState.rawTableData = data.trackingData || [];
            appState.hosxpStats = data.hosxpStats || null;

            if (rightsRes && rightsRes.ok && rightsRes.data?.rows) {
                appState.lgoTableData = (rightsRes.data.rows || []).map(row => ({
                    ...row,
                    issue_reason: getTrackingIssueReason(row),
                    color_status: row.check_claimcode === 'ตรง'
                        ? 'GREEN'
                        : row.check_claimcode === 'ตรวจสอบ'
                            ? 'YELLOW'
                            : 'RED'
                }));
            } else {
                appState.lgoTableData = [];
            }

            appState.trackerCurrentPage = 1;
            renderTrackerTable();
            if (appState.lgoTableData.length > 0) {
                ui.renderLgoTrackingTable(appState.lgoTableData);
            }
            await loadGroupInsights(date);
        }
    } catch (error) {
        console.error('Fetch error:', error);
    } finally {
        if (!isSilent) {
            ui.setLoading(false);
        }
    }
}

async function loadRightsTrackingTable(date = domRefs.visitDateInput?.value) {
    if (!date || !appState.token) return;

    try {
        const response = await api.fetchRightsTrackingTable(date, appState.token);
        if (handleApiResponse(response)) {
            appState.lgoTableData = (response.data?.rows || []).map(row => ({
                ...row,
                issue_reason: getTrackingIssueReason(row),
                color_status: row.check_claimcode === 'ตรง'
                    ? 'GREEN'
                    : row.check_claimcode === 'ตรวจสอบ'
                        ? 'YELLOW'
                        : 'RED'
            }));
            renderTrackerTable();
            ui.renderLgoTrackingTable(appState.lgoTableData);
        }
    } catch (error) {
        console.error('Failed to load rights tracking table:', error);
        appState.lgoTableData = [];
        ui.renderTable([], appState.trackerSortBy, appState.trackerSortDesc);
        ui.renderLgoTrackingTable([]);
    }
}

// Inline fallback for tracking issue logic to avoid circular dependency
function getTrackerStatusKey(item = {}) {
    const status = String(item.check_claimcode || '').trim();
    if (status === 'ยังไม่ได้นำเข้า') return 'not_imported';
    if (status === 'ยังไม่เปิด Authen') return 'no_auth';
    if (status === 'ไม่ตรง') return 'mismatch';
    if (status === 'ตรวจสอบ') return 'duplicate';
    if (status === 'ตรง') return 'matched';
    if (item.color_status === 'GREEN') return 'matched';
    if (item.color_status === 'YELLOW') return 'duplicate';
    return 'not_imported';
}

function getTrackingIssueReason(item = {}) {
    switch (getTrackerStatusKey(item)) {
        case 'not_imported':
            return 'ไม่มีข้อมูลนำเข้าใน Temp Authen';
        case 'no_auth':
            return 'มีข้อมูลนำเข้าแล้ว แต่ Auth Code (HOS) ว่าง';
        case 'mismatch':
            return 'Claim Code HOS ไม่ตรงกับ Temp Authen';
        case 'duplicate':
            return 'CID เดียวมีหลาย VN ในวันเดียวกัน';
        case 'matched':
            return 'ข้อมูลตรง ไม่ต้องแก้ไข';
        default:
            return 'รอตรวจสอบข้อมูล';
    }
}

async function loadGroupInsights(date = domRefs.visitDateInput?.value) {
    if (!date || !appState.token) return;

    try {
        const hipdataCode = document.getElementById('query-hipdata')?.value || "'OFC','UCS','OTH','BMT','XXX','LGO','STP','SSS','SSI','A2','BKK','PTY','A9'";
        const response = await api.fetchGroupInsights(date, appState.token, appState.groupInsightsBy, hipdataCode);
        if (handleApiResponse(response)) {
            ui.renderGroupInsights(response.data, (item) => handleGroupInsightDepartmentClick(item, callbacks));
        }
    } catch (error) {
        console.error('Failed to load group insights:', error);
    }
}

async function refreshGroupInsights() {
    const refreshBtn = document.getElementById('uc-insight-refresh-btn');
    const refreshIcon = document.getElementById('uc-insight-refresh-icon');
    if (!refreshBtn || !refreshIcon) return;
    
    refreshIcon.classList.add('fa-spin');
    refreshBtn.disabled = true;
    
    try {
        await loadGroupInsights();
    } catch (err) {
        console.error('Failed to refresh group insights:', err);
    } finally {
        setTimeout(() => {
            refreshIcon.classList.remove('fa-spin');
            refreshBtn.disabled = false;
        }, 600);
    }
}

function handleGroupInsightsToggle(groupBy) {
    if (!['department', 'subdistrict'].includes(groupBy)) return;
    appState.groupInsightsBy = groupBy;
    localStorage.setItem('group_insights_by', groupBy);
    loadGroupInsights();
}

async function loadLiveDashboardData() {
    const date = domRefs.visitDateInput?.value || new Date().toISOString().split('T')[0];
    if (!appState.token) return;

    try {
        ui.updateLiveRefreshState('syncing');
        const response = await api.fetchLiveDashboardData(date, appState.token);
        if (handleApiResponse(response)) {
            const tambonRes = await api.fetchVisitsTodayByTambon(appState.token);
            if (tambonRes.ok) {
                response.data.tambonVisits = tambonRes.data;
            }
            ui.renderLiveDashboard(response.data, appState.token);
            ui.initTiltEffect();
            ui.updateLiveRefreshState('success');
        } else {
            ui.updateLiveRefreshState('failed');
        }
    } catch (error) {
        console.error('❌ Failed to load live dashboard data:', error);
        ui.updateLiveRefreshState('failed');
    }
}

function updateLiveAutoRefreshUi(isActive = true) {
    ui.updateLiveAutoRefresh({
        isActive,
        intervalMs: LIVE_DASHBOARD_REFRESH_MS,
        nextRefreshAt: appState.liveDashboardNextRefreshAt
    });
}

function stopLiveDashboardAutoRefresh() {
    if (appState.liveDashboardInterval) {
        clearInterval(appState.liveDashboardInterval);
        appState.liveDashboardInterval = null;
    }
    if (appState.liveDashboardCountdownInterval) {
        clearInterval(appState.liveDashboardCountdownInterval);
        appState.liveDashboardCountdownInterval = null;
    }
    appState.liveDashboardNextRefreshAt = null;
    updateLiveAutoRefreshUi(false);
}

function startLiveDashboardAutoRefresh() {
    stopLiveDashboardAutoRefresh();
    appState.liveDashboardNextRefreshAt = Date.now() + LIVE_DASHBOARD_REFRESH_MS;
    updateLiveAutoRefreshUi(true);

    appState.liveDashboardCountdownInterval = setInterval(() => updateLiveAutoRefreshUi(true), 1000);
    appState.liveDashboardInterval = setInterval(() => {
        appState.liveDashboardNextRefreshAt = Date.now() + LIVE_DASHBOARD_REFRESH_MS;
        updateLiveAutoRefreshUi(true);
        loadLiveDashboardData();
    }, LIVE_DASHBOARD_REFRESH_MS);
}

function handleLiveAutoToggle() {
    if (appState.liveDashboardInterval) {
        stopLiveDashboardAutoRefresh();
    } else {
        startLiveDashboardAutoRefresh();
    }
}

function setupBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btn.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
            btn.classList.add('opacity-100', 'translate-y-0');
        } else {
            btn.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
            btn.classList.remove('opacity-100', 'translate-y-0');
        }
    });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function applyLiveTvMode(isEnabled) {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('tv-mode', isEnabled);
    const tvBtn = document.getElementById('live-tv-toggle');
    if (tvBtn) {
        tvBtn.classList.toggle('is-active', isEnabled);
        const icon = tvBtn.querySelector('i');
        const label = tvBtn.querySelector('span');
        if (icon) icon.className = isEnabled ? 'fas fa-desktop' : 'fas fa-tv';
        if (label) label.textContent = isEnabled ? 'ออกจาก TV Mode' : 'TV Mode';
    }
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('live_tv_mode', isEnabled ? 'true' : 'false');
    }
}

function handleLiveTvToggle() {
    appState.isTvMode = !appState.isTvMode;
    applyLiveTvMode(appState.isTvMode);
}

function updateFullscreenButton() {
    const button = document.getElementById('live-fullscreen-btn');
    if (!button) return;
    const icon = button.querySelector('i');
    const label = button.querySelector('span');
    const isFullscreen = Boolean(document.fullscreenElement);
    if (icon) icon.className = isFullscreen ? 'fas fa-compress' : 'fas fa-expand';
    if (label) label.textContent = isFullscreen ? 'ออกเต็มจอ' : 'เต็มจอ';
}

async function handleLiveFullscreen() {
    const target = document.getElementById('dashboard-section') || document.documentElement;
    try {
        if (!document.fullscreenElement) {
            await target.requestFullscreen();
            if (!appState.isTvMode) {
                appState.isTvMode = true;
                applyLiveTvMode(true);
            }
        } else {
            await document.exitFullscreen();
        }
        updateFullscreenButton();
    } catch (error) {
        console.error('Fullscreen request failed:', error);
    }
}

function handleTabSwitch(tabId) {
    if (tabId === 'tab-live-dashboard') return;
    stopLiveDashboardAutoRefresh();

    const doSwitch = () => {
        ui.switchTab(tabId);

        if (tabId === 'tab-live-dashboard') {
            loadLiveDashboardData();
            stopLiveDashboardAutoRefresh();
        } else if (tabId === 'tab-grafana') {
            const dateInput = document.getElementById('query-visit-date');
            if (!dateInput.value) {
                dateInput.value = domRefs.visitDateInput?.value || new Date().toISOString().split('T')[0];
            }
            loadSavedQueries();
            loadQueryHistory();
            loadHipdataCodes();
        } else if (tabId === 'tab-admin') {
            handleAdminSubtabSwitch('users');
        }
    };

    doSwitch();
}

window.filterDashboardByTambon = function (codeOrName) {
    const tambonNames = {
        'T01': 'ไทรเดี่ยว',
        'T02': 'ไทรทอง',
        'T03': 'เบญจขร',
        'T04': 'ซับมะกรูด',
        'T05': 'คลองหาด',
        'T06': 'ไทยอุดม',
        'T07': 'คลองไก่เถื่อน',
        '270501': 'คลองหาด',
        '270502': 'ไทยอุดม',
        '270503': 'ซับมะกรูด',
        '270504': 'ไทรเดี่ยว',
        '270505': 'ไทรทอง',
        '270506': 'คลองไก่เถื่อน',
        '270507': 'เบญจขร'
    };
    const name = tambonNames[codeOrName] || codeOrName;
    if (!name) return;
    applyTrackerDashboardFilter('tambon', name, `ตำบล ${name}`, {}, callbacks);
};

window.filterTrackerByDepartment = function (departmentName) {
    if (!departmentName) return;
    applyTrackerDashboardFilter('department', departmentName, `แผนก ${departmentName}`, {}, callbacks);
};

// Boot Application
init();
