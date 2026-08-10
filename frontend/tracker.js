// tracker.js
import { api } from './api.js';
import { ui, getClaimStatusPresentation } from './ui.js';
import { appState, domRefs, TRACKER_PAGE_SIZE, TRACKER_COLUMN_FILTERS, activeColumnFilterField } from './state.js';
import { handleApiResponse } from './auth.js';
import { escapeHtml } from './uploader.js';
import { exportToCsv } from './utils.js';

export function closeTrackerColumnFilterMenu() {
    document.getElementById('tracker-column-filter-menu')?.remove();
    activeColumnFilterField.value = null;
}

export function normalizeTrackerColumnValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

export function getTrackerStatusKey(item = {}) {
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

export function getTrackingIssueReason(item = {}) {
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

export function getTrackerColumnValue(item = {}, field) {
    if (field === 'issue_reason') return item.issue_reason || getTrackingIssueReason(item);
    if (field === 'pcode') return item.pcode || item.hipdata_code || item.hipdata || '';
    if (field === 'authCode') return item.authCode || item.Auth_Code || item.auth_code || '';
    if (field === 'nhso_claim_code') return item.nhso_claim_code || item.claimcode || '';
    return item[field];
}

export function getTrackerColumnFilterValues(data = [], field) {
    const valueMap = new Map();
    data.forEach(item => {
        const value = normalizeTrackerColumnValue(getTrackerColumnValue(item, field));
        const label = value || '(ว่าง)';
        valueMap.set(value, label);
    });

    return Array.from(valueMap, ([value, label]) => ({ value, label }))
        .sort((a, b) => {
            if (a.value === '') return -1;
            if (b.value === '') return 1;
            return a.label.localeCompare(b.label, 'th');
        });
}

export function openTrackerColumnFilterMenu(field, anchor) {
    const rows = appState.lgoTableData.length > 0 ? appState.lgoTableData : appState.rawTableData;
    const values = getTrackerColumnFilterValues(rows, field);
    const meta = TRACKER_COLUMN_FILTERS.find(item => item.field === field);
    const existingFilter = appState.trackerColumnFilters[field];
    const selectedValues = new Set(Array.isArray(existingFilter) ? existingFilter : values.map(item => item.value));

    if (activeColumnFilterField.value === field) {
        closeTrackerColumnFilterMenu();
        return;
    }
    closeTrackerColumnFilterMenu();
    activeColumnFilterField.value = field;

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
        appState.trackerCurrentPage = 1;
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
        appState.trackerCurrentPage = 1;
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

export function setupTrackerColumnFilters() {
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

export function getFilteredAndSortedTrackerData() {
    let data = [...appState.rawTableData];

    const dashboardFilter = appState.trackerDashboardFilter;
    if (dashboardFilter?.value) {
        const query = dashboardFilter.value.toLowerCase();
        if (dashboardFilter.type === 'status') {
            data = data.filter(item => String(item.color_status || '').toLowerCase() === query);
        } else {
            const fields = dashboardFilter.type === 'department'
                ? ['department']
                : dashboardFilter.type === 'right'
                    ? ['pttype_note', 'pttype', 'pcode']
                    : ['subdistrict_name', 'tambon_name', 'subdistrict_code', 'tambon_code'];

            data = data.filter(item => fields.some(field => {
                const value = String(item[field] || '').toLowerCase();
                if (!value) return false;
                return value === query || value.includes(query) || query.includes(value);
            }));
        }

        if (dashboardFilter.mode === 'uc-pending') {
            data = data.filter(item =>
                String(item.pcode || '').toUpperCase() === 'UC'
                && ['RED', 'YELLOW'].includes(String(item.color_status || '').toUpperCase())
            );
        } else if (dashboardFilter.mode === 'uc-debtor') {
            data = data.filter(item =>
                String(item.pcode || '').toUpperCase() === 'UC'
                && Number(item.uc_money || 0) > 0
            );
        }
    }

    const searchFilter = appState.trackerSearchFilter;
    if (searchFilter) {
        const query = searchFilter.toLowerCase();
        data = data.filter(item => {
            return Object.values(item).some(val =>
                String(val || '').toLowerCase().includes(query)
            );
        });
    }

    const sortBy = appState.trackerSortBy;
    const sortDesc = appState.trackerSortDesc;
    if (sortBy) {
        data.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];

            if (valA !== null && valB !== null && !isNaN(valA) && !isNaN(valB) && String(valA).trim() !== '' && String(valB).trim() !== '') {
                valA = Number(valA);
                valB = Number(valB);
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            if (valA < valB) return sortDesc ? 1 : -1;
            if (valA > valB) return sortDesc ? -1 : 1;
            return 0;
        });
    }
    return data;
}

export function getSortedLgoTableData() {
    const data = [...appState.lgoTableData];
    const sortBy = appState.trackerSortBy;
    const sortDesc = appState.trackerSortDesc;

    if (sortBy) {
        data.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];

            if (valA !== null && valB !== null && !isNaN(valA) && !isNaN(valB) && String(valA).trim() !== '' && String(valB).trim() !== '') {
                valA = Number(valA);
                valB = Number(valB);
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            if (valA < valB) return sortDesc ? 1 : -1;
            if (valA > valB) return sortDesc ? -1 : 1;
            return 0;
        });
    }

    return data;
}

