import pino from 'pino';

// Logs are kept on disk, so tokens, one-time codes and national ID numbers are
// removed from error details before they are written.
const SECRET_PATTERNS = [
    [/bot\d+:[A-Za-z0-9_-]+/g, 'bot<hidden>'],
    [/\b(code|txID|token|access_token|client_secret|password)=[^&\s"']+/gi, '$1=<hidden>'],
    [/(?<!\d)\d{13}(?!\d)/g, '<cid>']
];

export const redact = text => SECRET_PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);

function sanitize(value, depth = 0) {
    if (typeof value === 'string') return redact(value);
    if (value instanceof Error) return serializeError(value);
    if (!value || typeof value !== 'object') return value;
    if (depth >= 3) return '[nested]';
    if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, depth + 1)]));
}

function serializeError(error) {
    if (!(error instanceof Error)) return sanitize(error);
    // mysql errors carry the full statement, with patient values filled in.
    const { sql, ...details } = pino.stdSerializers.err(error);
    return sanitize({ ...details });
}

/**
 * pino drops arguments after the message unless it has a placeholder, so
 * logger.error('failed:', err) lost the error.  Move them into the log object.
 */
function keepExtraArgs(args) {
    const [message, ...extras] = args;
    if (typeof message !== 'string' || !extras.length || /%[sdifjoO]/.test(message)) return args;
    const error = extras.find(extra => extra instanceof Error);
    const others = extras.filter(extra => extra !== error);
    const context = {};
    if (error) context.err = error;
    if (others.length) context.detail = sanitize(others.length === 1 ? others[0] : others);
    return [context, message];
}

export function createLoggerOptions(level = process.env.LOG_LEVEL || 'info') {
    return {
        level,
        serializers: { err: serializeError },
        hooks: {
            logMethod(args, method) {
                return method.apply(this, keepExtraArgs(args));
            }
        }
    };
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

let logger;
try {
    const options = createLoggerOptions();
    if (!isProduction) {
        options.transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
    }
    logger = pino(options);
} catch (err) {
    logger = pino(createLoggerOptions());
}

export default logger;
