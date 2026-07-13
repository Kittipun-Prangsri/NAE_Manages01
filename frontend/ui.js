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
            // Remove existing sort indicators from text
            let text = th.textContent.replace(/  [▲▼]/g, '');
            th.className = th.className.replace(' text-blue-600 dark:text-blue-400', '');
            
            if (field === sortBy) {
                text += sortDesc ? '  ▼' : '  ▲';
                th.classList.add('text-blue-600', 'dark:text-blue-400');
            }
            th.textContent = text;
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

        // แสดงผลเพียง 10 รายการแรก
        const displayData = data.slice(0, 10);

        displayData.forEach(item => {
            const tr = document.createElement('tr');
            const isGreen = item.color_status === 'GREEN';
            const rowClass = isGreen ? 'bg-emerald-50/20 dark:bg-emerald-900/10' : '';
            tr.className = `hover:bg-slate-50/70 dark:hover:bg-slate-800/45 border-b border-slate-100 dark:border-slate-800/80 transition duration-150 ${rowClass}`;
            
            const statusClass = item.color_status === 'RED' ? 'status-red' : 
                              item.color_status === 'YELLOW' ? 'status-yellow' : 'status-green';
            
            const statusText = item.color_status === 'RED' ? 'ยังไม่เปิด Authen' : 
                              item.color_status === 'YELLOW' ? 'รอปิด Endpoint' : 'สมบูรณ์';
            
            const statusIcon = item.color_status === 'RED' ? '<i class="fas fa-times-circle mr-1"></i>' : 
                              item.color_status === 'YELLOW' ? '<i class="fas fa-clock mr-1"></i>' : '<i class="fas fa-check-circle mr-1"></i>';

            const checkClaimClass = item.check_claimcode === 'ตรง' ? 'status-green' : 
                                  item.check_claimcode === 'ตรวจสอบ' ? 'status-yellow' : 
                                  item.check_claimcode === 'ไม่ตรง' ? 'status-red' : 
                                  'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400';
            
            const checkClaimVal = item.check_claimcode || 'ยังไม่ได้นำเข้า';

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
                <td class="py-3.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 text-right">${(item.uc_money != null && !isNaN(item.uc_money)) ? Number(item.uc_money).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}</td>
                <td class="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 font-medium">${item.department || '-'}</td>
                <td class="py-3.5 px-4 text-center">
                    <span class="inline-flex items-center justify-center px-3 py-1 rounded-full text-[11px] font-bold shadow-sm leading-none ${statusClass}">
                        ${statusIcon}
                        ${statusText}
                    </span>
                </td>
            `;
            els.tableBody.appendChild(tr);
        });
    },

    updateStats(data, hosxpStats = null) {
        if (!data) return;
        const els = getEls();
        if (!els.statTotal || !els.statRed || !els.statYellow || !els.statGreen || !els.statUcMoney || !els.statUcCount) return;
        
        // Calculate NHSO specific stats from data array
        const red = data.filter(i => i.color_status === 'RED').length;
        const yellow = data.filter(i => i.color_status === 'YELLOW').length;
        const green = data.filter(i => i.color_status === 'GREEN').length;

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

    renderAdminSyncRuns(runs) {
        if (typeof document === 'undefined') return;
        const body = document.getElementById('admin-sync-runs-table-body');
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

    resizeLiveCharts() {
        if (typeof echarts === 'undefined') return;
        ['chart-opd', 'chart-er', 'chart-ncd', 'chart-dental'].forEach(id => {
            const element = document.getElementById(id);
            const chart = element ? echarts.getInstanceByDom(element) : null;
            if (chart) chart.resize();
        });
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

        const topDeptEl = document.getElementById('live-top-depts');
        if (topDeptEl) {
            const escapeHtml = (value) => String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const departments = [...(data.depData || [])]
                .sort((a, b) => Number(b.visit_count || 0) - Number(a.visit_count || 0))
                .slice(0, 5);
            const maxDeptCount = Math.max(...departments.map(d => Number(d.visit_count || 0)), 1);

            topDeptEl.innerHTML = departments.length === 0
                ? '<div class="text-xs text-slate-400 font-semibold">ยังไม่มีข้อมูลแผนก</div>'
                : departments.map((dept, index) => {
                    const count = Number(dept.visit_count || 0);
                    const width = Math.max(8, Math.round((count / maxDeptCount) * 100));
                    const name = escapeHtml(dept.dep_name || dept.dep_code || 'ไม่ระบุแผนก');
                    return `
                        <div class="tv-dept-row">
                            <div class="flex items-center justify-between gap-3">
                                <span class="tv-dept-name">${index + 1}. ${name}</span>
                                <span class="tv-dept-count">${count.toLocaleString()} ราย</span>
                            </div>
                            <div class="tv-dept-bar-track">
                                <div class="tv-dept-bar" style="width: ${width}%"></div>
                            </div>
                        </div>
                    `;
                }).join('');
        }

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
                count: getVisitCount(t.code, t.keywords)
            }));

            const max = Math.max(...counts.map(d => d.count), 1);
            const isDark = document.documentElement.classList.contains('dark');

            // Dynamic choropleth color scales for light/dark themes
            const scaleColorsLight = ['#f8fafc', '#fed7aa', '#fdba74', '#f97316', '#ea580c', '#c2410c'];
            const scaleColorsDark = ['#1e293b', '#451a03', '#7c2d12', '#9a3412', '#c2410c', '#ea580c'];
            const scaleColors = isDark ? scaleColorsDark : scaleColorsLight;

            function colorForValue(val, maxVal) {
                if (maxVal <= 0) return scaleColors[0];
                const ratio = Math.max(0, Math.min(1, val / maxVal));
                const idx = Math.min(scaleColors.length - 1, Math.floor(ratio * (scaleColors.length - 1) + 0.0001));
                return scaleColors[idx];
            }

            counts.forEach(d => {
                const fill = colorForValue(d.count, max);
                const pathEl = document.getElementById('path-' + d.code);
                if (pathEl) {
                    pathEl.setAttribute('fill', fill);
                }
                const countEl = document.getElementById('count-' + d.code);
                if (countEl) {
                    countEl.textContent = d.count > 0 ? `${d.count} คน` : '— คน';
                }
            });

            // Set up interactive hover and click filter events (once)
            const mapSvg = document.getElementById('tambonMap');
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
                        this.style.filter = 'brightness(1.15) drop-shadow(0 10px 15px rgba(0,0,0,0.15))';
                        this.style.transform = 'translateY(-4px) scale(1.01)';
                        this.style.transformOrigin = 'center';
                    });
                    p.addEventListener('mouseleave', function() {
                        this.style.filter = 'none';
                        this.style.transform = 'none';
                    });
                });
            }
        };

        updateSvgMap(data);

        // 4. Render ECharts Donut Charts
        if (typeof echarts !== 'undefined') {
            const getCount = (keywords) => {
                if (!data.depData) return null;
                const rec = data.depData.find(d => keywords.some(k => (d.dep_name || '').toLowerCase().includes(k)));
                return rec ? rec.visit_count : null;
            };

            // OPD (84% - 72/85)
            const opdCount = getCount(['ทั่วไป', 'opd']) ?? 72;
            const opdTotal = opdCount === 72 ? 85 : Math.max(opdCount, 85);
            renderEchartsDonut('chart-opd', 'opd-stats-label', opdCount, opdTotal, '#2dd4bf');

            // ER (65% - 17/26)
            const erCount = getCount(['ฉุกเฉิน', 'er', 'อุบัติเหตุ']) ?? 17;
            const erTotal = erCount === 17 ? 26 : Math.max(erCount, 26);
            renderEchartsDonut('chart-er', 'er-stats-label', erCount, erTotal, '#f97316');

            // NCD (78% - 94/120)
            const ncdCount = getCount(['โรคเรื้อรัง', 'ncd', 'เบาหวาน', 'ความดัน']) ?? 94;
            const ncdTotal = ncdCount === 94 ? 120 : Math.max(ncdCount, 120);
            renderEchartsDonut('chart-ncd', 'ncd-stats-label', ncdCount, ncdTotal, '#38bdf8');

            // Dental (52% - 21/40)
            const dentalCount = getCount(['ทันตกรรม', 'dental', 'ทำฟัน']) ?? 21;
            const dentalTotal = dentalCount === 21 ? 40 : Math.max(dentalCount, 40);
            renderEchartsDonut('chart-dental', 'dental-stats-label', dentalCount, dentalTotal, '#22c55e');
        }
        this.resizeLiveCharts();
    }
};

// Helper for rendering Donut Charts
function renderEchartsDonut(elementId, labelId, completed, total, color) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    let myChart = echarts.getInstanceByDom(chartDom);
    if (!myChart) {
        myChart = echarts.init(chartDom);
    }

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const remaining = Math.max(0, total - completed);

    const labelEl = document.getElementById(labelId);
    if (labelEl) {
        labelEl.textContent = `เป้าหมายสะสมรายวัน: ${completed}/${total} ราย`;
    }

    const isDark = document.documentElement.classList.contains('dark');

    const option = {
        series: [
            {
                type: 'pie',
                radius: ['75%', '95%'],
                avoidLabelOverlap: false,
                label: {
                    show: true,
                    position: 'center',
                    formatter: `${percentage}%`,
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    fontFamily: 'Outfit'
                },
                labelLine: { show: false },
                data: [
                    { value: completed, name: 'Done', itemStyle: { color: color } },
                    { value: remaining, name: 'Left', itemStyle: { color: isDark ? '#334155' : '#e2e8f0' } }
                ]
            }
        ]
    };

    myChart.setOption(option);
}
