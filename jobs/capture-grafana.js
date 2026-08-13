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

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../backend/runtimeConfig.js';
import { getLocalDashboardUrl } from './captureConfig.js';
import { trackerPool } from '../backend/db.js';
import { acquireSchedulerLock, createSchedulerHolderId, releaseSchedulerLock } from '../backend/schedulerLock.js';
import logger from '../backend/logger.js';
import { getPuppeteerLaunchOptions } from '../backend/puppeteerHelper.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fetch data summary statistics from internal tracker database
 */
async function fetchSummaryStats(queryDate) {
    // Keep the notification path light: one aggregate query replaces five
    // separate scans of visit_tracking for the same date.
    const [summaryResult, rightsResult, departmentsResult] = await Promise.all([
        trackerPool.query(
            `SELECT COUNT(*) AS total_visits,
                    COALESCE(SUM(uc_money), 0) AS total_money,
                    SUM(color_status = 'YELLOW') AS endpoint_count,
                    SUM(check_claimcode = 'ยังไม่ได้นำเข้า') AS not_imported_count,
                    SUM(color_status = 'GREEN') AS authen_count,
                    SUM(UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW')) AS ucs_total
             FROM visit_tracking
             WHERE visit_date = ?`,
            [queryDate]
        ),
        trackerPool.query(
            'SELECT COALESCE(pttype_note, pttype) as right_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? GROUP BY right_name ORDER BY cnt DESC LIMIT 3',
            [queryDate]
        ),
        trackerPool.query(
            "SELECT COALESCE(department, 'ไม่ระบุจุดบริการ') as dept_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? AND UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW') GROUP BY dept_name ORDER BY cnt DESC LIMIT 3",
            [queryDate]
        )
    ]);
    const [[summary]] = summaryResult;
    const [rights] = rightsResult;
    const [ucs_departments] = departmentsResult;

    return {
        total_visits: summary?.total_visits || 0,
        total_money: summary?.total_money || 0,
        endpoint_count: summary?.endpoint_count || 0,
        not_imported_count: summary?.not_imported_count || 0,
        authen_count: summary?.authen_count || 0,
        rights,
        ucs_total: summary?.ucs_total || 0,
        ucs_departments
    };
}

/**
 * Send text summary to Telegram Chat
 */
async function sendTextSummaryToTelegram(token, chatId, targetDate, stats) {
    logger.info(`📲 Sending Text Summary to Telegram Chat: ${chatId}...`);
    try {
        const formattedDate = new Date(targetDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
        
        let msg = `📊 *สรุปข้อมูลการให้บริการ* (วันที่ ${formattedDate})\n\n`;
        msg += `👥 ผู้มารับบริการ: *${stats.total_visits}* ครั้ง\n`;
        msg += `💰 ค่ารักษาลูกหนี้ (sum): *${Number(stats.total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* บาท\n\n`;
        
        msg += `🔑 *สถานะ Authen Code:*\n`;
        msg += `• ENDPOINT (เหลือง): *${stats.endpoint_count}* ราย\n`;
        msg += `• ยังไม่ได้นำเข้า (แดง): *${stats.not_imported_count}* ราย\n`;
        msg += `• AUTHENCODE (เขียว): *${stats.authen_count}* ราย\n\n`;
        
        msg += `💳 *สิทธิการรักษา (Top 3):*\n`;
        stats.rights.forEach((r, idx) => {
            msg += `${idx + 1}. ${r.right_name || 'ไม่ระบุ'}: *${r.cnt}* ราย\n`;
        });
        msg += `\n`;
        
        msg += `⚠️ *UCS ค้างชำระ (RED/YELLOW):* *${stats.ucs_total}* ราย\n`;
        stats.ucs_departments.forEach(d => {
            msg += `• ${d.dept_name}: *${d.cnt}* ราย\n`;
        });
        
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: msg,
                parse_mode: 'Markdown'
            })
        });

        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.ok) {
            logger.info('✅ Text summary sent to Telegram successfully.');
        } else {
            logger.error('❌ Telegram Bot API returned error:', resData);
        }
    } catch (error) {
        logger.error('❌ Error sending text summary to Telegram:', error);
    }
}

/**
 * Capture Grafana dashboard as screenshot and send notifications
 */
