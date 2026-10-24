import fs from 'fs';
import os from 'os';
import logger from './logger.js';

const DEFAULT_MIN_FREE_MEMORY_MB = 1024;

export function getMinFreeMemoryMb(value = process.env.BROWSER_MIN_FREE_MEMORY_MB) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_FREE_MEMORY_MB;
}

/**
 * Refuses to start a browser when the machine is short on memory.  This server
 * also runs EMR and other hospital systems; a browser launched under memory
 * pressure has frozen the whole machine before.  os.freemem() reports
 * MemAvailable on Linux, i.e. memory that can be used without swapping.
 */
export function assertEnoughMemoryForBrowser(freeBytes = os.freemem(), minFreeMb = getMinFreeMemoryMb()) {
    const freeMb = Math.round(freeBytes / 1024 / 1024);
    if (freeMb < minFreeMb) {
        throw new Error(`หน่วยความจำเครื่องเหลือ ${freeMb} MB (ต้องการอย่างน้อย ${minFreeMb} MB) จึงไม่เปิดเบราว์เซอร์ เพื่อป้องกันเครื่องค้าง`);
    }
}

/**
 * Returns safe Puppeteer launch options with validated executablePath.
 * Ensures executablePath is only set if the binary file actually exists on disk.
 * Throws when there is not enough free memory to launch a browser safely.
 */
export function getPuppeteerLaunchOptions(extraOptions = {}) {
    assertEnoughMemoryForBrowser();

    const launchOptions = {
        // chrome-headless-shell: the lightweight headless-only build of Chrome.
        // Installed with `npm run install:chrome`.
        headless: 'shell',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // Servers often have a small /dev/shm; Chrome hangs on startup when it fills up.
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--mute-audio',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        ...extraOptions
    };

    // 1. If PUPPETEER_EXECUTABLE_PATH is configured in .env and file exists on disk
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            // A full Chrome binary no longer supports the shell headless mode.
            launchOptions.headless = true;
            logger.info(`🌐 Using configured PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
            return launchOptions;
        } else {
            logger.warn(`⚠️ Configured PUPPETEER_EXECUTABLE_PATH does not exist on disk: ${process.env.PUPPETEER_EXECUTABLE_PATH}. Removing invalid env var.`);
            delete process.env.PUPPETEER_EXECUTABLE_PATH;
        }
    }

    // 2. Fallback: Puppeteer's own chrome-headless-shell from its browser cache.
    // System Chrome/Chromium is no longer auto-detected: it is the heavier full browser.
    delete launchOptions.executablePath;
    logger.info('🌐 Using Puppeteer chrome-headless-shell.');
    return launchOptions;
}
