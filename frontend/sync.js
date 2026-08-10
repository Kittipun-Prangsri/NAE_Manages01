// sync.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState, domRefs } from './state.js';
import { handleApiResponse } from './auth.js';
import { ensureExcelMapping, openExcelMappingModal } from './uploader.js';

export async function handleApiSync(onLoadCallbackObj) {
    const visitDate = domRefs.visitDateInput?.value;
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
            if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
                await onLoadCallbackObj.loadDashboardData();
            }
            if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
                onLoadCallbackObj.loadWeeklySummary();
            }
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

export function parseTSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 1) return [];

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('เลขบัตร') || lines[i].includes('CLAIM CODE') || lines[i].includes('CID')) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) headerIndex = 0;

    const headers = lines[headerIndex].split('\t').map(h => h.trim());
    const results = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cells = lines[i].split('\t');
        if (cells.length < headers.length * 0.5) continue;

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

export async function handlePasteSync(onLoadCallbackObj) {
    const visitDate = domRefs.visitDateInput?.value;
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
                if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
                    await onLoadCallbackObj.loadDashboardData();
                }
                if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
                    onLoadCallbackObj.loadWeeklySummary();
                }
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

export async function handleSyncProcess(onLoadCallbackObj) {
    const visitDate = domRefs.visitDateInput?.value;
    const file = domRefs.excelFileInput?.files[0];

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
            if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
                await onLoadCallbackObj.loadDashboardData();
            }
            if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
                onLoadCallbackObj.loadWeeklySummary();
            }
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

export async function handleAutoPortalSync(onLoadCallbackObj) {
    const visitDate = domRefs.visitDateInput?.value;
    if (!visitDate) {
        alert('กรุณาเลือกวันที่ต้องการดึงข้อมูลก่อน');
        return;
    }

    if (!confirm(`คุณต้องการสั่งให้บอทดาวน์โหลดรายงานจากเว็บ สปสช. ของวันที่ ${visitDate} และประมวลผล Sync ข้อมูลโดยอัตโนมัติใช่หรือไม่?\n(คุณสามารถสแกน QR Code เพื่อล็อกอินผ่านทางหน้าจอนี้ หรือห้องแชท Telegram/LINE)`)) {
        return;
    }

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

    const handleClose = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        syncProgressModal.classList.add('hidden');
        closeSyncProgressBtn.removeEventListener('click', handleClose);
    };
    closeSyncProgressBtn.addEventListener('click', handleClose);

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

        pollInterval = setInterval(async () => {
            try {
                const statusRes = await api.fetchSyncStatus(appState.token);
                if (!statusRes.ok) return;

                const data = statusRes.data;
                syncStatusMessage.textContent = data.message || 'กำลังประมวลผล...';

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

                if (data.step === 'waiting_thaid_scan' && data.qrCodeUrl) {
                    syncQrImage.src = data.qrCodeUrl;
                    syncQrContainer.classList.remove('hidden');
                } else {
                    syncQrContainer.classList.add('hidden');
                }

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
                    if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
                        await onLoadCallbackObj.loadDashboardData();
                    }
                    if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
                        onLoadCallbackObj.loadWeeklySummary();
                    }
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