async function captureAndNotify(targetDate = null, channels = ['line', 'telegram'], reportTypes = ['summary', 'screenshot'], userCredentials = null) {
    if (process.env.ENABLE_SYNC_REPORTS !== 'true') {
        logger.info('ℹ️ Sync report delivery is disabled; skipping summary and screenshot generation.');
        return { success: true, skipped: true, message: 'Sync reports are temporarily disabled' };
    }

    if (process.env.ENABLE_DASHBOARD_MODULES !== 'true') {
        logger.info('ℹ️ Dashboard capture is disabled while dashboard modules are paused.');
        return { success: true, skipped: true, message: 'Dashboard modules are temporarily disabled' };
    }

    // Use userCredentials if provided, otherwise fall back to .env values
    const lineAccessToken = (userCredentials && userCredentials.line_token) || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const lineGroupId = (userCredentials && userCredentials.line_group_id) || process.env.LINE_GROUP_ID;
    const telegramBotToken = (userCredentials && userCredentials.telegram_token) || process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = (userCredentials && userCredentials.telegram_chat_id) || process.env.TELEGRAM_CHAT_ID;
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    const queryDate = targetDate || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

    let filepath = null;
    let filename = null;
    let captureError = null;
    let captureLockHolderId = null;

    // Check if screenshot is requested
    if (reportTypes.includes('screenshot')) {
        captureLockHolderId = createSchedulerHolderId();
        const acquired = await acquireSchedulerLock(trackerPool, 'dashboard_capture', captureLockHolderId);
        if (!acquired) {
            logger.warn('ℹ️ Dashboard capture skipped because another capture is already running.');
            return { success: false, skipped: true, filepath, filename, error: 'Dashboard capture is already running' };
        }
        const localAppUrl = getLocalDashboardUrl();

        logger.info(`🚀 Starting screenshot capture process for local dashboard: ${localAppUrl}`);

        let browser;
        try {
            logger.info('🌐 Launching browser...');
            const launchOptions = getPuppeteerLaunchOptions();
            browser = await puppeteer.launch(launchOptions);

            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

            logger.info(`🔗 Navigating to local application URL: ${localAppUrl}`);
            await page.goto(localAppUrl, { waitUntil: 'load', timeout: 30000 });

            // Generate JWT token for system capture user
            logger.info('🔑 Generating system authentication token...');
            const tokenPayload = {
                username: 'system_capture',
                full_name: 'System Capture Bot',
                role: 'admin',
                department: 'IT'
            };
            const jwtSecret = getJwtSecret();
            const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: '15m' });

            // Inject credentials and force light theme
            logger.info('🧪 Injecting auth credentials and setting theme to light...');
            await page.evaluate((tok, usr) => {
                localStorage.setItem('nhso_token', tok);
                localStorage.setItem('nhso_user', JSON.stringify(usr));
                localStorage.setItem('theme', 'light');
                document.documentElement.classList.remove('dark');
            }, token, tokenPayload);

            // Reload page to apply login
            logger.info('🔄 Reloading page to apply login...');
            await page.goto(localAppUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Set the target date if provided
            if (queryDate) {
                logger.info(`📅 Setting target date: ${queryDate}`);
                await page.evaluate((date) => {
                    const dateInput = document.getElementById('visit-date');
                    if (dateInput) {
                        dateInput.value = date;
                        dateInput.dispatchEvent(new Event('change'));
                    }
                }, queryDate);
            }

            // Switch to the Live Dashboard tab
            logger.info('📊 Switching to Live Dashboard tab...');
            await page.waitForSelector('#tab-live-dashboard', { timeout: 10000 });
            await page.click('#tab-live-dashboard');

            // Wait for the Live Dashboard container to render and load data
            logger.info('⏳ Waiting for Live Dashboard content to render...');
            await page.waitForSelector('#live-dashboard-view-container', { timeout: 10000 });
            
            // Wait for charts/animations to load completely
            logger.info('⏱️ Waiting for charts animations...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            const screenshotsDir = path.join(__dirname, '../screenshots');
            if (!fs.existsSync(screenshotsDir)) {
                fs.mkdirSync(screenshotsDir, { recursive: true });
            }

            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const sec = String(now.getSeconds()).padStart(2, '0');
            
            filename = `grafana_${yyyy}-${mm}-${dd}_${hh}-${min}-${sec}.png`;
            filepath = path.join(screenshotsDir, filename);

            logger.info('📸 Capturing element screenshot (.uc-insight-board)...');
            const element = await page.$('.uc-insight-board');
            if (element) {
                await element.screenshot({ path: filepath });
                logger.info(`💾 Element screenshot successfully saved to: ${filepath}`);
            } else {
                logger.warn('⚠️ Element .uc-insight-board not found. Capturing full page instead.');
                await page.screenshot({ path: filepath });
                logger.info(`💾 Full page screenshot successfully saved to: ${filepath}`);
            }

            cleanOldScreenshots(screenshotsDir);

        } catch (error) {
            logger.error('❌ Error in screenshot capture:', error);
            captureError = error;
        } finally {
            if (browser) {
                await browser.close();
                logger.info('🔒 Browser closed.');
            }
            if (captureLockHolderId) {
                await releaseSchedulerLock(trackerPool, 'dashboard_capture', captureLockHolderId);
                captureLockHolderId = null;
            }
        }
    } else {
        logger.info('ℹ️ Screenshot disabled for this run (Data Summary only).');
    }

    // Now send notifications
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        logger.info('ℹ️ Notifications are globally disabled via DISABLE_NOTIFICATIONS=true. Skipping send.');
        return { success: !captureError, filepath, filename, error: captureError?.message || null };
    }

    const notificationPromises = [];

    // Fetch database stats once if summary is needed
    let stats = null;
    if (reportTypes.includes('summary')) {
        logger.info('📊 Fetching database stats for summary messages...');
        try {
            stats = await fetchSummaryStats(queryDate);
        } catch (err) {
            logger.error('❌ Failed to fetch database stats for summary:', err);
        }
    }

    // LINE Bot
    if (channels.includes('line') && lineAccessToken && lineGroupId) {
        if (reportTypes.includes('summary') && stats) {
            notificationPromises.push(
                sendToLineBot(lineAccessToken, lineGroupId, queryDate, stats)
            );
        } else {
            logger.info('ℹ️ LINE Group: Summary not requested or failed, nothing to send.');
        }
    } else if (!channels.includes('line')) {
        logger.info('ℹ️ LINE Group notifications disabled for this run.');
    } else {
        logger.info('⚠️ LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID is missing in .env, skipping LINE Bot.');
    }

    // Telegram Bot
    if (channels.includes('telegram') && telegramBotToken && telegramChatId) {
        const chatIds = telegramChatId.split(',').map(id => id.trim()).filter(id => id);
        chatIds.forEach(id => {
            if (reportTypes.includes('summary') && stats) {
                notificationPromises.push(
                    sendTextSummaryToTelegram(telegramBotToken, id, queryDate, stats)
                );
            }
            if (reportTypes.includes('screenshot') && filepath && filename) {
                notificationPromises.push(
                    sendToTelegram(filepath, filename, telegramBotToken, id, queryDate)
                );
            }
        });
    } else if (!channels.includes('telegram')) {
        logger.info('ℹ️ Telegram notifications disabled for this run.');
    } else {
        logger.info('⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in .env, skipping Telegram Bot.');
    }

    if (notificationPromises.length > 0) {
        await Promise.allSettled(notificationPromises);
    }

    return { success: !captureError, filepath, filename, error: captureError?.message || null };
}

