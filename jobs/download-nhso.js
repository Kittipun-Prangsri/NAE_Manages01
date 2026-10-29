import dns from 'dns';
const originalLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    } else if (typeof options === 'number') {
        options = { family: options };
    }
    options = options || {};
    options.family = 4;
    return originalLookup(hostname, options, callback);
};

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { trackerPool } from '../backend/db.js';
import { createSchedulerHolderId, releaseSchedulerLock } from '../backend/schedulerLock.js';
import logger from '../backend/logger.js';
import { saveNhsoSessionStatusInfo, acquirePortalLock, killProfileBrowsers, PORTAL_LOCK_KEY } from './keep-alive-nhso.js';
import { getPuppeteerLaunchOptions } from '../backend/puppeteerHelper.js';
import { loginWithThaid, createTelegramQrNotifier, saveQrFile, thaidOpenPageUrl } from './thaidLogin.js';

dotenv.config();
// Several job modules share the puppeteer-extra singleton; register stealth once.
if (!puppeteer.plugins.some(plugin => plugin.name === 'stealth')) puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * options.chatIds: who receives the ThaiD QR in Telegram — the person who asked
 * (an empty list = web only).  Omitted = the shared TELEGRAM_CHAT_ID chats
 * (scheduled runs).
 */
export async function downloadNhsoReport(targetDateOrCallback = null, statusCallback = null, options = {}) {
    let targetDate = null;
    if (typeof targetDateOrCallback === 'function') {
        statusCallback = targetDateOrCallback;
    } else {
        targetDate = targetDateOrCallback;
    }

    const url = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    const hasTelegram = telegramToken && telegramChatId && telegramChatId !== 'your_telegram_chat_id_here';

    const downloadsDir = path.join(__dirname, '../downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
    
    // Clean up to ensure only at most 1 latest file is kept initially
    cleanOldDownloads(downloadsDir);

    logger.info('🕵️‍♂️ Starting automated NHSO Report Downloader...');
    if (statusCallback) statusCallback('starting_browser', 'กำลังรันบราวเซอร์ Puppeteer เบื้องหลัง...');
    
    let browser;
    // Download into a fresh per-run folder so the backup Excel kept in
    // downloads/ can never be mistaken for the file of this run.
    const runDownloadDir = path.join(downloadsDir, `.run-${Date.now()}`);
    const portalLockHolderId = createSchedulerHolderId();
    let portalLockAcquired = false;
    try {
        // All portal jobs share one browser profile.  A database-backed lock
        // prevents manual, scheduled and Telegram triggers from launching
        // Chromium against that profile at the same time.
        portalLockAcquired = await acquirePortalLock(portalLockHolderId);
        // The keep-alive holds this lock for a short time every 30 minutes;
        // wait for it instead of rejecting the user's request straight away.
        const lockWaitDeadline = Date.now() + 3 * 60 * 1000;
        if (!portalLockAcquired && statusCallback) statusCallback('waiting_lock', 'รอให้งานตรวจเซสชัน สปสช. ที่กำลังทำงานอยู่เสร็จก่อน...');
        while (!portalLockAcquired && Date.now() < lockWaitDeadline) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            portalLockAcquired = await acquirePortalLock(portalLockHolderId);
        }
        if (!portalLockAcquired) {
            const message = 'มีงานดาวน์โหลดรายงาน สปสช. กำลังทำงานอยู่แล้ว';
            logger.warn(`ℹ️ ${message}`);
            if (statusCallback) statusCallback('busy', message);
            return { success: false, busy: true, error: message };
        }
        const sessionPath = path.join(__dirname, '../puppeteer_session');
        
        // Only kill browsers using this profile; other jobs (dashboard capture) keep running.
        if (process.platform === 'linux') {
            killProfileBrowsers();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const lockFile = path.join(sessionPath, 'SingletonLock');
        try {
            const stat = fs.lstatSync(lockFile);
            fs.unlinkSync(lockFile);
            logger.info('🧹 Cleaned up stale Puppeteer SingletonLock.');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                logger.warn({ err: e.message }, '⚠️ Warning: Could not remove SingletonLock:');
            }
        }

        const launchOptions = getPuppeteerLaunchOptions({ userDataDir: sessionPath });
        browser = await puppeteer.launch(launchOptions);
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1440, height: 900 });
        
        // Setup download path in Chrome Headless
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: runDownloadDir
        });

        logger.info('🔗 Navigating to NHSO portal to check session...');
        if (statusCallback) statusCallback('checking_session', 'กำลังตรวจสอบเซสชันกับหน้าเว็บ สปสช....');

        const screenshotsDir = path.join(__dirname, 'screenshots');
        fs.mkdirSync(screenshotsDir, { recursive: true });
        const thaidQrPath = path.join(screenshotsDir, 'thaid_qr.png');
        const qrChatIds = Array.isArray(options.chatIds)
            ? options.chatIds.map(String)
            : (hasTelegram ? telegramChatId.split(',').map(id => id.trim()).filter(id => id) : []);
        const telegramQr = createTelegramQrNotifier(telegramToken || null, qrChatIds);

        const login = await loginWithThaid(page, {
            portalUrl: url,
            onQr: async ({ dataUrl, buffer, refCode, expiresAt, round, deadline, txId }) => {
                saveQrFile(buffer, thaidQrPath);
                const minutesLeft = Math.max(1, Math.round((deadline - Date.now()) / 60000));
                if (statusCallback) {
                    statusCallback('waiting_thaid_scan', `กรุณาสแกน QR Code ด้วยแอป ThaiD (รอบที่ ${round} — QR จะสร้างใหม่อัตโนมัติเมื่อหมดอายุ)`, {
                        qrCodeUrl: dataUrl,
                        refCode,
                        expiresAt: new Date(expiresAt).toISOString(),
                        round
                    });
                }
                await telegramQr.show(buffer, `📲 สแกน QR ด้วยแอป ThaiD เพื่อดึงรายงาน Authen Code\nเลขอ้างอิง: ${refCode || '-'} (รอบที่ ${round})\nQR อายุ ~1 นาที จะเปลี่ยนรูปให้อัตโนมัติ • รอได้อีก ~${minutesLeft} นาที`, thaidOpenPageUrl(txId));
            }
        });
        const authenticated = login.authenticated;

        if (authenticated && login.rounds === 0) {
            logger.info('✅ Existing active session found! Skipping ThaiD QR Code login.');
            if (statusCallback) statusCallback('session_found', 'พบเซสชันเดิมที่ยังไม่หมดอายุ ข้ามขั้นตอนเข้าสู่ระบบ...');
            saveNhsoSessionStatusInfo('active', 'พบเซสชันเดิมที่ยังใช้งานได้ ข้ามการสแกน');
        } else if (authenticated) {
            if (statusCallback) statusCallback('auth_success', 'ตรวจพบการยืนยันตัวตนสำเร็จแล้ว! กำลังโหลดเซสชัน...');
            saveNhsoSessionStatusInfo('active', 'ยืนยันตัวตนสำเร็จแล้ว เซสชันพร้อมใช้งาน');
            await telegramQr.finish('✅ สแกน ThaiD สำเร็จ กำลังดาวน์โหลดรายงาน...');
        } else {
            logger.warn('⚠️ Timed out waiting for ThaiD scan.');
            await telegramQr.finish('⌛ หมดเวลารอสแกน ThaiD — สั่งดึงข้อมูลใหม่อีกครั้งเมื่อพร้อม');
        }

        if (!authenticated) {
            saveNhsoSessionStatusInfo('expired', 'การยืนยันตัวตน ThaiD ไม่สำเร็จ');
            throw new Error('การยืนยันตัวตน ThaiD หมดเวลา หรือไม่สำเร็จ');
        }

        logger.info('✅ Authentication successful! Navigating to report/eclaim page...');
        if (statusCallback) statusCallback('navigating_report', 'เข้าสู่ระบบสำเร็จ กำลังเปิดหน้าเมนูดาวน์โหลดรายงาน...');
        await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
        
        logger.info('⏳ Waiting for page elements to load...');
        await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
        // Wait for the form itself instead of a fixed delay.
        await page.waitForFunction(() => document.querySelectorAll('input[name="date"]').length >= 2, { timeout: 20000 });
        // Short settle so the app does not reset the dates we are about to type.
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Format dates
        let dateToQuery = new Date();
        if (targetDate) {
            const parts = String(targetDate).split('-');
            if (parts.length === 3) {
                dateToQuery = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            }
        }
        const dd = String(dateToQuery.getDate()).padStart(2, '0');
        const mm = String(dateToQuery.getMonth() + 1).padStart(2, '0');
        const yyyy_ad = dateToQuery.getFullYear();
        const yyyy_be = yyyy_ad + 543;
        
        const date_be = `${dd}/${mm}/${yyyy_be}`;
        const date_ad = `${dd}/${mm}/${yyyy_ad}`;

        logger.info(`📅 Prepared search dates -> AD: ${date_ad}, BE: ${date_be}`);
        if (statusCallback) statusCallback('searching_data', `กำลังสืบค้นรายงานของวันที่ ${date_be}...`);

        // The portal currently accepts the AD year; BE is kept as a fallback in
        // case it switches back.  Trying AD first avoids a 15s timeout per run.
        const downloadBtnSelector = 'button.btn-default.float-end:not([disabled])';
        const attempts = [['AD', date_ad, 15000], ['BE', date_be, 30000]];
        for (const [index, [label, value, timeout]] of attempts.entries()) {
            logger.info(`✍️ Setting date inputs to (${label}): ${value}...`);
            await page.evaluate((val) => {
                for (const input of [...document.querySelectorAll('input[name="date"]')].slice(0, 2)) {
                    input.value = val;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, value);

            logger.info(`🔍 Clicking "ค้นหา" (${label})...`);
            await page.click('button[type="submit"]');
            try {
                await page.waitForSelector(downloadBtnSelector, { timeout });
                break;
            } catch (err) {
                if (index === attempts.length - 1) {
                    throw new Error(`ไม่พบรายงานของวันที่ ${date_be} (ปุ่มดาวน์โหลดไม่พร้อมใช้งาน)`);
                }
                logger.info(`⚠️ ${label} date search did not enable download button, trying next format...`);
            }
        }
        // Let the result table finish rendering before downloading.
        await new Promise(resolve => setTimeout(resolve, 1000));

        logger.info('📥 Clicking "ดาวน์โหลดรายงาน" button...');
        if (statusCallback) statusCallback('downloading_file', 'กำลังสั่งให้ระบบส่งรายงานและรอรับการดาวน์โหลดไฟล์ Excel...');
        await page.click('button.btn-default.float-end');

        logger.info('⏳ Waiting for file download to complete...');
        const runFilePath = await waitForDownload(runDownloadDir, 60000);
        const filePath = path.join(downloadsDir, path.basename(runFilePath));
        fs.renameSync(runFilePath, filePath);
        logger.info(`🎉 Download successful! Saved to: ${filePath}`);
        if (statusCallback) statusCallback('download_complete', 'ดาวน์โหลดไฟล์รายงาน Excel สำเร็จเรียบร้อยแล้ว!');

        return { success: true, filePath };

    } catch (error) {
        logger.error({ err: error }, '❌ Downloader Error:');
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            await browser.close();
            logger.info('🔒 Browser closed.');
        }
        fs.rmSync(runDownloadDir, { recursive: true, force: true });
        if (portalLockAcquired) {
            await releaseSchedulerLock(trackerPool, PORTAL_LOCK_KEY, portalLockHolderId);
        }
    }
}