export function applyTrackerColumnFilters(data = []) {
    const filters = Object.entries(appState.trackerColumnFilters || {})
        .filter(([, values]) => Array.isArray(values));
    if (!filters.length) return data;

    return data.filter(item => filters.every(([field, values]) => {
        const value = normalizeTrackerColumnValue(getTrackerColumnValue(item, field));
        return values.includes(value);
    }));
}

export function updateTrackerColumnFilterHeaders() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.tracker-column-filter-btn').forEach(button => {
        const field = button.dataset.columnFilter;
        const isActive = Array.isArray(appState.trackerColumnFilters?.[field]);
        button.className = isActive
            ? 'tracker-column-filter-btn shrink-0 text-blue-600 dark:text-blue-300 transition cursor-pointer'
            : 'tracker-column-filter-btn shrink-0 text-slate-400 hover:text-blue-600 dark:hover:text-blue-300 transition cursor-pointer';
    });
}

export function renderTrackerTable() {
    const data = getFilteredAndSortedTrackerData();
    const baseTableData = appState.lgoTableData.length > 0 ? getSortedLgoTableData() : data;
    const columnFilteredData = applyTrackerColumnFilters(baseTableData);
    const tableData = columnFilteredData;
    const hasColumnFilters = Object.values(appState.trackerColumnFilters || {}).some(values => Array.isArray(values));
    const hasFilters = Boolean(appState.trackerDashboardFilter?.value || appState.trackerSearchFilter || hasColumnFilters);
    ui.renderTable(tableData, appState.trackerSortBy, appState.trackerSortDesc, appState.trackerCurrentPage, TRACKER_PAGE_SIZE);
    ui.renderTrackerDashboardFilter(appState.trackerDashboardFilter, data.length);
    updateTrackerColumnFilterHeaders();
    ui.updateStats(data, hasFilters ? null : appState.hosxpStats);
    ui.initTiltEffect();
}

export function revealTrackerResults() {
    if (typeof document === 'undefined') return;
    const table = document.getElementById('tracker-results');
    if (!table) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    table.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

export function announceTrackerFilterResult() {
    if (typeof document === 'undefined') return;
    const announcement = document.getElementById('tracker-filter-result-announcement');
    if (!announcement) return;
    const count = getFilteredAndSortedTrackerData().length;
    const filter = appState.trackerDashboardFilter;
    announcement.textContent = filter?.value
        ? `กรอง ${filter.label || filter.value} พบ ${count.toLocaleString()} รายการ`
        : `แสดงข้อมูลทั้งหมด ${count.toLocaleString()} รายการ`;
}

export async function applyTrackerDashboardFilter(type, value, label = value, options = {}, onLoadCallbackObj) {
    if (!value) return;
    appState.trackerDashboardFilter = { type, value, label, ...options };
    appState.trackerSearchFilter = '';
    appState.trackerCurrentPage = 1;

    const searchInput = document.getElementById('tracker-search-input');
    if (searchInput) searchInput.value = '';

    if (onLoadCallbackObj && typeof onLoadCallbackObj.handleTabSwitch === 'function') {
        onLoadCallbackObj.handleTabSwitch('tab-tracker');
    }
    if (appState.rawTableData.length === 0) {
        if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
            await onLoadCallbackObj.loadDashboardData();
        }
    } else {
        renderTrackerTable();
    }
    announceTrackerFilterResult();
    requestAnimationFrame(revealTrackerResults);
}

export function handleGroupInsightDepartmentClick(item, onLoadCallbackObj) {
    if (!item?.groupKey && !item?.rightName) return;
    const mode = item.mode === 'debtor' ? 'uc-debtor' : 'uc-pending';
    if (item.rightName) {
        applyTrackerDashboardFilter('right', item.rightName, item.label || `สิทธิ ${item.rightName}`, { mode }, onLoadCallbackObj);
        return;
    }
    const type = item.groupBy === 'subdistrict' ? 'tambon' : 'department';
    applyTrackerDashboardFilter(type, item.groupKey, item.label || `${item.groupLabel || 'กลุ่ม'} ${item.groupKey}`, { mode }, onLoadCallbackObj);
}