async function sendToLineBot(token, groupId, targetDate, stats) {
    logger.info('ℹ️ LINE Flex summary push message is disabled (only replies are allowed).');
}

async function sendToTelegram(filepath, filename, token, chatId, targetDate = null) {
    logger.info('📲 Sending screenshot to Telegram via Telegram Bot API...');
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formattedDate = targetDate 
            ? new Date(targetDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
            : new Date().toLocaleString('th-TH');
        
        const captionDateLabel = targetDate ? 'วันที่บริการ' : 'วันที่บันทึก';

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', `📊 บันทึกหน้าจอ Grafana อัตโนมัติ\n📅 ${captionDateLabel}: ${formattedDate}`);

        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });

        const resData = await response.json();
        if (response.ok && resData.ok) {
            logger.info('✅ Photo sent to Telegram successfully.');
        } else {
            logger.error('❌ Telegram Bot API returned error:', resData);
        }
    } catch (error) {
        logger.error('❌ Error sending to Telegram:', error);
    }
}

function cleanOldScreenshots(screenshotsDir) {
    try {
        if (!fs.existsSync(screenshotsDir)) return;
        const files = fs.readdirSync(screenshotsDir);
        const screenshotFiles = files.filter(file => 
            file.startsWith('grafana_') && file.endsWith('.png')
        );
        if (screenshotFiles.length <= 2) return;
        screenshotFiles.sort((a, b) => b.localeCompare(a));
        const filesToDelete = screenshotFiles.slice(2);
        
        filesToDelete.forEach(file => {
            const filePath = path.join(screenshotsDir, file);
            try {
                fs.unlinkSync(filePath);
                logger.info(`🗑️ Deleted old screenshot: ${file}`);
            } catch (err) {
                logger.error(`❌ Error deleting file ${file}:`, err);
            }
        });
    } catch (error) {
        logger.error('❌ Error during screenshots folder cleanup:', error);
    }
}

// Check if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    captureAndNotify();
}

export { captureAndNotify };
