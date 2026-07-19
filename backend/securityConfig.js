const DEFAULT_EXCEL_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const MIN_EXCEL_UPLOAD_LIMIT_BYTES = 1 * 1024 * 1024;
const MAX_EXCEL_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

export function getExcelUploadLimitBytes(value = process.env.MAX_EXCEL_UPLOAD_BYTES) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_EXCEL_UPLOAD_LIMIT_BYTES || parsed > MAX_EXCEL_UPLOAD_LIMIT_BYTES) {
        return DEFAULT_EXCEL_UPLOAD_LIMIT_BYTES;
    }
    return parsed;
}

export function getAllowedCorsOrigins(value = process.env.CORS_ORIGINS) {
    return String(value || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
}

export function createCorsOptions({ nodeEnv = process.env.NODE_ENV, corsOrigins = process.env.CORS_ORIGINS } = {}) {
    const allowedOrigins = getAllowedCorsOrigins(corsOrigins);
    // Development stays convenient. Production defaults to same-origin only
    // unless an explicit allowlist is supplied.
    if (nodeEnv !== 'production' || allowedOrigins.length === 0) {
        return { origin: nodeEnv !== 'production' };
    }
    return {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            const error = new Error('CORS origin is not allowed');
            error.code = 'CORS_ORIGIN_DENIED';
            return callback(error);
        }
    };
}
