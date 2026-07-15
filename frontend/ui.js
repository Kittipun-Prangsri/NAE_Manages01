// Cache for Khlong Hat geojson map
let geojsonCache = null;

// DOM Elements - Safely initialized on demand
const getEls = () => {
    if (typeof document === 'undefined') return {};
    return {
        loginSection: document.getElementById('login-section'),
        dashboardSection: document.getElementById('dashboard-section'),
        userDisplay: document.getElementById('user-display'),
        loginError: document.getElementById('login-error'),
        loadingOverlay: document.getElementById('loading-overlay'),
        dropzoneText: document.getElementById('dropzone-text'),
        dropzone: document.getElementById('dropzone'),
        tableBody: document.getElementById('tracking-table-body'),
        noDataMsg: document.getElementById('no-data'),
        statTotal: document.getElementById('stat-total'),
        statRed: document.getElementById('stat-red'),
        statYellow: document.getElementById('stat-yellow'),
        statGreen: document.getElementById('stat-green'),
        statUcCount: document.getElementById('stat-uc-count'),
        statUcMoney: document.getElementById('stat-uc-money'),
        exportBtn: document.getElementById('export-error-btn'),
        adminViewContainer: document.getElementById('admin-view-container'),
        adminUserTableBody: document.getElementById('admin-user-table-body'),
        tabAdmin: document.getElementById('tab-admin'),
        adminSubtabUsers: document.getElementById('admin-subtab-users'),
        adminSubtabSchedules: document.getElementById('admin-subtab-schedules'),
        adminSubviewUsers: document.getElementById('admin-subview-users'),
        adminSubviewSchedules: document.getElementById('admin-subview-schedules'),
        adminScheduleTableBody: document.getElementById('admin-schedule-table-body'),
        addScheduleForm: document.getElementById('add-schedule-form'),
        newScheduleTime: document.getElementById('new-schedule-time')
    };
};

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

