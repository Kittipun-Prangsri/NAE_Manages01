import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import logger from '../backend/logger.js';

dotenv.config();
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionPath = path.join(__dirname, '../puppeteer_session');
const statusFilePath = path.join(sessionPath, 'session_status.json');

export function getNhsoSessionStatusInfo() {
    try {
        if (fs.existsSync(statusFilePath)) {
            const raw = fs.readFileSync(statusFilePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        logger.warn('⚠️ Could not read session_status.json:', e.message);
    }
    return {
        status: 'unknown',
        last_checked: null,
        last_active: null,
        message: 'ยังไม่มีข้อมูลการตรวจสอบเซสชัน'
    };
}

export function saveNhsoSessionStatusInfo(status, message, extraData = {}) {
    try {
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }
        const prev = getNhsoSessionStatusInfo();
        const nowIso = new Date().toISOString();
        const data = {
            status,
            message,
            last_checked: nowIso,
            last_active: status === 'active' ? nowIso : (prev.last_active || null),
            ...extraData
        };
        fs.writeFileSync(statusFilePath, JSON.stringify(data, null, 2), 'utf8');
        return data;
    } catch (e) {
        logger.error('❌ Failed to save session status info:', e.message);
    }
}

async function notifySessionExpired() {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || process.env.WORKER_TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (process.env.DISABLE_NOTIFICATIONS === 'true') return;
    if (!telegramToken || !telegramChatId || telegramChatId === 'your_telegram_chat_id_here') return;

    try {
        const text = '⚠️ [แจ้งเตือนเซสชัน สปสช.] เซสชันการเข้าสู่ระบบ NHSO/ThaiD หมดอายุแล้ว กรุณายืนยันตัวตนใหม่เพื่อให้ออกรายงานได้ต่อเนื่อง';
        const chatIds = telegramChatId.split(',').map(id => id.trim()).filter(id => id);
        for (const chatId of chatIds) {
            await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: text })
            });
        }
        logger.info('📲 Sent Session Expired notification to Telegram.');
    } catch (err) {
        logger.error('❌ Failed to send session expired notification:', err.message);
    }
}

export async function keepAliveNhsoSession() {
    const url = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
    logger.info('⏰ [Keep-Alive] Starting background NHSO portal keep-alive...');
    
    let browser;
    try {
        // Cleanup singleton lock
        const lockFile = path.join(sessionPath, 'SingletonLock');
        try {
            const stat = fs.lstatSync(lockFile);
            fs.unlinkSync(lockFile);
            logger.info('🧹 [Keep-Alive] Cleaned up Puppeteer SingletonLock.');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                logger.warn('⚠️ [Keep-Alive] Warning: Could not remove SingletonLock:', e.message);
            }
        }

        const launchOptions = {
            headless: true,
            userDataDir: sessionPath,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        };

        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        } else if (process.platform === 'linux') {
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
                    logger.info(`🌐 [Keep-Alive] Using system Chromium/Chrome at: ${p}`);
                    break;
                }
            }
        }

        browser = await puppeteer.launch(launchOptions);
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1440, height: 900 });

        logger.info('🔗 [Keep-Alive] Accessing portal to ping session...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const currentUrl = page.url();
        logger.info(`📍 [Keep-Alive] Current portal URL: ${currentUrl}`);

        let isActive = false;
        if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('login')) {
            const hasLoginButton = await page.evaluate(() => {
                return !!document.querySelector('a[href*="/broker/thaid/login"]');
            });
            if (!hasLoginButton) {
                isActive = true;
            }
        }

        if (isActive) {
            // Deep ping report page to refresh full session cookies
            logger.info('🔗 [Keep-Alive] Deep pinging report/eclaim page to refresh cookies...');
            try {
                await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                logger.warn('⚠️ [Keep-Alive] Deep ping navigation warning:', e.message);
            }

            logger.info('✅ [Keep-Alive] Session is active and healthy! Cookies refreshed.');
            saveNhsoSessionStatusInfo('active', 'เซสชันยังไม่หมดอายุ การสแกนอัตโนมัติพร้อมใช้งาน');
        } else {
            logger.warn('⚠️ [Keep-Alive] Session has expired. (Redirected to login)');
            const prev = getNhsoSessionStatusInfo();
            saveNhsoSessionStatusInfo('expired', 'เซสชันหมดอายุแล้ว ต้องทำการสแกนยืนยันตัวตนใหม่');
            
            // Only send alert notification if previously active
            if (prev.status === 'active') {
                await notifySessionExpired();
            }
        }

    } catch (error) {
        logger.error('❌ [Keep-Alive] Error during session keep-alive:', error.message);
        saveNhsoSessionStatusInfo('error', `เกิดข้อผิดพลาดในการตรวจสอบเซสชัน: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
            logger.info('🔒 [Keep-Alive] Browser closed.');
        }
    }
}

// Support running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    keepAliveNhsoSession().then(() => process.exit(0));
}

