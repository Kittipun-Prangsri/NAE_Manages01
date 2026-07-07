// app.js
import { api } from './api.js';
import { ui } from './ui.js';
import { exportToCsv, isTokenExpired } from './utils.js';

// App State
let isLoggingOut = false;

const getInitialState = () => {
    if (typeof localStorage === 'undefined') {
        return {
            token: null,
            user: null,
            rawTableData: [],
            savedQueries: [],
            currentQueryResults: [],
            querySortBy: '',
            querySortDesc: false,
            trackerSortBy: '',
            trackerSortDesc: false,
            trackerSearchFilter: '',
            liveDashboardInterval: null
        };
    }
    return {
        token: localStorage.getItem('nhso_token'),
        user: JSON.parse(localStorage.getItem('nhso_user')),
        rawTableData: [],
        savedQueries: [],
        currentQueryResults: [],
        querySortBy: '',
        querySortDesc: false,
        trackerSortBy: '',
        trackerSortDesc: false,
        trackerSearchFilter: '',
        liveDashboardInterval: null
    };
};

let appState = getInitialState();

// Form Elements
let visitDateInput;
let excelFileInput;

// Initialize Application
function init() {
    if (typeof document === 'undefined') return;
    
    ui.initTheme();

    // Fetch elements safely
    visitDateInput = document.getElementById('visit-date');
    excelFileInput = document.getElementById('excel-file');

    if (appState.token && appState.user) {
        if (isTokenExpired(appState.token)) {
            console.warn('Session expired (checked locally). Logging out.');
            handleLogout();
            return;
        }
        ui.showDashboard(appState.user.full_name || appState.user.name);
        updateAdminLoginBtnVisibility();
        if (appState.user.role === 'admin') {
            document.getElementById('tab-admin')?.classList.remove('hidden');
        }
        if (visitDateInput) visitDateInput.valueAsDate = new Date();
        loadDashboardData();
        loadSavedQueries();
    } else {
        ui.showLogin();
    }

    setupEventListeners();
}

function setupEventListeners() {
    // Theme & UX
    document.getElementById('theme-toggle')?.addEventListener('click', ui.toggleTheme);
    document.getElementById('toggle-list-btn')?.addEventListener('click', ui.togglePatientList);
    setupBackToTop();

    // Authentication
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    // Main Actions
    document.getElementById('sync-btn')?.addEventListener('click', handleSyncProcess);
    document.getElementById('paste-sync-btn')?.addEventListener('click', handlePasteSync);
    document.getElementById('api-sync-btn')?.addEventListener('click', handleApiSync);
    document.getElementById('auto-portal-btn')?.addEventListener('click', handleAutoPortalSync);
    document.getElementById('manual-capture-btn')?.addEventListener('click', handleManualCapture);
    document.getElementById('refresh-btn')?.addEventListener('click', loadDashboardData);
    visitDateInput?.addEventListener('change', loadDashboardData);
    
    // Homepage table sorting
    document.querySelectorAll('#tracking-table-thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            if (appState.trackerSortBy === field) {
                appState.trackerSortDesc = !appState.trackerSortDesc;
            } else {
                appState.trackerSortBy = field;
                appState.trackerSortDesc = false;
            }
            renderTrackerTable();
        });
    });

    // Homepage table search input
    document.getElementById('tracker-search-input')?.addEventListener('input', (e) => {
        appState.trackerSearchFilter = e.target.value;
        renderTrackerTable();
    });
    
    // Export Data
    document.getElementById('export-error-btn')?.addEventListener('click', handleExportErrors);

    // File Upload & Drag-Drop (with Auto-Date Detection)
    setupFileUpload();

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
    document.getElementById('add-schedule-form')?.addEventListener('submit', handleAddSchedule);

    // Admin quick login modal listeners
    document.getElementById('admin-login-btn')?.addEventListener('click', openAdminLoginModal);
    document.getElementById('close-admin-login-modal')?.addEventListener('click', closeAdminLoginModal);
    document.getElementById('cancel-admin-login-modal')?.addEventListener('click', closeAdminLoginModal);
    document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminQuickLogin);

    // Grafana SQL Panel Action Events
    document.getElementById('query-template-select')?.addEventListener('change', handleQueryTemplateSelect);
    document.getElementById('run-query-btn')?.addEventListener('click', handleRunQuery);
    document.getElementById('save-query-btn')?.addEventListener('click', handleSaveQuery);
    document.getElementById('delete-query-btn')?.addEventListener('click', handleDeleteQuery);
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
        loadWeeklySummary();
    } else {
        ui.showLoginError(data.message || 'รหัสผ่านไม่ถูกต้อง');
    }
}