export async function openUcPendingListModal() {
    const dialog = document.getElementById('uc-pending-list-dialog');
    const tbody = document.getElementById('uc-pending-list-tbody');
    const emptyState = document.getElementById('uc-pending-list-empty');
    if (!dialog || !tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i> กำลังโหลดข้อมูล...</td></tr>';
    emptyState?.classList.add('hidden');

    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }

    let pendingUcData = [];
    try {
        const date = domRefs.visitDateInput?.value || new Date().toISOString().split('T')[0];
        const response = await api.fetchRightsTrackingTable(date, appState.token);
        if (response.ok && response.data) {
            const liveRows = (response.data.rows || []).map(row => ({
                ...row,
                color_status: String(row.check_claimcode).toUpperCase() === 'ตรง' ? 'GREEN' : 'RED',
                issue_reason: row.check_claimcode === 'ตรง' ? 'ข้อมูลถูกต้องเรียบร้อยแล้ว' : 
                             (row.check_claimcode === 'ยังไม่ได้นำเข้า' ? 'ไม่มีข้อมูลการส่ง Claim ใน Temp-Authen' : 'ข้อมูลผิดพลาดหรือซ้ำซ้อน')
            }));

            pendingUcData = liveRows.filter(item => {
                const pcode = String(item.pcode || item.hipdata_code || item.hipdata || '').toUpperCase();
                const ucMoney = Number(item.uc_money) || Number(item.item_money) || 0;
                const authenType = String(item.authen_code_type || item.pttype_note || '').toUpperCase().trim();
                const isAuthencodeOrEmpty = authenType === 'AUTHENCODE' || authenType === '';
                
                return ['UC', 'UCS'].includes(pcode) && 
                       ucMoney > 0 && 
                       isAuthencodeOrEmpty;
            });
        }
    } catch (err) {
        console.error('Failed to fetch real-time tracking data for modal:', err);
    }

    const titleEl = document.getElementById('uc-pending-list-title');
    if (titleEl) {
        titleEl.textContent = `รายการ UCS ที่ต้องติดตาม (ทั้งหมด ${pendingUcData.length.toLocaleString()} รายการ)`;
    }

    tbody.innerHTML = '';
    if (pendingUcData.length === 0) {
        emptyState?.classList.remove('hidden');
    } else {
        emptyState?.classList.add('hidden');
        pendingUcData.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200';
            
            const checkClaimVal = item.check_claimcode || 'ยังไม่ได้นำเข้า';
            const checkClaimPresentation = getClaimStatusPresentation(checkClaimVal);
            const issueReason = item.issue_reason || getTrackingIssueReason(item);

            tr.innerHTML = `
                <td class="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(item.vn || '-')}</td>
                <td class="py-2.5 px-3 font-medium tracking-wide">${escapeHtml(item.cid || '-')}</td>
                <td class="py-2.5 px-3">${escapeHtml(item.full_name || '-')}</td>
                <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400">${escapeHtml(item.department || '-')}</td>
                <td class="py-2.5 px-3 text-right font-semibold">${(() => {
                    const uc = Number(item.uc_money) || 0;
                    const im = Number(item.item_money) || 0;
                    const val = uc === 0 ? im : uc;
                    return Math.round(val).toLocaleString();
                })()}</td>
                <td class="py-2.5 px-3 text-center">
                    <span class="status-badge status-${checkClaimPresentation.tone} px-2 py-0.5 text-[10px]">
                        <i class="fas ${checkClaimPresentation.icon}"></i>
                        <span>${escapeHtml(checkClaimPresentation.label)}</span>
                    </span>
                </td>
                <td class="py-2.5 px-3 text-[11px] font-semibold status-text-${checkClaimPresentation.tone}">${escapeHtml(issueReason || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

export function clearTrackerDashboardFilter() {
    appState.trackerDashboardFilter = null;
    appState.trackerCurrentPage = 1;
    renderTrackerTable();
    announceTrackerFilterResult();
    requestAnimationFrame(revealTrackerResults);
}

export function handleExportErrors() {
    if (!appState.rawTableData || appState.rawTableData.length === 0) return;

    const errorData = appState.rawTableData.filter(item =>
        item.color_status === 'RED' || item.color_status === 'YELLOW'
    );

    if (errorData.length === 0) {
        alert("ไม่มีรายการที่ต้องแก้ไข (ทุกรายการเป็นสีเขียว)");
        return;
    }

    const exportData = errorData.map(item => ({
        'วันที่รับบริการ': item.visit_date.split('T')[0],
        'VN': item.vn,
        'เลขบัตรประชาชน': item.cid,
        'ชื่อ-สกุล': item.full_name,
        'สิทธิ (HOSxP)': item.pttype,
        'Authen Code': item.nhso_authen_code || 'ไม่มี',
        'สถานะ': item.color_status === 'RED' ? 'ยังไม่เปิด Authen' : 'รอปิด Endpoint'
    }));

    const dateStr = domRefs.visitDateInput?.value || new Date().toISOString().split('T')[0];
    exportToCsv(`NHSO_Error_Report_${dateStr}.csv`, exportData);
}
