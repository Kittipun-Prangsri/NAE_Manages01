// Non-blocking toasts and an in-app confirm dialog, replacing window.alert/confirm.
// Nothing touches the DOM at import time, so modules that import this stay
// loadable under Node (tests import ui.js).

const FLASH_KEY = 'nhso_flash_toast';
const MAX_TOASTS = 4;

const TOAST_STYLES = {
    success: { icon: 'fa-circle-check', duration: 3500 },
    info: { icon: 'fa-circle-info', duration: 4500 },
    warning: { icon: 'fa-triangle-exclamation', duration: 6500 },
    error: { icon: 'fa-circle-xmark', duration: 9000 }
};

function getRegion() {
    let region = document.getElementById('toast-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.className = 'toast-region';
        document.body.appendChild(region);
    }
    return region;
}

function dismiss(toast) {
    if (!toast.isConnected || toast.dataset.leaving) return;
    toast.dataset.leaving = 'true';
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
}

function showToast(type, message) {
    if (typeof document === 'undefined') return;
    const style = TOAST_STYLES[type] || TOAST_STYLES.info;
    const region = getRegion();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Errors interrupt screen readers; everything else waits politely.
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('i');
    icon.className = `fas ${style.icon} toast-icon`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.className = 'toast-message';
    text.textContent = String(message ?? '');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'ปิดการแจ้งเตือน');
    close.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
    close.addEventListener('click', () => dismiss(toast));

    toast.append(icon, text, close);
    region.appendChild(toast);
    while (region.children.length > MAX_TOASTS) region.firstElementChild.remove();

    // Pause the countdown while the pointer is over the toast so it can be read.
    let timer = setTimeout(() => dismiss(toast), style.duration);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
        timer = setTimeout(() => dismiss(toast), 2000);
    });
}

export const notify = {
    success: (message) => showToast('success', message),
    info: (message) => showToast('info', message),
    warning: (message) => showToast('warning', message),
    error: (message) => showToast('error', message),

    // For messages that must survive a page reload (e.g. session expiry → logout).
    flash(type, message) {
        try {
            sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message }));
        } catch (_) {
            showToast(type, message);
        }
    },

    showPendingFlash() {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(FLASH_KEY);
            if (!raw) return;
            sessionStorage.removeItem(FLASH_KEY);
            const { type, message } = JSON.parse(raw);
            showToast(type, message);
        } catch (_) { /* ignore malformed flash */ }
    }
};

/**
 * In-app replacement for window.confirm.
 * @returns {Promise<boolean>} true when the user confirms.
 */
export function confirmDialog(message, {
    title = 'ยืนยันการดำเนินการ',
    confirmText = 'ยืนยัน',
    cancelText = 'ยกเลิก',
    danger = false
} = {}) {
    if (typeof document === 'undefined') return Promise.resolve(false);

    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'confirm-dialog-title');
        overlay.setAttribute('aria-describedby', 'confirm-dialog-message');
        overlay.dataset.dynamicModal = 'true';

        const tone = danger
            ? { tile: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300', icon: 'fa-trash-can', btn: 'btn-danger' }
            : { tile: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300', icon: 'fa-circle-question', btn: 'btn-primary' };

        overlay.innerHTML = `
            <div class="modal-panel max-w-md">
                <div class="modal-body flex gap-4 pt-6">
                    <span class="icon-tile size-10 ${tone.tile}"><i class="fas ${tone.icon}" aria-hidden="true"></i></span>
                    <div class="min-w-0">
                        <h3 id="confirm-dialog-title" class="text-base font-bold text-slate-900 dark:text-white"></h3>
                        <p id="confirm-dialog-message" class="mt-1.5 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300"></p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-action="cancel"></button>
                    <button type="button" class="btn ${tone.btn}" data-action="confirm"></button>
                </div>
            </div>`;
        overlay.querySelector('#confirm-dialog-title').textContent = title;
        overlay.querySelector('#confirm-dialog-message').textContent = String(message ?? '');
        const cancelBtn = overlay.querySelector('[data-action="cancel"]');
        const confirmBtn = overlay.querySelector('[data-action="confirm"]');
        cancelBtn.textContent = cancelText;
        confirmBtn.textContent = confirmText;

        const finish = (result) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(false);
            }
        };

        cancelBtn.addEventListener('click', () => finish(false));
        confirmBtn.addEventListener('click', () => finish(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(overlay);
        // Destructive actions default to Cancel so a stray Enter can't delete data.
        (danger ? cancelBtn : confirmBtn).focus();
    });
}
