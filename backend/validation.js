export function isValidDateString(value) {
    if (typeof value !== 'string') return false;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const [, year, month, day] = match;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime())
        && date.getUTCFullYear() === Number(year)
        && date.getUTCMonth() + 1 === Number(month)
        && date.getUTCDate() === Number(day);
}

export function isValidTimeString(value) {
    if (typeof value !== 'string') return false;
    const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return Boolean(match);
}

export function normalizeChannels(channels) {
    const allowed = new Set(['line', 'telegram']);
    if (!Array.isArray(channels)) return ['line', 'telegram'];
    const normalized = channels.filter(channel => allowed.has(channel));
    return normalized.length > 0 ? normalized : ['line', 'telegram'];
}

export function normalizeReportTypes(reportTypes) {
    const allowed = new Set(['summary', 'screenshot']);
    if (!Array.isArray(reportTypes)) return ['summary', 'screenshot'];
    const normalized = reportTypes.filter(reportType => allowed.has(reportType));
    return normalized.length > 0 ? normalized : ['summary', 'screenshot'];
}
