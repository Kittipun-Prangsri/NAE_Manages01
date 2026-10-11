// Per-viewer appearance preferences: accent colour and table density.
// Applied as data attributes on <html>; style.css maps them to the brand scale
// and table paddings. index.html applies the saved values before first paint.

export const ACCENTS = ['blue', 'indigo', 'violet', 'teal', 'sky'];
export const DENSITIES = ['compact', 'normal', 'comfortable'];
const DEFAULT_ACCENT = 'blue';
const DEFAULT_DENSITY = 'compact';

function readPref(key, allowed, fallback) {
    try {
        const value = localStorage.getItem(key);
        return allowed.includes(value) ? value : fallback;
    } catch (_) {
        return fallback;
    }
}

function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* storage disabled */ }
}

function applyAccent(accent) {
    const root = document.documentElement;
    if (accent === DEFAULT_ACCENT) delete root.dataset.accent;
    else root.dataset.accent = accent;
    document.querySelectorAll('[data-accent-option]').forEach(btn => {
        btn.setAttribute('aria-checked', String(btn.dataset.accentOption === accent));
    });
}

function applyDensity(density) {
    document.documentElement.dataset.density = density;
    document.querySelectorAll('[data-density-option]').forEach(btn => {
        const active = btn.dataset.densityOption === density;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

export function initAppearanceControls() {
    if (typeof document === 'undefined') return;

    applyAccent(readPref('accent', ACCENTS, DEFAULT_ACCENT));
    applyDensity(readPref('tableDensity', DENSITIES, DEFAULT_DENSITY));

    document.querySelectorAll('[data-accent-option]').forEach(btn => {
        btn.addEventListener('click', () => {
            const accent = btn.dataset.accentOption;
            applyAccent(accent);
            writePref('accent', accent);
        });
    });

    document.querySelectorAll('[data-density-option]').forEach(btn => {
        btn.addEventListener('click', () => {
            const density = btn.dataset.densityOption;
            applyDensity(density);
            writePref('tableDensity', density);
        });
    });

    const toggle = document.getElementById('appearance-btn');
    const menu = document.getElementById('appearance-menu');
    if (!toggle || !menu) return;

    const setOpen = (open) => {
        menu.classList.toggle('hidden', !open);
        toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(menu.classList.contains('hidden'));
    });
    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('hidden') && !menu.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
            setOpen(false);
            toggle.focus();
        }
    });
}