async function waitForDownload(downloadsDir, timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const files = fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir) : [];
        const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
        const inProgress = files.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
        
        if (xlsxFiles.length > 0 && !inProgress) {
            const sorted = xlsxFiles.map(f => ({
                name: f,
                time: fs.statSync(path.join(downloadsDir, f)).mtimeMs
            })).sort((a, b) => b.time - a.time);
            return path.join(downloadsDir, sorted[0].name);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('การดาวน์โหลดไฟล์รายงานหมดเวลา (Timeout)');
}

export function cleanOldDownloads(downloadsDir) {
    try {
        if (!fs.existsSync(downloadsDir)) return;
        
        const files = fs.readdirSync(downloadsDir);
        const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
        
        if (xlsxFiles.length <= 1) {
            return; // 0 or 1 file, no need to clean
        }
        
        // Sort by modification time descending (newest first)
        const sorted = xlsxFiles.map(f => ({
            name: f,
            time: fs.statSync(path.join(downloadsDir, f)).mtimeMs
        })).sort((a, b) => b.time - a.time);
        
        // Keep the newest one (index 0) and delete the rest
        logger.info(`🧹 Keeping latest Excel backup: ${sorted[0].name}`);
        for (let i = 1; i < sorted.length; i++) {
            const filePath = path.join(downloadsDir, sorted[i].name);
            try {
                fs.unlinkSync(filePath);
                logger.info(`🗑️ Deleted old Excel download: ${sorted[i].name}`);
            } catch (err) {
                logger.error({ err: err }, `❌ Error deleting old Excel file ${sorted[i].name}:`);
            }
        }
    } catch (error) {
        logger.error({ err: error }, '❌ Error cleaning old downloads:');
    }
}

// Support running directly for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    downloadNhsoReport();
}
