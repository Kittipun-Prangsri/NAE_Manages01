// Keyboard behaviour shared by every `.modal` overlay in index.html:
//  - focus moves into the dialog when it opens and returns to the trigger when it closes
//  - Tab / Shift+Tab stay inside the open dialog
//  - Escape closes it through its own close/cancel button, so each modal's
//    existing close logic (promise resolution, state resets) still runs
// Modals are shown/hidden by toggling the `hidden` class, so a MutationObserver
// picks up openings without touching each module's open/close functions.

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

// The loading overlay is a status indicator, not a dialog the user can dismiss.
const isDialog = (el) => el.classList.contains('modal') && el.id !== 'loading-overlay';
const isOpen = (el) => !el.classList.contains('hidden') && el.isConnected;

function focusablesIn(modal) {
    return [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
}

function topOpenModal() {
    const open = [...document.querySelectorAll('.modal')].filter(el => isDialog(el) && isOpen(el));
    return open[open.length - 1] || null;
}

function closeButtonFor(modal) {
    return modal.querySelector('[id^="close-"], [id^="cancel-"], [data-action="cancel"]');
}

export function initModalAccessibility() {
    if (typeof document === 'undefined') return;
    const returnFocus = new WeakMap();

    const onOpen = (modal) => {
        returnFocus.set(modal, document.activeElement);
        const items = focusablesIn(modal);
        // Prefer the first form field; otherwise the first control in the dialog.
        const target = items.find(el => el.matches('input, select, textarea')) || items[0];
        requestAnimationFrame(() => target?.focus());
    };

    const onClose = (modal) => {
        const previous = returnFocus.get(modal);
        returnFocus.delete(modal);
        if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    };

    const observer = new MutationObserver(records => {
        records.forEach(({ target, oldValue }) => {
            const wasHidden = (oldValue || '').split(/\s+/).includes('hidden');
            const nowHidden = target.classList.contains('hidden');
            if (wasHidden && !nowHidden) onOpen(target);
            else if (!wasHidden && nowHidden) onClose(target);
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        if (!isDialog(modal)) return;
        observer.observe(modal, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });

    document.addEventListener('keydown', (e) => {
        const modal = topOpenModal();
        if (!modal) return;

        if (e.key === 'Escape') {
            // A disabled close button (e.g. Sync still running) means "not closable yet".
            const closeBtn = closeButtonFor(modal);
            if (closeBtn && !closeBtn.disabled) {
                e.preventDefault();
                closeBtn.click();
            }
            return;
        }

        if (e.key !== 'Tab') return;
        const items = focusablesIn(modal);
        if (items.length === 0) {
            e.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (!modal.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}
