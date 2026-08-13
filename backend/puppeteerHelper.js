import fs from 'fs';
import logger from './logger.js';

/**
 * Returns safe Puppeteer launch options with validated executablePath.
 * Ensures executablePath is only set if the binary file actually exists on disk.
 */
export function getPuppeteerLaunchOptions(extraOptions = {}) {
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        ...extraOptions
    };

    // 1. If PUPPETEER_EXECUTABLE_PATH is configured in .env and file exists on disk
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            logger.info(`🌐 Using configured PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
            return launchOptions;
        } else {
            logger.warn(`⚠️ Configured PUPPETEER_EXECUTABLE_PATH does not exist on disk: ${process.env.PUPPETEER_EXECUTABLE_PATH}. Removing invalid env var.`);
            delete process.env.PUPPETEER_EXECUTABLE_PATH;
        }
    }

    // 2. On Linux, search for valid system Chromium / Chrome binaries
    if (process.platform === 'linux') {
        const knownPaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium'
        ];
        for (const p of knownPaths) {
            if (fs.existsSync(p)) {
                launchOptions.executablePath = p;
                logger.info(`🌐 Found system Chromium/Chrome at: ${p}`);
                return launchOptions;
            }
        }
    }

    // 3. Fallback: Do not set executablePath; Puppeteer will use its internal Chrome cache
    delete launchOptions.executablePath;
    logger.info('🌐 Using Puppeteer bundled Chrome binary.');
    return launchOptions;
}