function getIssueReason(item = {}) {
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

export const ui = {
    initTheme() {
        if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
        
        const currentTheme = localStorage.getItem('theme') || 'light';
        const isDark = currentTheme === 'dark';
        if (isDark) document.documentElement.classList.add('dark');
        
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) {
            themeIcon.className = isDark ? 'fas fa-sun text-sm' : 'fas fa-moon text-sm';
        }
    },

    initTiltEffect() {
        if (typeof document === 'undefined') return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        if (window.matchMedia?.('(pointer: coarse)').matches) return;

        const cards = document.querySelectorAll('.tilt-card');
        cards.forEach(card => {
            if (card.dataset.tiltBound === 'true') return;
            card.dataset.tiltBound = 'true';

            card.addEventListener('pointermove', e => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const xc = rect.width / 2;
                const yc = rect.height / 2;
                const dx = x - xc;
                const dy = y - yc;
                const tiltX = (dy / yc) * -8;
                const tiltY = (dx / xc) * 8;

                card.classList.add('is-tilting');
                card.style.setProperty('--tilt-x', `${tiltX}deg`);
                card.style.setProperty('--tilt-y', `${tiltY}deg`);
            });

            card.addEventListener('pointerleave', () => {
                card.classList.remove('is-tilting');
                card.style.removeProperty('--tilt-x');
                card.style.removeProperty('--tilt-y');
            });
        });
    },

    toggleTheme() {
        if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;

        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) {
            themeIcon.className = isDark ? 'fas fa-sun text-sm' : 'fas fa-moon text-sm';
        }
    },

    togglePatientList() {
        const content = document.getElementById('patient-list-content');
        const icon = document.getElementById('toggle-list-icon');
        if (!content || !icon) return;
        
        const isCollapsed = content.classList.toggle('hidden');
        if (isCollapsed) {
            icon.style.transform = 'rotate(180deg)';
        } else {
            icon.style.transform = 'rotate(0deg)';
        }
    },

    showLogin(message = '') {
        const els = getEls();
        if (!els.loginSection) return;
        els.loginSection.classList.remove('hidden');
        els.dashboardSection.classList.add('hidden');
        if (message) this.showLoginError(message);
    },

    showDashboard(userName) {
        const els = getEls();
        if (!els.loginSection) return;
        els.loginSection.classList.add('hidden');
        els.dashboardSection.classList.remove('hidden');
        if (els.userDisplay) els.userDisplay.textContent = `สวัสดี, ${userName}`;
        this.startClock();
    },

    startClock() {
        if (typeof document === 'undefined') return;
        
        const timeEl = document.getElementById('clock-time');
        const dateEl = document.getElementById('clock-date');
        if (!timeEl || !dateEl) return;
        
        const update = () => {
            const now = new Date();
            
            // Time: HH:mm:ss
            timeEl.textContent = now.toLocaleTimeString('th-TH', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
            
            // Date: DD MMM YYYY (Thai)
            dateEl.textContent = now.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }).toUpperCase();
        };
        
        update();
        setInterval(update, 1000);
    },

    showLoginError(msg) {
        const els = getEls();
        if (!els.loginError) return;
        els.loginError.textContent = msg;
        els.loginError.classList.remove('hidden');
    },

    setLoading(isLoading) {
        const els = getEls();
        if (!els.loadingOverlay) return;
        if (isLoading) els.loadingOverlay.classList.remove('hidden');
        else els.loadingOverlay.classList.add('hidden');
    },

    updateDropzoneUI(file) {
        const els = getEls();
        if (!els.dropzone || !els.dropzoneText) return;
        if (file) {
            els.dropzoneText.textContent = `ไฟล์ที่เลือก: ${file.name}`;
            els.dropzoneText.className = "text-xs font-bold text-emerald-600 dark:text-emerald-400";
            els.dropzone.classList.add('border-emerald-500', 'bg-emerald-50/50', 'dark:bg-emerald-900/20');
        } else {
            els.dropzoneText.textContent = "ลากวางไฟล์ที่นี่ หรือ คลิกเพื่อเลือก";
            els.dropzoneText.className = "text-xs font-semibold text-slate-600 dark:text-slate-300 truncate";
            els.dropzone.classList.remove('border-emerald-500', 'bg-emerald-50/50', 'dark:bg-emerald-900/20');
        }
    },

    renderTable(data, sortBy = '', sortDesc = false) {
        if (typeof document === 'undefined') return;
        const els = getEls();
        if (!els.tableBody) return;
        
        // Update table headers to show sorting indicators
        const headers = document.querySelectorAll('#tracking-table-thead th[data-sort]');
        headers.forEach(th => {
            const field = th.getAttribute('data-sort');
            th.className = th.className.replace(' text-blue-600 dark:text-blue-400', '');
            const sortIndicator = th.querySelector('[data-sort-indicator]');
            
            if (field === sortBy) {
                if (sortIndicator) sortIndicator.textContent = sortDesc ? '▼' : '▲';
                th.classList.add('text-blue-600', 'dark:text-blue-400');
            } else if (sortIndicator) {
                sortIndicator.textContent = '';
            } else {
                th.textContent = th.textContent.replace(/  [▲▼]/g, '');
            }
        });

        els.tableBody.innerHTML = '';
        if (!data || data.length === 0) {
            if (els.noDataMsg) els.noDataMsg.classList.remove('hidden');
            if (els.exportBtn) els.exportBtn.classList.add('hidden'); // ซ่อนปุ่ม Export หากไม่มีข้อมูล
            return;
        }
        
        if (els.noDataMsg) els.noDataMsg.classList.add('hidden');
        
        // เช็คว่ามีรายการที่ผิดพลาดไหม เพื่อแสดง/ซ่อนปุ่ม Export
        const hasErrors = data.some(item => item.color_status === 'RED' || item.color_status === 'YELLOW');
        if (els.exportBtn) {
            if(hasErrors) els.exportBtn.classList.remove('hidden');
            else els.exportBtn.classList.add('hidden');
        }

        // แสดงผลสูงสุด 50 รายการแรกเพื่อให้ตรวจสอบข้อมูลได้มากขึ้นโดยไม่ทำให้หน้าเว็บหนักเกินไป
        const displayData = data.slice(0, 50);

        displayData.forEach(item => {
            const tr = document.createElement('tr');
            const isGreen = item.color_status === 'GREEN';
            const rowClass = isGreen ? 'bg-emerald-50/20 dark:bg-emerald-900/10' : '';
            tr.className = `hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 ${rowClass}`;

            const checkClaimClass = item.check_claimcode === 'ตรง' ? 'status-green' :
                                  item.check_claimcode === 'ตรวจสอบ' ? 'status-yellow' :
                                  ['ไม่ตรง', 'ยังไม่ได้นำเข้า', 'ยังไม่เปิด Authen'].includes(item.check_claimcode) ? 'status-red' :
                                  'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400';

            const checkClaimVal = item.check_claimcode || 'ยังไม่ได้นำเข้า';
            const issueReason = item.issue_reason || getIssueReason(item);
            const issueClass = item.check_claimcode === 'ตรง'
                ? 'text-emerald-600 dark:text-emerald-400'
                : item.check_claimcode === 'ตรวจสอบ'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400';

            tr.innerHTML = `
                <td class="py-3.5 px-4 font-mono text-xs font-semibold">
                    <span class="text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/30 rounded-lg px-2.5 py-1 inline-block">${item.vn}</span>
                </td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-mono">${item.cid_check || '-'}</td>
                <td class="py-3.5 px-4 text-slate-700 dark:text-slate-200 font-medium tracking-wide">${item.cid}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">${item.pttype || '-'}</td>
                <td class="py-3.5 px-4 text-xs font-medium text-slate-500 dark:text-slate-400">${item.pcode || '-'}</td>
                <td class="py-3.5 px-4 font-mono text-xs text-slate-600">
                    ${item.authCode ? `<span class="bg-slate-100 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 px-2 py-0.5 rounded font-medium dark:text-slate-300">${item.authCode}</span>` : '-'}
                </td>
                <td class="py-3.5 px-4 text-xs text-emerald-600 dark:text-emerald-400 font-bold">${item.claim_code || '-'}</td>
                <td class="py-3.5 px-4 text-xs text-blue-600 dark:text-blue-400 font-bold">${item.nhso_claim_code || '-'}</td>
                <td class="py-3.5 px-4 text-xs text-indigo-500 dark:text-indigo-400 font-semibold">${item.authen_code_type || '-'}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[180px]" title="${item.pttype_note || ''}">${item.pttype_note || '-'}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-medium">${item.staff || '-'}</td>
                <td class="py-3.5 px-4 text-center">
                    <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm leading-none ${checkClaimClass}">
                        ${checkClaimVal}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-xs font-semibold ${issueClass}">${issueReason}</td>
                <td class="py-3.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 text-right">${(item.uc_money != null && !isNaN(item.uc_money)) ? Number(item.uc_money).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-medium">${item.department || '-'}</td>
                <td class="py-3.5 px-4 text-xs text-center text-slate-600 dark:text-slate-300 font-bold">${item.cc_cid ?? '-'}</td>
            `;
            els.tableBody.appendChild(tr);
        });
    },

    renderLgoTrackingTable(rows = []) {
        if (typeof document === 'undefined') return;
        const tableBody = document.getElementById('lgo-tracking-table-body');
        const emptyState = document.getElementById('lgo-table-empty');
        const countEl = document.getElementById('lgo-table-count');
        if (!tableBody) return;

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        if (countEl) countEl.textContent = Number(rows.length || 0).toLocaleString();
        tableBody.innerHTML = '';

        if (!rows.length) {
            emptyState?.classList.remove('hidden');
            return;
        }

        emptyState?.classList.add('hidden');
        rows.forEach(item => {
            const checkClaimClass = item.check_claimcode === 'ตรง'
                ? 'status-green'
                : item.check_claimcode === 'ตรวจสอบ'
                    ? 'status-yellow'
                    : ['ไม่ตรง', 'ยังไม่ได้นำเข้า', 'ยังไม่เปิด Authen'].includes(item.check_claimcode)
                        ? 'status-red'
                        : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400';
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150';
            tr.innerHTML = `
                <td class="py-3.5 px-4 font-mono text-xs font-semibold">
                    <span class="text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/30 rounded-lg px-2.5 py-1 inline-block">${escapeHtml(item.vn || '-')}</span>
                </td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-mono">${escapeHtml(item.cid_check || '-')}</td>
                <td class="py-3.5 px-4 text-slate-700 dark:text-slate-200 font-medium tracking-wide">${escapeHtml(item.cid || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(item.pttype || '-')}</td>
                <td class="py-3.5 px-4 text-xs font-medium text-slate-500 dark:text-slate-400">${escapeHtml(item.pcode || '-')}</td>
                <td class="py-3.5 px-4 font-mono text-xs text-slate-600">${item.authCode ? `<span class="bg-slate-100 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 px-2 py-0.5 rounded font-medium dark:text-slate-300">${escapeHtml(item.authCode)}</span>` : '-'}</td>
                <td class="py-3.5 px-4 text-xs text-emerald-600 dark:text-emerald-400 font-bold">${escapeHtml(item.claim_code || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(item.nhso_claim_code || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-indigo-500 dark:text-indigo-400 font-semibold">${escapeHtml(item.authen_code_type || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[180px]" title="${escapeHtml(item.pttype_note || '')}">${escapeHtml(item.pttype_note || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-medium">${escapeHtml(item.staff || '-')}</td>
                <td class="py-3.5 px-4 text-center">
                    <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm leading-none ${checkClaimClass}">
                        ${escapeHtml(item.check_claimcode || 'ยังไม่ได้นำเข้า')}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 text-right">${(item.uc_money != null && !isNaN(item.uc_money)) ? Number(item.uc_money).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-medium">${escapeHtml(item.department || '-')}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-semibold text-center">${Number(item.cc_cid || 0).toLocaleString()}</td>
            `;
            tableBody.appendChild(tr);
        });
    },

    renderTrackerDashboardFilter(filter, count = 0) {
        if (typeof document === 'undefined') return;
        const banner = document.getElementById('tracker-dashboard-filter-banner');
        const label = document.getElementById('tracker-dashboard-filter-label');
        if (!banner || !label) return;

        if (!filter?.value) {
            banner.classList.add('hidden');
            return;
        }

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        const icon = filter.type === 'department'
            ? 'fa-hospital-user'
            : filter.type === 'right'
                ? 'fa-id-card'
                : 'fa-map-marker-alt';
        label.innerHTML = `<i class="fas ${icon} mr-1"></i> กำลังกรอง: ${escapeHtml(filter.label || filter.value)} (${count.toLocaleString()} รายการ)`;
        banner.classList.remove('hidden');
    },

    updateStats(data, hosxpStats = null) {
        if (!data) return;
        const els = getEls();
        if (!els.statTotal || !els.statRed || !els.statYellow || !els.statGreen || !els.statUcMoney || !els.statUcCount) return;
        
        // Calculate NHSO specific stats from data array
        const red = data.filter(i => i.color_status === 'RED').length;
        const yellow = data.filter(i => i.color_status === 'YELLOW').length;
        const green = hosxpStats && hosxpStats.completedTreatmentEndpointCount !== undefined
            ? Number(hosxpStats.completedTreatmentEndpointCount || 0)
            : data.filter(i => i.color_status === 'GREEN').length;

        // Calculate UC Pending Count (RED + YELLOW and Pcode = 'UC')
        const ucPendingItems = data.filter(i => (i.color_status === 'RED' || i.color_status === 'YELLOW') && String(i.pcode).toUpperCase() === 'UC');
        const ucPendingCount = ucPendingItems.length;

        // Calculate Outstanding UC Money
        const outstandingUcMoney = ucPendingItems.reduce((sum, item) => sum + (Number(item.uc_money) || 0), 0);

        // Use HOSxP Stats for total persons/visits
        if (hosxpStats) {
            els.statTotal.innerHTML = `${hosxpStats.totalPersons} <span class="text-lg text-gray-400">/ ${hosxpStats.totalVisits}</span>`;
        } else {
            const uniquePersons = new Set(data.map(i => i.cid)).size;
            const totalVisits = data.length;
            els.statTotal.innerHTML = `${uniquePersons} <span class="text-lg text-gray-400">/ ${totalVisits}</span>`;
        }

        els.statUcCount.textContent = ucPendingCount;
        els.statUcMoney.textContent = outstandingUcMoney.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        els.statRed.textContent = red;
        els.statYellow.textContent = yellow;
        els.statGreen.textContent = green;
    },

    renderGroupInsights(insights, onDepartmentClick) {
        if (typeof document === 'undefined') return;

        const section = document.getElementById('group-insights-section');
        const pendingList = document.getElementById('uc-pending-group-list');
        const debtorList = document.getElementById('uc-debtor-group-list');
        const pendingTotalCount = document.getElementById('uc-pending-total-count');
        const debtorTotalMoney = document.getElementById('uc-debtor-total-money');
        const serviceTotalCount = document.getElementById('uc-service-total-count');
        const serviceSparkline = document.querySelector('.uc-sparkline');
        const notImportedCount = document.getElementById('uc-not-imported-count');
        const rightGrid = document.getElementById('uc-right-grid');
        const updatedAt = document.getElementById('uc-insight-updated-at');
        const description = document.getElementById('group-insights-description');
        const pendingTitle = document.getElementById('uc-pending-group-title');
        const pendingSubtitle = document.getElementById('uc-pending-group-subtitle');
        const debtorTitle = document.getElementById('uc-debtor-group-title');
        const debtorSubtitle = document.getElementById('uc-debtor-group-subtitle');
        const groupHeaderLabel = document.getElementById('uc-group-header-label');
        if (!section || !pendingList || !debtorList) return;

        const pendingRows = insights?.ucPendingByDepartment || [];
        const debtorRows = insights?.ucDebtorByDepartment || [];
        const pendingTotal = insights?.totals?.ucPending || { count: 0, total_money: 0 };
        const debtorTotal = insights?.totals?.ucDebtor || { count: 0, total_money: 0 };
        const serviceTotal = insights?.totals?.serviceTotal || insights?.totals?.ucTotal || { count: 0 };
        const ucTotal = insights?.totals?.ucTotal || { count: 0, total_money: 0 };
        const notImported = insights?.totals?.notImported || { count: 0, total_money: 0 };
        const rightRows = insights?.debtorBySpp || [];
        const serviceRows = insights?.serviceByGroup || [];
        const groupBy = insights?.group_by || 'department';
        const groupLabel = insights?.group_label || 'แผนก';
        const groupTitle = groupBy === 'subdistrict' ? 'Subdistrict' : 'Department';
        const moneyFormatter = new Intl.NumberFormat('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        const renderServiceSparkline = () => {
            if (!serviceSparkline) return;
            const rows = serviceRows
                .map(row => ({
                    label: row.group_label || row.group_key || 'ไม่ระบุ',
                    count: Number(row.count || 0)
                }))
                .filter(row => row.count > 0)
                .slice(0, 12)
                .reverse();

            if (rows.length === 0) {
                serviceSparkline.innerHTML = '<div class="uc-sparkline-empty">ไม่มีข้อมูลกราฟ</div>';
                return;
            }

            const width = 320;
            const height = 92;
            const baseline = 82;
            const top = 10;
            const maxCount = Math.max(...rows.map(row => row.count), 1);
            const slot = width / rows.length;
            const barWidth = Math.max(4, Math.min(14, slot * 0.36));
            const bars = rows.map((row, index) => {
                const barHeight = Math.max(3, (row.count / maxCount) * (baseline - top));
                const x = index * slot + (slot - barWidth) / 2;
                const y = baseline - barHeight;
                return `
                    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="2">
                        <title>${escapeHtml(row.label)}: ${row.count.toLocaleString()}</title>
                    </rect>
                `;
            }).join('');
            const points = rows.map((row, index) => {
                const x = index * slot + slot / 2;
                const y = baseline - Math.max(3, (row.count / maxCount) * (baseline - top));
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            }).join(' ');

            serviceSparkline.innerHTML = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                    <path class="uc-sparkline-grid" d="M0 28H320 M0 55H320 M0 82H320"></path>
                    <polyline class="uc-sparkline-line" points="${points}"></polyline>
                    <g class="uc-sparkline-bars">${bars}</g>
                </svg>
            `;
        };

        if (pendingTotalCount) pendingTotalCount.textContent = Number(debtorTotal.count || 0).toLocaleString();
        if (debtorTotalMoney) debtorTotalMoney.textContent = moneyFormatter.format(Number(debtorTotal.total_money || 0));
        if (serviceTotalCount) serviceTotalCount.textContent = Number(serviceTotal.count || 0).toLocaleString();
        renderServiceSparkline();
        if (notImportedCount) notImportedCount.textContent = Number(notImported.count || 0).toLocaleString();
        if (updatedAt) {
            const generatedAt = insights?.generated_at ? new Date(insights.generated_at) : new Date();
            updatedAt.textContent = `อัปเดตล่าสุด: ${generatedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }
        if (description) description.textContent = `รวมกลุ่มงาน UC ที่ควรติดตาม แยกตาม${groupLabel}`;
        if (pendingTitle) pendingTitle.textContent = `UC Pending by ${groupTitle}`;
        if (pendingSubtitle) pendingSubtitle.textContent = `แยกตาม${groupLabel}`;
        if (debtorTitle) debtorTitle.textContent = `UC Debtor by ${groupTitle}`;
        if (debtorSubtitle) debtorSubtitle.textContent = `แยกตาม${groupLabel}`;
        if (groupHeaderLabel) groupHeaderLabel.textContent = groupLabel;

        document.querySelectorAll('.group-insights-toggle').forEach(btn => {
            const isActive = btn.dataset.groupBy === groupBy;
            btn.className = isActive
                ? 'group-insights-toggle px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-300 shadow-sm'
                : 'group-insights-toggle px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200';
        });

        const renderEmpty = (target, label) => {
            target.innerHTML = `
                <div class="px-3 py-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs font-semibold text-slate-400 dark:text-slate-500">
                    ไม่พบข้อมูล ${label}
                </div>
            `;
        };

        const renderRows = (target, rows, mode) => {
            target.innerHTML = '';
            if (!rows.length) {
                renderEmpty(target, mode === 'pending' ? 'UC Pending' : 'UC Debtor');
                return;
            }

            const totalCount = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
            rows.forEach(row => {
                const groupKey = row.group_key || row.department || `ไม่ระบุ${groupLabel}`;
                const groupName = row.group_label || row.department || groupKey;
                const count = Number(row.count || 0);

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'uc-table-row';
                button.innerHTML = `
                    <span title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>
                    <span>${count.toLocaleString()}</span>
                `;
                button.addEventListener('click', () => onDepartmentClick?.({
                    groupBy,
                    groupKey,
                    groupLabel,
                    mode,
                    label: `${mode === 'pending' ? 'UC ค้าง' : 'ลูกหนี้ UC'} ${groupLabel} ${groupName}`
                }));
                target.appendChild(button);
            });
            const total = document.createElement('div');
            total.className = 'uc-table-total';
            total.innerHTML = `
                <span>Total</span>
                <span>${totalCount.toLocaleString()}</span>
            `;
            target.appendChild(total);
        };

        if (rightGrid) {
            rightGrid.innerHTML = '';
            if (rightRows.length === 0) {
                renderEmpty(rightGrid, 'กลุ่มสิทธิลูกหนี้');
            } else {
                rightRows.forEach(row => {
                    const count = Number(row.count || 0);
                    const isHigh = count > 0;
                    const rightName = row.right_name || 'ไม่ระบุสิทธิ';
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'uc-right-tile is-static';
                    card.disabled = true;
                    card.innerHTML = `
                        <div class="uc-right-tile-label">${escapeHtml(rightName)}</div>
                        <div class="uc-right-tile-value ${isHigh ? 'is-high' : 'is-zero'}">${count.toLocaleString()}</div>
                    `;
                    rightGrid.appendChild(card);
                });
            }
        }

        renderRows(pendingList, pendingRows, 'pending');
        renderRows(debtorList, debtorRows, 'debtor');
        section.classList.remove('hidden');
    },

    renderWeeklySummary(summaryData, onDateClick) {
        const container = document.getElementById('weekly-summary-container');
        const section = document.getElementById('weekly-summary-section');
        if (!container || !section) return;

        if (!summaryData || summaryData.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        container.innerHTML = '';

        summaryData.forEach(day => {
            const date = new Date(day.visit_date);
            const dateStr = day.visit_date.split('T')[0];
            const displayDate = date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
            
            // เลือกสีหลักของการ์ดตามความสำคัญ (แดง > เหลือง > เขียว)
            const mainColor = day.red > 0 ? 'border-red-500 bg-red-50/30 dark:bg-red-900/10' : 
                             day.yellow > 0 ? 'border-amber-500 bg-amber-50/30 dark:bg-amber-900/10' : 
                             'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/10';

            const card = document.createElement('div');
            card.className = `p-3 rounded-xl border ${mainColor} cursor-pointer transition transform hover:-translate-y-1 hover:shadow-md text-center`;
            card.onclick = () => onDateClick(dateStr);

            card.innerHTML = `
                <p class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">${displayDate}</p>
                <div class="flex justify-center space-x-1.5 items-center">
                    <span class="w-2 h-2 rounded-full bg-red-500" title="ยังไม่เปิด Authen"></span>
                    <span class="text-xs font-bold">${day.red}</span>
                    <span class="w-2 h-2 rounded-full bg-amber-500 ml-1" title="รอปิด Endpoint"></span>
                    <span class="text-xs font-bold">${day.yellow}</span>
                </div>
            `;
            container.appendChild(card);
        });
    },

    switchTab(tabId) {
        const tabTracker = document.getElementById('tab-tracker');
        const tabLiveDashboard = document.getElementById('tab-live-dashboard');
        const tabGrafana = document.getElementById('tab-grafana');
        const tabEmbedGrafana = document.getElementById('tab-embed-grafana');
        const tabAdmin = document.getElementById('tab-admin');
        
        const trackerView = document.getElementById('tracker-view-container');
        const liveDashboardView = document.getElementById('live-dashboard-view-container');
        const grafanaView = document.getElementById('grafana-view-container');
        const embedGrafanaView = document.getElementById('embed-grafana-view-container');
        const adminView = document.getElementById('admin-view-container');

        const activeClass = 'px-4 py-2.5 text-xs font-extrabold tracking-wider border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 focus:outline-none transition cursor-pointer flex items-center space-x-2 uppercase';
        const inactiveClass = 'px-4 py-2.5 text-xs font-extrabold tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 focus:outline-none transition cursor-pointer flex items-center space-x-2 uppercase';

        // Reset all tabs to inactive
        if (tabTracker) tabTracker.className = inactiveClass;
        if (tabLiveDashboard) tabLiveDashboard.className = inactiveClass;
        if (tabGrafana) tabGrafana.className = inactiveClass;
        if (tabEmbedGrafana) tabEmbedGrafana.className = inactiveClass;
        if (tabAdmin) tabAdmin.className = inactiveClass;

        // Hide all views
        if (trackerView) trackerView.classList.add('hidden');
        if (liveDashboardView) liveDashboardView.classList.add('hidden');
        if (grafanaView) grafanaView.classList.add('hidden');
        if (embedGrafanaView) embedGrafanaView.classList.add('hidden');
        if (adminView) adminView.classList.add('hidden');

        // Activate selected tab and view
        if (tabId === 'tab-tracker' && tabTracker && trackerView) {
            tabTracker.className = activeClass;
            trackerView.classList.remove('hidden');
        } else if (tabId === 'tab-live-dashboard' && tabLiveDashboard && liveDashboardView) {
            tabLiveDashboard.className = activeClass;
            liveDashboardView.classList.remove('hidden');
        } else if (tabId === 'tab-grafana' && tabGrafana && grafanaView) {
            tabGrafana.className = activeClass;
            grafanaView.classList.remove('hidden');
        } else if (tabId === 'tab-embed-grafana' && tabEmbedGrafana && embedGrafanaView) {
            tabEmbedGrafana.className = activeClass;
            embedGrafanaView.classList.remove('hidden');
        } else if (tabId === 'tab-admin' && tabAdmin && adminView) {
            tabAdmin.className = activeClass;
            adminView.classList.remove('hidden');
        }
    },

    renderAdminUsers(users, onEdit, onDelete, onTest) {
        if (typeof document === 'undefined') return;
        const body = document.getElementById('admin-user-table-body');
        if (!body) return;

        body.innerHTML = '';
        if (!users || users.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="7" class="py-8 text-center text-slate-500 dark:text-slate-400 font-bold bg-transparent">
                        <i class="fas fa-users-slash text-3xl mb-2 block"></i>
                        ไม่พบข้อมูลผู้ใช้งานในระบบ
                    </td>
                </tr>
            `;
            return;
        }

        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200 bg-transparent';

            const roleClass = user.role === 'admin' ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400' :
                              user.role === 'viewer' ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' :
                              'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400';

            const roleText = user.role === 'admin' ? 'Admin' :
                             user.role === 'viewer' ? 'Viewer' : 'User';

            // Check details for Line and Telegram config
            const hasLine = user.line_token && user.line_group_id;
            const lineStatus = hasLine ? 
                `<span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/10">ตั้งค่าแล้ว</span>` : 
                `<span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/10">ยังไม่ได้ตั้งค่า</span>`;

            const hasTelegram = user.telegram_token && user.telegram_chat_id;
            const telegramStatus = hasTelegram ? 
                `<span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/10">ตั้งค่าแล้ว</span>` : 
                `<span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/10">ยังไม่ได้ตั้งค่า</span>`;

            // Action Test buttons
            const testLineBtn = hasLine ? 
                `<button class="test-line-btn px-2 py-1 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-bold rounded-lg transition text-[10px] cursor-pointer" data-id="${user.id}">Test LINE</button>` : 
                `<button class="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 font-bold rounded-lg text-[10px] cursor-not-allowed" disabled>Test LINE</button>`;

            const testTelegramBtn = hasTelegram ? 
                `<button class="test-telegram-btn px-2 py-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-lg transition text-[10px] cursor-pointer" data-id="${user.id}">Test TG</button>` : 
                `<button class="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 font-bold rounded-lg text-[10px] cursor-not-allowed" disabled>Test TG</button>`;

            tr.innerHTML = `
                <td class="py-3.5 px-4 font-semibold text-blue-600 dark:text-blue-400">${user.username}</td>
                <td class="py-3.5 px-4 font-medium">${user.full_name || '-'}</td>
                <td class="py-3.5 px-4">
                    <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold ${roleClass}">${roleText}</span>
                </td>
                <td class="py-3.5 px-4 text-slate-500 dark:text-slate-400">${user.department || '-'}</td>
                <td class="py-3.5 px-4 space-y-1">
                    <div>${lineStatus}</div>
                    <div class="text-[9px] font-mono text-slate-400 truncate max-w-[150px]" title="${user.line_group_id || ''}">${user.line_group_id || '-'}</div>
                </td>
                <td class="py-3.5 px-4 space-y-1">
                    <div>${telegramStatus}</div>
                    <div class="text-[9px] font-mono text-slate-400 truncate max-w-[150px]" title="${user.telegram_chat_id || ''}">${user.telegram_chat_id || '-'}</div>
                </td>
                <td class="py-3.5 px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5 flex-wrap">
                        ${testLineBtn}
                        ${testTelegramBtn}
                        <button class="edit-user-btn p-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition cursor-pointer" title="แก้ไข" data-id="${user.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-user-btn p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition cursor-pointer" title="ลบ" data-id="${user.id}">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            `;

            // Attach event handlers safely
            tr.querySelector('.edit-user-btn').addEventListener('click', () => onEdit(user));
            tr.querySelector('.delete-user-btn').addEventListener('click', () => onDelete(user.id));
            if (hasLine) {
                tr.querySelector('.test-line-btn').addEventListener('click', () => onTest('line', user));
            }
            if (hasTelegram) {
                tr.querySelector('.test-telegram-btn').addEventListener('click', () => onTest('telegram', user));
            }

            body.appendChild(tr);
        });
    },

    renderAdminSchedules(schedules, onToggle, onDelete) {
        if (typeof document === 'undefined') return;
        const body = document.getElementById('admin-schedule-table-body');
        if (!body) return;

        body.innerHTML = '';
        if (!schedules || schedules.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="3" class="py-8 text-center text-slate-500 dark:text-slate-400 font-bold bg-transparent">
                        <i class="fas fa-clock text-3xl mb-2 block"></i>
                        ไม่พบการตั้งเวลาทำงานอัตโนมัติ
                    </td>
                </tr>
            `;
            return;
        }

        schedules.forEach(sched => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200 bg-transparent';

            const enabledChecked = sched.is_enabled ? 'checked' : '';
            const statusLabel = sched.is_enabled ? 
                `<span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/10">ทำงาน</span>` : 
                `<span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/10">ปิดใช้งาน</span>`;

            tr.innerHTML = `
                <td class="py-3.5 px-6 font-bold text-slate-900 dark:text-white text-sm">
                    <i class="far fa-clock mr-1 text-slate-400"></i> ${sched.schedule_time} น.
                </td>
                <td class="py-3.5 px-6 space-y-1">
                    <div class="flex items-center space-x-2">
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" class="schedule-toggle sr-only peer" data-id="${sched.id}" ${enabledChecked}>
                            <div class="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                        ${statusLabel}
                    </div>
                </td>
                <td class="py-3.5 px-6 text-center">
                    <button class="delete-schedule-btn px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-lg transition text-xs cursor-pointer flex items-center justify-center space-x-1 mx-auto" data-id="${sched.id}">
                        <i class="fas fa-trash-alt"></i>
                        <span>ลบ</span>
                    </button>
                </td>
            `;

            // Bind toggle switch
            const toggleInput = tr.querySelector('.schedule-toggle');
            toggleInput.addEventListener('change', (e) => {
                onToggle(sched.id, e.target.checked);
            });

            // Bind delete button
            const deleteBtn = tr.querySelector('.delete-schedule-btn');
            deleteBtn.addEventListener('click', () => {
                onDelete(sched.id, sched.schedule_time);
            });

            body.appendChild(tr);
        });
    },

    renderAdminSyncRuns(runs, summary = null) {
        if (typeof document === 'undefined') return;
        const body = document.getElementById('admin-sync-runs-table-body');
        if (!body) return;

        const setSummaryText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = Number(value || 0).toLocaleString();
        };
        if (summary) {
            setSummaryText('sync-summary-total', summary.total_runs);
            setSummaryText('sync-summary-success', summary.success_runs);
            setSummaryText('sync-summary-failed', summary.failed_runs);
            setSummaryText('sync-summary-running', summary.running_runs);
            setSummaryText('sync-summary-records', summary.total_records);
        }

        const formatDateTime = (value) => {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleString('th-TH', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        const formatVisitDate = (value) => {
            if (!value) return '-';
            return String(value).split('T')[0];
        };

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        body.innerHTML = '';
        if (!runs || runs.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="9" class="py-8 text-center text-slate-500 dark:text-slate-400 font-bold bg-transparent">
                        <i class="fas fa-history text-3xl mb-2 block"></i>
                        ยังไม่มีประวัติการ Sync ข้อมูล
                    </td>
                </tr>
            `;
            return;
        }

        runs.forEach(run => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200 bg-transparent';

            const statusClass = run.status === 'success'
                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                : run.status === 'failed'
                    ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                    : 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400';
            const statusIcon = run.status === 'success'
                ? 'fa-check-circle'
                : run.status === 'failed'
                    ? 'fa-times-circle'
                    : 'fa-spinner fa-spin';
            const message = run.error || run.message || '-';
            const safeMessage = escapeHtml(message);

            tr.innerHTML = `
                <td class="py-3.5 px-4 font-mono font-bold text-slate-500 dark:text-slate-400">#${run.id}</td>
                <td class="py-3.5 px-4 font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(run.source || '-')}</td>
                <td class="py-3.5 px-4 font-mono">${escapeHtml(formatVisitDate(run.visit_date))}</td>
                <td class="py-3.5 px-4">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">
                        <i class="fas ${statusIcon}"></i>
                        ${escapeHtml(run.status || '-')}
                    </span>
                </td>
                <td class="py-3.5 px-4">${escapeHtml(run.username || '-')}</td>
                <td class="py-3.5 px-4 text-right font-mono font-semibold">${Number(run.total_records || 0).toLocaleString()}</td>
                <td class="py-3.5 px-4 truncate max-w-[260px]" title="${safeMessage}">${safeMessage}</td>
                <td class="py-3.5 px-4 text-slate-500 dark:text-slate-400">${escapeHtml(formatDateTime(run.started_at))}</td>
                <td class="py-3.5 px-4 text-slate-500 dark:text-slate-400">${escapeHtml(formatDateTime(run.finished_at))}</td>
            `;

            body.appendChild(tr);
        });
    },

    renderAdminAuditLogs(logs) {
        if (typeof document === 'undefined') return;
        const body = document.getElementById('admin-audit-log-table-body');
        if (!body) return;

        const formatDateTime = (value) => {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleString('th-TH', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const formatDetails = (details) => {
            if (!details) return '-';
            if (typeof details === 'object') return JSON.stringify(details);
            try {
                return JSON.stringify(JSON.parse(details));
            } catch {
                return String(details);
            }
        };

        body.innerHTML = '';
        if (!logs || logs.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="6" class="py-8 text-center text-slate-500 dark:text-slate-400 font-bold bg-transparent">
                        <i class="fas fa-clipboard-list text-3xl mb-2 block"></i>
                        ยังไม่มี Audit Log
                    </td>
                </tr>
            `;
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200 bg-transparent';
            const details = formatDetails(log.details);
            const safeDetails = escapeHtml(details);

            tr.innerHTML = `
                <td class="py-3.5 px-4 text-slate-500 dark:text-slate-400">${escapeHtml(formatDateTime(log.created_at))}</td>
                <td class="py-3.5 px-4 font-semibold">${escapeHtml(log.username || '-')}</td>
                <td class="py-3.5 px-4">
                    <span class="inline-flex px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 font-bold text-[10px]">
                        ${escapeHtml(log.action || '-')}
                    </span>
                </td>
                <td class="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400">${escapeHtml(log.entity_type || '-')}${log.entity_id ? ` #${escapeHtml(log.entity_id)}` : ''}</td>
                <td class="py-3.5 px-4 truncate max-w-[420px]" title="${safeDetails}">${safeDetails}</td>
                <td class="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400">${escapeHtml(log.ip_address || '-')}</td>
            `;
            body.appendChild(tr);
        });
    },

    renderSavedQueriesDropdown(queries, selectedId = '') {
        const select = document.getElementById('query-template-select');
        if (!select) return;
        
        select.innerHTML = '<option value="" disabled selected>-- โหลดคำสั่ง SQL --</option>';
        
        queries.forEach(q => {
            const opt = document.createElement('option');
            opt.value = q.id;
            opt.textContent = `[${q.db_type.toUpperCase()}] ${q.name}`;
            if (String(q.id) === String(selectedId)) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    },

    renderQueryHistory(history, onSelect) {
        if (typeof document === 'undefined') return;
        const list = document.getElementById('query-history-list');
        if (!list) return;

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const formatDateTime = (value) => {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleString('th-TH', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        list.innerHTML = '';
        if (!history || history.length === 0) {
            list.innerHTML = `
                <div class="lg:col-span-2 px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500 font-semibold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    ยังไม่มีประวัติคำสั่ง SQL
                </div>
            `;
            return;
        }

        history.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'text-left p-3 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 hover:border-indigo-400/60 dark:hover:border-indigo-500/60 hover:shadow-sm transition cursor-pointer';
            const queryPreview = String(item.query_text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            button.innerHTML = `
                <div class="flex items-center justify-between gap-2 mb-1">
                    <span class="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-300 uppercase">${escapeHtml(item.db_type || 'hosxp')}</span>
                    <span class="text-[10px] text-slate-400 dark:text-slate-500">${escapeHtml(formatDateTime(item.created_at))}</span>
                </div>
                <div class="font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200 line-clamp-2">${escapeHtml(queryPreview || '-')}</div>
                <div class="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
                    <span>${Number(item.rows_count || 0).toLocaleString()} rows</span>
                    <span>${Number(item.execution_time_ms || 0).toLocaleString()} ms</span>
                </div>
            `;
            button.addEventListener('click', () => onSelect?.(item));
            list.appendChild(button);
        });
    },

    renderGrafanaTable(rows, sortBy = '', sortDesc = false, searchFilter = '', onHeaderClick) {
        const thead = document.getElementById('query-table-head');
        const tbody = document.getElementById('query-table-body');
        const noData = document.getElementById('query-no-data');
        
        thead.innerHTML = '';
        tbody.innerHTML = '';
        
        if (!rows || rows.length === 0) {
            noData.classList.remove('hidden');
            return;
        }
        
        // 1. กรองข้อมูลในฝั่งไคลเอนต์ตาม Search Box
        let filteredRows = [...rows];
        if (searchFilter) {
            const query = searchFilter.toLowerCase();
            filteredRows = filteredRows.filter(row => {
                return Object.values(row).some(val => 
                    String(val || '').toLowerCase().includes(query)
                );
            });
        }
        
        // 2. จัดเรียงข้อมูลในฝั่งไคลเอนต์ตามคอลัมน์ที่เลือก
        if (sortBy) {
            filteredRows.sort((a, b) => {
                let valA = a[sortBy];
                let valB = b[sortBy];
                
                // ตรวจสอบว่าเป็นตัวเลขหรือไม่
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
        
        if (filteredRows.length === 0) {
            noData.classList.remove('hidden');
            return;
        }
        
        noData.classList.add('hidden');
        
        // 3. วาดหัวข้อคอลัมน์ (Headers)
        const firstRow = filteredRows[0];
        const headers = Object.keys(firstRow);
        
        const trHead = document.createElement('tr');
        headers.forEach(header => {
            const th = document.createElement('th');
            th.className = 'py-3 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition duration-150 select-none text-[11px] font-bold tracking-wider';
            th.onclick = () => onHeaderClick(header);
            
            let displayName = header;
            if (header === sortBy) {
                displayName += sortDesc ? '  ▼' : '  ▲';
                th.classList.add('text-blue-600', 'dark:text-blue-400');
            }
            
            th.textContent = displayName;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        
        // 4. วาดข้อมูล (Rows)
        filteredRows.forEach((row, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 text-slate-700 dark:text-slate-200';
            
            headers.forEach(header => {
                const td = document.createElement('td');
                td.className = 'py-3 px-4 text-xs font-medium truncate max-w-[200px]';
                
                let val = row[header];
                
                // ตกแต่งรูปแบบการแสดงผลคอลัมน์พิเศษ
                if (val === null || val === undefined) {
                    td.innerHTML = '<span class="text-slate-400 dark:text-slate-600">-</span>';
                } else if (header.toLowerCase() === 'color_status' || header.toLowerCase() === 'status_color') {
                    const statusClass = val === 'RED' ? 'status-red' : 
                                      val === 'YELLOW' ? 'status-yellow' : 
                                      val === 'GREEN' ? 'status-green' : '';
                    td.innerHTML = `<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusClass}">${val}</span>`;
                } else if (header.toLowerCase() === 'check_claimcode' || header.toLowerCase() === 'check_claim') {
                    const statusClass = val === 'ตรง' ? 'status-green' : 
                                      val === 'ตรวจสอบ' ? 'status-yellow' : 
                                      val === 'ไม่ตรง' ? 'status-red' : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400';
                    td.innerHTML = `<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusClass}">${val}</span>`;
                } else if (header.toLowerCase() === 'vn' || header.toLowerCase() === 'hn') {
                    td.className = 'py-2 px-4 font-mono text-[11px] font-semibold';
                    td.innerHTML = `<span class="text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/30 rounded px-2 py-0.5 inline-block">${val}</span>`;
                } else if (header.toLowerCase().includes('cid')) {
                    td.className = 'py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400';
                    td.textContent = val;
                } else if (header.toLowerCase() === 'uc_money' && !isNaN(val)) {
                    td.className = 'py-3 px-4 text-xs font-semibold text-right';
                    td.textContent = Number(val).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                } else if (typeof val === 'object' && val.type === 'Buffer' && Array.isArray(val.data)) {
                    // ดีโค้ดข้อมูล Binary (CAST CONVERT USING utf8) กลับเป็นภาษาไทย
                    try {
                        const decoder = new TextDecoder('utf-8');
                        const bytes = new Uint8Array(val.data);
                        td.textContent = decoder.decode(bytes);
                    } catch (e) {
                        td.textContent = '[Binary Data]';
                    }
                } else {
                    td.textContent = val;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    },

    updateLiveRefreshState(state) {
        if (typeof document === 'undefined') return;
        const stateEl = document.getElementById('live-refresh-state');
        const timeEl = document.getElementById('live-update-time');
        if (!stateEl) return;

        if (state === 'syncing') {
            stateEl.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-500/10';
            stateEl.innerHTML = '<i class="fas fa-sync-alt animate-spin text-[10px]"></i> กำลังอัปเดต';
            return;
        }

        if (state === 'failed') {
            stateEl.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-500/10';
            stateEl.innerHTML = '<i class="fas fa-exclamation-triangle text-[10px]"></i> อัปเดตไม่สำเร็จ';
            return;
        }

        stateEl.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10';
        stateEl.innerHTML = '<i class="fas fa-circle text-[7px]"></i> ออนไลน์';
        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        }
    },

    updateLiveAutoRefresh({ isActive, nextRefreshAt, intervalMs = 30000 } = {}) {
        if (typeof document === 'undefined') return;
        const stateEl = document.getElementById('live-auto-refresh-state');
        const nextEl = document.getElementById('live-next-refresh');
        const toggleBtn = document.getElementById('live-auto-toggle-btn');
        const toggleText = document.getElementById('live-auto-toggle-text');
        
        if (toggleText) {
            toggleText.textContent = isActive ? 'ปิดรีเฟรชอัตโนมัติ' : 'เปิดรีเฟรชอัตโนมัติ';
        }
        if (toggleBtn) {
            if (isActive) {
                toggleBtn.className = 'px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition cursor-pointer shadow-md shadow-emerald-500/20';
            } else {
                toggleBtn.className = 'px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs flex items-center gap-2 transition cursor-pointer';
            }
        }

        if (!stateEl || !nextEl) return;

        if (!isActive) {
            stateEl.textContent = 'Auto refresh: ปิด';
            stateEl.className = 'text-slate-500 dark:text-slate-400';
            nextEl.textContent = '-';
            return;
        }

        const intervalSeconds = Math.round(intervalMs / 1000);
        const remainingSeconds = Math.max(0, Math.ceil((Number(nextRefreshAt || 0) - Date.now()) / 1000));
        const nextTime = nextRefreshAt
            ? new Date(nextRefreshAt).toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })
            : '-';

        stateEl.textContent = `Auto refresh: เปิด (${intervalSeconds} วิ)`;
        stateEl.className = 'text-emerald-600 dark:text-emerald-400';
        nextEl.textContent = `${remainingSeconds} วิ (${nextTime})`;
    },

    async renderLiveDashboard(data, token) {
        if (typeof document === 'undefined') return;

        // 1. Update stats card values
        const totalVisits = (data.hosxpStats && data.hosxpStats.totalVisits) || 0;
        const totalPersons = (data.hosxpStats && data.hosxpStats.totalPersons) || 0;
        const activeDepts = (data.depData && data.depData.length) || 0;
        const pendingCount = data.pending_count || 0;

        const statTotalEl = document.getElementById('live-stat-total');
        const statDeptsEl = document.getElementById('live-stat-depts');
        const statPendingEl = document.getElementById('live-stat-pending');

        if (statTotalEl) {
            statTotalEl.innerHTML = `${totalPersons} <span class="text-lg text-slate-400 font-medium">/ ${totalVisits}</span>`;
        }
        if (statDeptsEl) {
            statDeptsEl.textContent = activeDepts;
        }
        if (statPendingEl) {
            statPendingEl.textContent = pendingCount;
        }

        renderTopDepartments(data.depData || []);

        // 2. Fetch GeoJSON boundary if not cached
        if (!geojsonCache) {
            try {
                const res = await fetch('/api/geojson', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                geojsonCache = await res.json();
            } catch (err) {
                console.error('❌ Failed to fetch GeoJSON for map:', err);
            }
        }

        // 3. Render amCharts 5 Map
        // 3. Update Custom SVG Map with HOSxP live data
        const updateSvgMap = (data) => {
            const tambons = [
                { code: 'T01', keywords: ['ไทรเดี่ยว'] },
                { code: 'T02', keywords: ['ไทรทอง'] },
                { code: 'T03', keywords: ['เบญจขร'] },
                { code: 'T04', keywords: ['ซับมะกรูด'] },
                { code: 'T05', keywords: ['คลองหาด'] },
                { code: 'T06', keywords: ['ไทยอุดม'] },
                { code: 'T07', keywords: ['คลองไก่เถื่อน', 'ไก่เถื่อน'] }
            ];

            const getVisitCount = (code, keywords) => {
                if (data.tambonVisits) {
                    const item = data.tambonVisits.find(v => v.code === code);
                    return item ? item.count : 0;
                }
                if (!data.geoData) return 0;
                const rec = data.geoData.find(g =>
                    keywords.some(k => (g.subdistrict_name || '').includes(k))
                );
                return rec ? rec.visit_count : 0;
            };

            const counts = tambons.map(t => ({
                code: t.code,
                name: t.keywords[0],
                count: getVisitCount(t.code, t.keywords)
            }));

            const rawMax = Math.max(...counts.map(d => Number(d.count || 0)), 0);
            const max = Math.max(rawMax, 1);
            const total = counts.reduce((sum, d) => sum + Number(d.count || 0), 0);
            const isDark = document.documentElement.classList.contains('dark');

            // Dynamic choropleth color scales for light/dark themes
            const scaleColorsLight = ['#f8fafc', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#ea580c'];
            const scaleColorsDark = ['#1e293b', '#451a03', '#7c2d12', '#9a3412', '#c2410c', '#ea580c'];
            const scaleColors = isDark ? scaleColorsDark : scaleColorsLight;

            function colorForValue(val, maxVal) {
                if (maxVal <= 0 || val <= 0) return scaleColors[0];
                const ratio = Math.max(0, Math.min(1, val / maxVal));
                const idx = Math.min(scaleColors.length - 1, Math.floor(ratio * (scaleColors.length - 1) + 0.0001));
                return scaleColors[idx];
            }

            function updateMapLegend() {
                const totalEl = document.getElementById('map-legend-total');
                const maxEl = document.getElementById('map-legend-max');
                const highEl = document.getElementById('map-legend-high');
                const midEl = document.getElementById('map-legend-mid');
                const lowEl = document.getElementById('map-legend-low');
                const highColorEl = document.getElementById('map-legend-high-color');
                const midColorEl = document.getElementById('map-legend-mid-color');
                const lowColorEl = document.getElementById('map-legend-low-color');
                const topTambon = counts.reduce((top, item) => item.count > top.count ? item : top, { name: '-', count: 0 });

                if (total === 0) {
                    if (totalEl) totalEl.textContent = 'รวม 0 คน';
                    if (maxEl) maxEl.textContent = 'สูงสุด -';
                    if (highEl) highEl.textContent = 'สูง (-)';
                    if (midEl) midEl.textContent = 'ปานกลาง (-)';
                    if (lowEl) lowEl.textContent = 'น้อย (-)';
                    if (highColorEl) highColorEl.style.backgroundColor = colorForValue(0, max);
                    if (midColorEl) midColorEl.style.backgroundColor = colorForValue(0, max);
                    if (lowColorEl) lowColorEl.style.backgroundColor = colorForValue(0, max);
                    return;
                }

                const highMin = Math.max(1, Math.ceil(max * 0.67));
                const midMin = Math.max(1, Math.ceil(max * 0.34));
                const midMax = Math.max(midMin, highMin - 1);
                const lowMax = Math.max(1, midMin - 1);

                if (totalEl) totalEl.textContent = `รวม ${total.toLocaleString()} คน`;
                if (maxEl) maxEl.textContent = `สูงสุด ${topTambon.name} ${Number(topTambon.count || 0).toLocaleString()} คน`;
                if (highEl) highEl.textContent = max <= 1 ? 'สูง (1 คน)' : `สูง (${highMin.toLocaleString()}–${max.toLocaleString()} คน)`;
                if (midEl) midEl.textContent = max <= 1 ? 'ปานกลาง (-)' : `ปานกลาง (${midMin.toLocaleString()}–${midMax.toLocaleString()} คน)`;
                if (lowEl) lowEl.textContent = max <= 1 ? 'น้อย (-)' : `น้อย (1–${lowMax.toLocaleString()} คน)`;
                if (highColorEl) highColorEl.style.backgroundColor = colorForValue(max, max);
                if (midColorEl) midColorEl.style.backgroundColor = colorForValue(Math.ceil(max * 0.5), max);
                if (lowColorEl) lowColorEl.style.backgroundColor = colorForValue(Math.max(1, Math.ceil(max * 0.18)), max);
            }

            updateMapLegend();

            counts.forEach(d => {
                const fill = colorForValue(d.count, max);
                const pathEl = document.getElementById('path-' + d.code);
                if (pathEl) {
                    pathEl.setAttribute('fill', fill);
                    pathEl.dataset.count = d.count;
                }
                const countEl = document.getElementById('count-' + d.code);
                if (countEl) {
                    countEl.textContent = d.count > 0 ? `${d.count} คน` : '— คน';
                }
            });

            // Set up interactive hover and click filter events (once)
            const mapSvg = document.getElementById('tambonMap');
            const tooltipEl = document.getElementById('map-tooltip');
            if (mapSvg && !mapSvg.dataset.eventsSet) {
                mapSvg.dataset.eventsSet = 'true';
                const paths = mapSvg.querySelectorAll('.tambon');
                paths.forEach(p => {
                    p.addEventListener('click', function() {
                        const name = this.dataset.tambon;
                        if (name && typeof window.filterDashboardByTambon === 'function') {
                            window.filterDashboardByTambon(name);
                        }
                    });
                    p.addEventListener('mouseenter', function() {
                        const name = this.dataset.tambon;
                        const countVal = this.dataset.count || 0;
                        if (tooltipEl) {
                            tooltipEl.innerHTML = `
                                <div class="text-[10px] font-bold text-sky-300 uppercase tracking-wide">ตำบล${name}</div>
                                <div class="text-xs font-extrabold mt-0.5 text-white">${Number(countVal || 0).toLocaleString()} คน</div>
                            `;
                            tooltipEl.setAttribute('aria-hidden', 'false');
                            tooltipEl.classList.add('show');
                        }
                    });
                    p.addEventListener('mousemove', function(e) {
                        if (tooltipEl) {
                            const parentRect = mapSvg.parentElement.getBoundingClientRect();
                            const x = Math.max(16, Math.min(parentRect.width - 16, e.clientX - parentRect.left));
                            const y = Math.max(48, Math.min(parentRect.height - 16, e.clientY - parentRect.top));
                            tooltipEl.style.left = `${x}px`;
                            tooltipEl.style.top = `${y}px`;
                        }
                    });
                    p.addEventListener('mouseleave', function() {
                        if (tooltipEl) {
                            tooltipEl.setAttribute('aria-hidden', 'true');
                            tooltipEl.classList.remove('show');
                        }
                    });
                });
            }
        };

        updateSvgMap(data);

    }
};

function renderTopDepartments(depData) {
    if (typeof document === 'undefined') return;
    const topDeptEl = document.getElementById('live-top-depts');
    if (!topDeptEl) return;

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const departments = [...depData]
        .sort((a, b) => Number(b.visit_count || 0) - Number(a.visit_count || 0))
        .slice(0, 8);
    const totalVisits = departments.reduce((sum, dept) => sum + Number(dept.visit_count || 0), 0);
    const maxDeptCount = Math.max(...departments.map(dept => Number(dept.visit_count || 0)), 1);

    topDeptEl.innerHTML = departments.length === 0
        ? `
            <div class="live-dept-empty">
                <i class="fas fa-hospital-user text-3xl text-slate-300 dark:text-slate-600 mb-2"></i>
                <p class="font-bold">ยังไม่มีข้อมูลแผนก</p>
                <p class="text-[11px] mt-1">รอข้อมูลจาก HOSxP Live Dashboard</p>
            </div>
        `
        : departments.map((dept, index) => {
            const count = Number(dept.visit_count || 0);
            const uniquePatients = Number(dept.unique_patients || 0);
            const width = Math.max(6, Math.round((count / maxDeptCount) * 100));
            const percent = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
            const rawName = dept.dep_name || dept.dep_code || 'ไม่ระบุแผนก';
            const name = escapeHtml(rawName);
            const rankClass = index === 0 ? 'is-first' : index === 1 ? 'is-second' : index === 2 ? 'is-third' : '';
            return `
                <div class="live-dept-rank-card ${rankClass}" data-department-filter="${name}" role="button" tabindex="0" title="คลิกเพื่อกรอง Tracker ตามแผนก">
                    <div class="live-dept-rank-badge">${index + 1}</div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <p class="live-dept-rank-name">${name}</p>
                                <p class="live-dept-rank-meta">${uniquePatients.toLocaleString()} คนไม่ซ้ำ • ${percent}% ของ Top ${departments.length}</p>
                            </div>
                            <div class="text-right shrink-0">
                                <p class="live-dept-rank-count">${count.toLocaleString()}</p>
                                <p class="live-dept-rank-unit">visits</p>
                            </div>
                        </div>
                        <div class="live-dept-rank-track">
                            <div class="live-dept-rank-bar" style="width: ${width}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    topDeptEl.querySelectorAll('[data-department-filter]').forEach(row => {
        const filter = () => window.filterTrackerByDepartment?.(row.dataset.departmentFilter);
        row.addEventListener('click', filter);
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                filter();
            }
        });
    });
}
