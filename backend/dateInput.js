// Shared by the LINE webhook and Telegram commands so both accept the same date formats.

/**
 * Parses user-provided date strings into YYYY-MM-DD format.
 * Supports DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and Thai BE years (e.g. 2569 -> 2026).
 */
export function parseInputDate(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.trim();

    // 1. Pattern: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    let match = cleanStr.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
    if (match) {
        let year = parseInt(match[1], 10);
        if (year > 2400) year -= 543; // Convert B.E. to A.D.
        const month = String(parseInt(match[2], 10)).padStart(2, '0');
        const day = String(parseInt(match[3], 10)).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // 2. Pattern: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
    match = cleanStr.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/);
    if (match) {
        const day = String(parseInt(match[1], 10)).padStart(2, '0');
        const month = String(parseInt(match[2], 10)).padStart(2, '0');
        let year = parseInt(match[3], 10);
        if (year > 2400) year -= 543; // Convert B.E. to A.D.
        return `${year}-${month}-${day}`;
    }

    return null;
}

/**
 * Extracts a date from a command string or falls back to today's date in Bangkok.
 */
export function extractQueryDate(text) {
    const defaultDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    if (!text) return defaultDate;

    // Search for date patterns inside text
    const dateMatch = text.match(/(\d{1,2}[-/. ]\d{1,2}[-/. ]\d{4}|\d{4}[-/. ]\d{1,2}[-/. ]\d{1,2})/);
    if (dateMatch) {
        const parsed = parseInputDate(dateMatch[1]);
        if (parsed) return parsed;
    }

    return defaultDate;
}
