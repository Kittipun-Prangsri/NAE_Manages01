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
// --- Quick Sync Modal Handlers ---


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
