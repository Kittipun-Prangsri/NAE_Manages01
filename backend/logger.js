import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

let logger;
try {
    const options = {
        level: process.env.LOG_LEVEL || 'info'
    };
    if (!isProduction) {
        options.transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
    }
    logger = pino(options);
} catch (err) {
    logger = pino({ level: process.env.LOG_LEVEL || 'info' });
}

export default logger;