function handleLogout() {
    isLoggingOut = true;
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
    
    // Auto-detect Date from Excel
    ui.setLoading(true);
    try {
        const response = await api.probeDate(file, appState.token);
        if (handleApiResponse(response) && response.data.detected_date) {
            visitDateInput.value = response.data.detected_date;
            // โหลดข้อมูล Dashboard ตามวันที่ที่จับได้
            loadDashboardData(); 
            loadWeeklySummary();
        }
    } catch (error) {
        console.warn("ไม่สามารถอ่านวันที่จากไฟล์อัตโนมัติได้:", error);
    } finally {
        ui.setLoading(false);
    }
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
            loadDashboardData();
            loadWeeklySummary();
            openCaptureSelectionModal(visitDate, response.data.message);
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

function openCaptureSelectionModal(visitDate, successMessage = '') {
    const modal = document.getElementById('capture-selection-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const textElem = modal.querySelector('p');
    if (textElem) {
        if (successMessage) {
            textElem.innerText = `${successMessage}\n\nคุณต้องการจัดส่งรายงานข้อมูลสรุปไปยังช่องทางใด?`;
        } else {
            textElem.innerText = `คุณต้องการจัดส่งรายงานข้อมูลสรุปของวันที่ ${visitDate} ไปยังช่องทางใด?`;
        }
    }

    const sendBtn = document.getElementById('send-capture-btn');
    const skipBtn = document.getElementById('skip-capture-btn');
    const closeBtn = document.getElementById('close-capture-modal');

    // Clone buttons to clear existing listeners
    const cleanSendBtn = sendBtn.cloneNode(true);
    const cleanSkipBtn = skipBtn.cloneNode(true);
    const cleanCloseBtn = closeBtn.cloneNode(true);

    sendBtn.parentNode.replaceChild(cleanSendBtn, sendBtn);
    skipBtn.parentNode.replaceChild(cleanSkipBtn, skipBtn);
    closeBtn.parentNode.replaceChild(cleanCloseBtn, closeBtn);

    cleanCloseBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    cleanSkipBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    cleanSendBtn.addEventListener('click', async () => {
        const lineChecked = document.getElementById('capture-target-line').checked;
        const telegramChecked = document.getElementById('capture-target-telegram').checked;
        const summaryChecked = document.getElementById('capture-type-summary').checked;
        const screenshotChecked = document.getElementById('capture-type-screenshot').checked;

        const channels = [];
        if (lineChecked) channels.push('line');
        if (telegramChecked) channels.push('telegram');

        if (channels.length === 0) {
            alert('กรุณาเลือกอย่างน้อย 1 ช่องทางสำหรับการส่งรายงาน');
            return;
        }

        const reportTypes = [];
        if (summaryChecked) reportTypes.push('summary');
        if (screenshotChecked) reportTypes.push('screenshot');

        if (reportTypes.length === 0) {
            alert('กรุณาเลือกรูปแบบรายงานอย่างน้อย 1 รูปแบบ');
            return;
        }

        modal.classList.add('hidden');
        ui.setLoading(true);
        try {
            const response = await api.triggerCapture(visitDate, channels, reportTypes, appState.token);
            if (handleApiResponse(response)) {
                alert(response.data.message || 'ส่งรายงานเรียบร้อยแล้ว');
            } else if (response.status !== 401 && response.status !== 403) {
                alert(response.data.message || 'เกิดข้อผิดพลาดในการบันทึกหน้าจอ/ส่งรายงาน');
            }
        } catch (error) {
            console.error('Trigger capture error:', error);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
        } finally {
            ui.setLoading(false);
        }
    });
}

async function handleManualCapture() {
    const visitDate = visitDateInput?.value;
    if (!visitDate) {
        alert('กรุณาระบุวันที่ที่ต้องการบันทึกหน้าจอ');
        return;
    }
    openCaptureSelectionModal(visitDate);
}

async function handleAutoPortalSync() {
    const visitDate = visitDateInput.value;
    if (!visitDate) {
        alert('กรุณาเลือกวันที่ต้องการดึงข้อมูลก่อน');
        return;
    }

    if (!confirm(`คุณต้องการสั่งให้บอทดาวน์โหลดรายงานจากเว็บ สปสช. ของวันที่ ${visitDate} และประมวลผล Sync ข้อมูลโดยอัตโนมัติใช่หรือไม่?\n(คุณจะต้องสแกน QR Code ที่ได้รับใน Telegram เพื่อเข้าสู่ระบบ)`)) {
        return;
    }

    ui.setLoading(true);
    try {
        const response = await api.triggerPortalSync(visitDate, appState.token);
        if (handleApiResponse(response)) {
            alert(response.data.message || 'ดาวน์โหลดรายงานและประมวลผลข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
            loadDashboardData();
            loadWeeklySummary();
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการรันดาวน์โหลดรายงาน');
        }
    } catch (error) {
        console.error('Auto portal sync error:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
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
                loadDashboardData();
                loadWeeklySummary();
                openCaptureSelectionModal(visitDate, response.data.message);
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

    ui.setLoading(true);
    try {
        const response = await api.processSync(visitDate, file, appState.token);
        if (handleApiResponse(response)) {
            // โหลดข้อมูลล่าสุดมาแสดงในตาราง
            loadDashboardData();
            loadWeeklySummary();
            openCaptureSelectionModal(visitDate, response.data.message);
        } else if (response.status !== 401 && response.status !== 403) {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการประมวลผล');
        }
    } catch (error) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

async function loadWeeklySummary() {
    try {
        const response = await api.fetchSummary(appState.token);
        if (handleApiResponse(response)) {
            ui.renderWeeklySummary(response.data, (selectedDate) => {
                visitDateInput.value = selectedDate;
                loadDashboardData();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        } else if (data.message === 'Forbidden' || data.message === 'Session Expired' || data.message === 'Unauthorized') {
            handleLogout();
        }
    } catch (error) {
        console.error('Failed to load weekly summary:', error);
    }
}

async function loadDashboardData() {
    const date = visitDateInput.value;
    if (!date) return;

    ui.setLoading(true);
    try {
        const response = await api.fetchDashboard(date, appState.token);
        if (handleApiResponse(response)) {
            const data = response.data;
            // data now contains { trackingData: [], hosxpStats: { totalPersons: X, totalVisits: Y } }
            appState.rawTableData = data.trackingData || [];
            renderTrackerTable();
            ui.updateStats(appState.rawTableData, data.hosxpStats);
        }
    } catch (error) {
        console.error('Fetch error:', error);
    } finally {
        ui.setLoading(false);
    }
}

async function loadLiveDashboardData() {
    const date = visitDateInput.value || new Date().toISOString().split('T')[0];
    if (!appState.token) return;

    try {
        const response = await api.fetchLiveDashboardData(date, appState.token);
        if (handleApiResponse(response)) {
            ui.renderLiveDashboard(response.data);
        }
    } catch (error) {
        console.error('❌ Failed to load live dashboard data:', error);
    }
}

function getFilteredAndSortedTrackerData() {
    let data = [...appState.rawTableData];

    // Search filter
    const searchFilter = appState.trackerSearchFilter;
    if (searchFilter) {
        const query = searchFilter.toLowerCase();
        data = data.filter(item => {
            return Object.values(item).some(val => 
                String(val || '').toLowerCase().includes(query)
            );
        });
    }

    // Sorting
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

function renderTrackerTable() {
    const data = getFilteredAndSortedTrackerData();
    ui.renderTable(data, appState.trackerSortBy, appState.trackerSortDesc);
}

function handleExportErrors() {
    if (!appState.rawTableData || appState.rawTableData.length === 0) return;

    // กรองเอาเฉพาะสีแดง (รอ Authen) และ สีเหลือง (รอปิด Endpoint)
    const errorData = appState.rawTableData.filter(item => 
        item.color_status === 'RED' || item.color_status === 'YELLOW'
    );

    if (errorData.length === 0) {
        alert("ไม่มีรายการที่ต้องแก้ไข (ทุกรายการเป็นสีเขียว)");
        return;
    }

    // จัดรูปแบบข้อมูลสำหรับ Excel/CSV
    const exportData = errorData.map(item => ({
        'วันที่รับบริการ': item.visit_date.split('T')[0],
        'VN': item.vn,
        'เลขบัตรประชาชน': item.cid,
        'ชื่อ-สกุล': item.full_name,
        'สิทธิ (HOSxP)': item.pttype,
        'Authen Code': item.nhso_authen_code || 'ไม่มี',
        'สถานะ': item.color_status === 'RED' ? 'ยังไม่เปิด Authen' : 'รอปิด Endpoint'
    }));

    const dateStr = visitDateInput.value;
    exportToCsv(`NHSO_Error_Report_${dateStr}.csv`, exportData);
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

// --- Grafana SQL Dashboard Handlers ---

// จัดการสลับหน้าจอ Tab
function handleTabSwitch(tabId) {
    // Clear any active live dashboard refresh interval first
    if (appState.liveDashboardInterval) {
        clearInterval(appState.liveDashboardInterval);
        appState.liveDashboardInterval = null;
    }

    ui.switchTab(tabId);

    if (tabId === 'tab-live-dashboard') {
        loadLiveDashboardData();
        // Start auto-refresh polling every 30 seconds
        appState.liveDashboardInterval = setInterval(loadLiveDashboardData, 30000);
    } else if (tabId === 'tab-grafana') {
        const dateInput = document.getElementById('query-visit-date');
        if (!dateInput.value) {
            dateInput.value = visitDateInput.value || new Date().toISOString().split('T')[0];
        }
        loadSavedQueries();
    } else if (tabId === 'tab-admin') {
        handleAdminSubtabSwitch('users');
    }
}

// --- Admin User Management Handlers ---

async function loadAdminUsers() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchUsers(appState.token);
        if (ok) {
            ui.renderAdminUsers(data, openUserModal, handleDeleteUser, handleTestNotification);
        } else {
            console.error('Failed to fetch users:', data.message);
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    } finally {
        ui.setLoading(false);
    }
}

function openUserModal(user = null) {
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const form = document.getElementById('user-form');
    
    if (!modal) return;

    form.reset();

    if (user) {
        title.textContent = 'แก้ไขข้อมูลผู้ใช้งาน';
        document.getElementById('modal-user-id').value = user.id;
        document.getElementById('modal-username').value = user.username;
        document.getElementById('modal-username').disabled = true; // Don't allow changing username
        document.getElementById('modal-fullname').value = user.full_name || '';
        document.getElementById('modal-role').value = user.role || 'user';
        document.getElementById('modal-department').value = user.department || '';
        document.getElementById('modal-line-token').value = user.line_token || '';
        document.getElementById('modal-line-group-id').value = user.line_group_id || '';
        document.getElementById('modal-telegram-token').value = user.telegram_token || '';
        document.getElementById('modal-telegram-chat-id').value = user.telegram_chat_id || '';
    } else {
        title.textContent = 'เพิ่มผู้ใช้งานใหม่';
        document.getElementById('modal-user-id').value = '';
        document.getElementById('modal-username').disabled = false;
    }

    modal.classList.remove('hidden');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('modal-user-id').value;
    const userData = {
        username: document.getElementById('modal-username').value,
        full_name: document.getElementById('modal-fullname').value,
        role: document.getElementById('modal-role').value,
        department: document.getElementById('modal-department').value,
        line_token: document.getElementById('modal-line-token').value || null,
        line_group_id: document.getElementById('modal-line-group-id').value || null,
        telegram_token: document.getElementById('modal-telegram-token').value || null,
        telegram_chat_id: document.getElementById('modal-telegram-chat-id').value || null
    };

    ui.setLoading(true);
    try {
        let response;
        if (id) {
            response = await api.updateUser(id, userData, appState.token);
        } else {
            response = await api.createUser(userData, appState.token);
        }

        if (response.ok) {
            alert(response.data.message || 'บันทึกสำเร็จ');
            closeUserModal();
            loadAdminUsers();
        } else {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการบันทึก');
        }
    } catch (error) {
        console.error('Error saving user:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

async function handleDeleteUser(id) {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้นี้ออกจากระบบ?')) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteUser(id, appState.token);
        if (ok) {
            alert(data.message || 'ลบผู้ใช้สำเร็จ');
            loadAdminUsers();
        } else {
            alert(data.message || 'ลบผู้ใช้ไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

async function handleTestNotification(type, user) {
    const tokenVal = type === 'line' ? user.line_token : user.telegram_token;
    const targetVal = type === 'line' ? user.line_group_id : user.telegram_chat_id;

    if (!tokenVal || !targetVal) {
        alert('กรุณากรอกข้อมูล Token และ ID ปลายทางให้ครบถ้วนก่อนทดสอบ');
        return;
    }

    ui.setLoading(true);
    try {
        const { ok, data } = await api.testNotification(type, tokenVal, targetVal, appState.token);
        if (ok) {
            alert(data.message || 'ส่งข้อความทดสอบสำเร็จ!');
        } else {
            alert(data.message || 'ส่งข้อความทดสอบล้มเหลว');
        }
    } catch (error) {
        console.error('Error testing notification:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + error.message);
    } finally {
        ui.setLoading(false);
    }
}

// --- Admin Schedules Management Handlers ---

function handleAdminSubtabSwitch(subtab) {
    const btnUsers = document.getElementById('admin-subtab-users');
    const btnSchedules = document.getElementById('admin-subtab-schedules');
    const viewUsers = document.getElementById('admin-subview-users');
    const viewSchedules = document.getElementById('admin-subview-schedules');

    if (!btnUsers || !btnSchedules || !viewUsers || !viewSchedules) return;

    const activeClass = 'flex-1 px-4 py-2 text-xs font-bold tracking-wide rounded-lg transition cursor-pointer text-center bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400';
    const inactiveClass = 'flex-1 px-4 py-2 text-xs font-bold tracking-wide rounded-lg transition cursor-pointer text-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';

    if (subtab === 'users') {
        btnUsers.className = activeClass;
        btnSchedules.className = inactiveClass;
        viewUsers.classList.remove('hidden');
        viewSchedules.classList.add('hidden');
        loadAdminUsers();
    } else if (subtab === 'schedules') {
        btnUsers.className = inactiveClass;
        btnSchedules.className = activeClass;
        viewUsers.classList.add('hidden');
        viewSchedules.classList.remove('hidden');
        loadAdminSchedules();
    }
}

async function loadAdminSchedules() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchSchedules(appState.token);
        if (ok) {
            ui.renderAdminSchedules(data.schedules, handleToggleSchedule, handleDeleteSchedule);
        } else {
            console.error('Failed to fetch schedules:', data.message);
        }
    } catch (error) {
        console.error('Error loading admin schedules:', error);
    } finally {
        ui.setLoading(false);
    }
}

async function handleAddSchedule(e) {
    e.preventDefault();
    const timeInput = document.getElementById('new-schedule-time');
    if (!timeInput || !timeInput.value) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.createSchedule(timeInput.value, appState.token);
        if (ok) {
            alert(data.message || 'เพิ่มเวลาทำงานสำเร็จ');
            timeInput.value = '';
            loadAdminSchedules();
        } else {
            alert(data.message || 'เพิ่มเวลาทำงานไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

async function handleToggleSchedule(id, enabled) {
    try {
        const { ok, data } = await api.updateSchedule(id, { is_enabled: enabled }, appState.token);
        if (ok) {
            loadAdminSchedules();
        } else {
            alert(data.message || 'อัปเดตสถานะไม่สำเร็จ');
            loadAdminSchedules();
        }
    } catch (error) {
        console.error('Error toggling schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        loadAdminSchedules();
    }
}

async function handleDeleteSchedule(id, timeStr) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบเวลาทำงาน ${timeStr} น. ออกจากระบบ?`)) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteSchedule(id, appState.token);
        if (ok) {
            alert(data.message || 'ลบเวลาทำงานสำเร็จ');
            loadAdminSchedules();
        } else {
            alert(data.message || 'ลบไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

// โหลดรายการ SQL Queries ที่บันทึกไว้ในระบบ
async function loadSavedQueries(selectedId = '') {
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

// เมื่อเลือกคำสั่งใน Dropdown ให้โหลดใส่ Editor
function handleQueryTemplateSelect(e) {
    const queryId = e.target.value;
    const selected = appState.savedQueries.find(q => String(q.id) === String(queryId));
    if (selected) {
        document.getElementById('sql-editor').value = selected.query_text;
        document.getElementById('query-db-type').value = selected.db_type;
        document.getElementById('new-query-name').value = selected.name;
    }
}

// รันคำสั่ง SQL
async function handleRunQuery() {
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

// จัดการคัดกรองการเรียงลำดับหัวข้อคอลัมน์
function handleQueryHeaderClick(column) {
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

// ส่งออกผลลัพธ์เป็นไฟล์ CSV
function handleQueryExport() {
    if (!appState.currentQueryResults || appState.currentQueryResults.length === 0) {
        alert('ไม่มีข้อมูลให้ส่งออก');
        return;
    }
    
    const dbType = document.getElementById('query-db-type').value;
    const date = document.getElementById('query-visit-date').value;
    
    const exportData = appState.currentQueryResults.map(row => {
        const formatted = {};
        for (const [key, value] of Object.entries(row)) {
            // จัดการ Binary buffer ใน JavaScript
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

// บันทึกคำสั่ง SQL ปัจจุบัน
async function handleSaveQuery() {
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

// ลบคำสั่ง SQL ปัจจุบัน
async function handleDeleteQuery() {
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

// ค้นหาและกรองตารางแบบ Dynamic
function handleQuerySearch(e) {
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

// --- Admin Quick Login Logic & Functions ---

function updateAdminLoginBtnVisibility() {
    const btn = document.getElementById('admin-login-btn');
    const roleEl = document.getElementById('user-role');
    if (appState.user) {
        if (roleEl) {
            roleEl.textContent = appState.user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 
                                 appState.user.role === 'viewer' ? 'ผู้เข้าชม (Viewer)' : 'ผู้ใช้งาน (User)';
        }
        if (btn) {
            if (appState.user.role === 'admin') {
                btn.classList.add('hidden');
            } else {
                btn.classList.remove('hidden');
            }
        }
    }
}

function openAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    if (modal) {
        document.getElementById('admin-login-password').value = '';
        modal.classList.remove('hidden');
        document.getElementById('admin-login-password').focus();
    }
}

function closeAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleAdminQuickLogin(e) {
    e.preventDefault();
    const password = document.getElementById('admin-login-password').value;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.login('admin', password);
        if (ok) {
            appState.token = data.token;
            appState.user = data.user;
            
            // Save to LocalStorage
            localStorage.setItem('nhso_token', data.token);
            localStorage.setItem('nhso_user', JSON.stringify(data.user));
            localStorage.setItem('username', data.user.username);
            localStorage.setItem('fullname', data.user.full_name);
            localStorage.setItem('department', data.user.department || '');
            localStorage.setItem('role', data.user.role);
            
            // Show Admin Panel tab
            document.getElementById('tab-admin')?.classList.remove('hidden');
            
            closeAdminLoginModal();
            updateAdminLoginBtnVisibility();
            
            alert('เข้าสู่ระบบสิทธิ์ Admin สำเร็จ!');
            
            // Render the dashboard header name and refresh data
            ui.showDashboard(data.user.full_name);
            
            // Load admin tab automatically or refresh dashboard data
            handleTabSwitch('tab-admin');
        } else {
            alert(data.message || 'รหัสผ่าน Admin ไม่ถูกต้อง');
        }
    } catch (err) {
        console.error('Admin quick login error:', err);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

// Filter tracker table by subdistrict when clicking a map bubble
window.filterDashboardByTambon = function(code) {
    const tambonNames = {
        '270501': 'คลองหาด',
        '270502': 'ไทยอุดม',
        '270503': 'ซับมะกรูด',
        '270504': 'ไทรเดี่ยว',
        '270505': 'ไทรทอง',
        '270506': 'คลองไก่เถื่อน',
        '270507': 'เบญจขร'
    };
    const name = tambonNames[code];
    if (!name) return;

    // Set search filter
    appState.trackerSearchFilter = name;
    
    // Update Search input element value
    const searchInput = document.getElementById('tracker-search');
    if (searchInput) {
        searchInput.value = name;
    }

    // Switch tab to the Tracker view
    handleTabSwitch('tab-tracker');
    
    // Load tracking data
    loadDashboardData();
};

// Start App
init();
