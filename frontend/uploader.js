// uploader.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState, domRefs } from './state.js';
import { handleApiResponse } from './auth.js';

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function getMissingExcelMappingFields(mapping = appState.excelMapping || {}) {
    return (appState.excelMappingFields || [])
        .filter(field => field.required)
        .filter(field => !mapping[field.key]);
}

export function openExcelMappingModal(payload = {}, message = '') {
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

export function closeExcelMappingModal(confirmed) {
    const modal = document.getElementById('excel-mapping-modal');
    if (modal) modal.classList.add('hidden');
    if (appState.pendingExcelMappingResolve) {
        appState.pendingExcelMappingResolve(confirmed ? appState.excelMapping : null);
        appState.pendingExcelMappingResolve = null;
    }
}

export function saveExcelMappingFromModal() {
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

export async function ensureExcelMapping() {
    const missing = getMissingExcelMappingFields();
    if (missing.length === 0) return appState.excelMapping;
    return openExcelMappingModal({
        headers: appState.excelHeaders,
        mapping: appState.excelMapping,
        mappingFields: appState.excelMappingFields,
        missingRequired: missing
    });
}

export async function handleFileSelection(file, onLoadCallbackObj) {
    if (!file) return;
    ui.updateDropzoneUI(file);
    appState.excelMapping = null;
    appState.excelHeaders = [];
    appState.excelMappingFields = [];

    ui.setLoading(true);
    try {
        const response = await api.probeDate(file, appState.token);
        if (handleApiResponse(response)) {
            appState.excelMapping = response.data.mapping || null;
            appState.excelHeaders = response.data.headers || [];
            appState.excelMappingFields = response.data.mappingFields || [];
            if (response.data.detected_date && domRefs.visitDateInput) {
                domRefs.visitDateInput.value = response.data.detected_date;
            }
            if (response.data.missingRequired?.length > 0) {
                openExcelMappingModal(response.data, 'ระบบอ่านบางคอลัมน์ไม่มั่นใจ กรุณาจับคู่คอลัมน์ที่จำเป็นก่อนกดประมวลผล');
            }
            if (domRefs.visitDateInput && domRefs.visitDateInput.value) {
                if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
                    await onLoadCallbackObj.loadDashboardData();
                }
                if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
                    onLoadCallbackObj.loadWeeklySummary();
                }
            }
        }
    } catch (error) {
        console.warn("ไม่สามารถอ่านวันที่จากไฟล์อัตโนมัติได้:", error);
    } finally {
        ui.setLoading(false);
    }
}

export function setupFileUpload(onLoadCallbackObj) {
    const dropzone = document.getElementById('dropzone');
    if (!dropzone || !domRefs.excelFileInput) return;

    dropzone.addEventListener('click', () => domRefs.excelFileInput.click());

    domRefs.excelFileInput.addEventListener('change', (e) => {
        handleFileSelection(e.target.files[0], onLoadCallbackObj);
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
        handleFileSelection(file, onLoadCallbackObj);

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        domRefs.excelFileInput.files = dataTransfer.files;
    });
}
