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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cron from 'node-cron';
import * as xlsx from 'xlsx';

// DB and Data Services
import { checkConnections, trackerPool } from '../backend/db.js';
import { 
    getHosxpVisits, 
    saveTrackingResults, 
    runHosxpSync
} from '../backend/dataService.js';
import { processCrossCheck } from '../backend/crossCheckLogic.js';
import { downloadNhsoReport, cleanOldDownloads } from './download-nhso.js';
import { keepAliveNhsoSession } from './keep-alive-nhso.js';
import { acquireSchedulerLock, createSchedulerHolderId, releaseSchedulerLock } from '../backend/schedulerLock.js';
import logger from '../backend/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for absolute path to downloads
const downloadsDir = path.join(__dirname, '../downloads');

// We will keep track of registered cron jobs
let activeCronTasks = [];
let lastKnownSchedulesStr = '';
const schedulerHolderId = createSchedulerHolderId();

async function createScheduledSyncRun(visitDate) {
    const [result] = await trackerPool.query(
        'INSERT INTO sync_runs (source, visit_date, status) VALUES (?, ?, "running")',
        ['worker-scheduler', visitDate]
    );
    return result.insertId;
}

async function finishScheduledSyncRun(id, status, totalRecords, message, error = null) {
    await trackerPool.query(
        'UPDATE sync_runs SET status = ?, total_records = ?, message = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, totalRecords || 0, message || null, error || null, id]
    );
}

async function runScheduledSyncAndCaptureWithLock() {
    const lockKey = 'nhso_sync_and_capture';
    try {
        const acquired = await acquireSchedulerLock(trackerPool, lockKey, schedulerHolderId);
        if (!acquired) {
            logger.warn('ℹ️ [Worker-Scheduler] Another process is already running the scheduled sync; skipping this trigger.');
            return;
        }
        await handleScheduledSyncAndCapture();
    } catch (error) {
        logger.error({ err: error.message }, '❌ [Worker-Scheduler] Could not acquire scheduled-job lock:');
    } finally {
        try {
            await releaseSchedulerLock(trackerPool, lockKey, schedulerHolderId);
        } catch (error) {
            logger.error({ err: error.message }, '❌ [Worker-Scheduler] Could not release scheduled-job lock:');
        }
    }
}

async function handleScheduledSyncAndCapture() {
    logger.info('⏰ [Worker-Scheduler] เริ่มต้นกระบวนการดาวน์โหลดข้อมูลและบันทึกหน้าจออัตโนมัติ...');
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    let syncRunId = null;
    await sendLineMessage(`⏰ [Scheduler] เริ่มต้นการทำรายงานและประมวลผลข้อมูลอัตโนมัติ ประจำวันที่ ${visit_date}...`);
    
    try {
        syncRunId = await createScheduledSyncRun(visit_date);
        const dlResult = await downloadNhsoReport();
        if (!dlResult.success || !dlResult.filePath) {
            logger.warn(`⚠️ [Worker-Scheduler] การดาวน์โหลดข้อมูลอัตโนมัติไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
            await finishScheduledSyncRun(syncRunId, 'failed', 0, 'Scheduled NHSO portal download failed', dlResult.error || 'Download failed');
            return;
        }

        logger.info(`📥 [Worker-Scheduler] ดาวน์โหลดรายงานสำเร็จจาก สปสช: ${dlResult.filePath}`);
        const fileBuffer = fs.readFileSync(dlResult.filePath);
        const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });
        await runHosxpSync(excelData, visit_date);
        const hosxpData = await getHosxpVisits(visit_date);
        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        cleanOldDownloads(downloadsDir);
        logger.info('✅ [Worker-Scheduler] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');

        await finishScheduledSyncRun(syncRunId, 'success', processedData.length, 'Scheduled sync completed');
    } catch (err) {
        logger.error({ err: err }, '❌ [Worker-Scheduler] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:');
        if (syncRunId) await finishScheduledSyncRun(syncRunId, 'failed', 0, 'Scheduled sync crashed', err.message);
    }
}

async function reloadSchedules(rows) {
    try {
        // Stop and destroy all currently running tasks
        activeCronTasks.forEach(task => {
            if (task && typeof task.stop === 'function') {
                task.stop();
            }
        });
        activeCronTasks = [];

        logger.info(`⏰ [Worker-Scheduler] Registering ${rows.length} active schedule(s)...`);
        
        for (const row of rows) {
            const timeStr = row.schedule_time; // format 'HH:MM:SS' or 'HH:MM'
            const [hh, mm] = timeStr.split(':');
            
            // Build standard cron pattern: 'mm hh * * *'
            const cronPattern = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
            
            logger.info(`⏰ [Worker-Scheduler] Scheduling job at ${hh}:${mm} (Cron pattern: "${cronPattern}")`);
            
            const task = cron.schedule(cronPattern, () => {
                logger.info(`⏰ [Worker-Cron] Automatically triggering sync and capture task for time: ${timeStr}...`);
                runScheduledSyncAndCaptureWithLock();
            }, {
                scheduled: true,
                timezone: "Asia/Bangkok"
            });
            
            activeCronTasks.push(task);
        }
        logger.info('✅ [Worker-Scheduler] Schedules reloaded and registered successfully.');
    } catch (error) {
        logger.error({ err: error }, '❌ [Worker-Scheduler] Error loading cron schedules:');
    }
}

async function checkAndReloadSchedules() {
    try {
        const [rows] = await trackerPool.query('SELECT id, schedule_time, is_enabled FROM cron_schedules WHERE is_enabled = TRUE ORDER BY id ASC');
        const currentSchedulesStr = JSON.stringify(rows);
        if (currentSchedulesStr !== lastKnownSchedulesStr) {
            lastKnownSchedulesStr = currentSchedulesStr;
            await reloadSchedules(rows);
        }
    } catch (error) {
        logger.error({ err: error }, '❌ [Worker] Error fetching schedules from DB:');
    }
}

// --- Telegram Bot Command Listener (Polling) ---
let lastUpdateId = 0;

function reloadTelegramEnv() {
    try {
        const parsed = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
        for (const key of ['TELEGRAM_BOT_TOKEN', 'WORKER_TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DISABLE_NOTIFICATIONS']) {
            if (key in parsed) process.env[key] = parsed[key];
        }
    } catch (err) {
        // Keep the values loaded at startup when .env cannot be read.
    }
}
let warnedMissingTelegramConfig = false;

async function sendTelegramMessage(token, chatId, text) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        logger.info('ℹ️ Telegram message is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
    } catch (err) {
        logger.error({ err: err }, 'Error sending message:');
    }
}

async function sendLineMessage(text) {
    logger.info({ detail: text }, 'ℹ️ LINE push message is disabled (only replies are allowed). Message not sent:');
}

function formatSyncSummary(visitDate, processedData) {
    const count = color => processedData.filter(row => row.color_status === color).length;
    return [
        `✅ ดึงและนำเข้าข้อมูลวันที่ ${visitDate} สำเร็จ`,
        `รับบริการทั้งหมด ${processedData.length} ราย`,
        `🟢 ครบถ้วน ${count('GREEN')} • 🟡 รอปิด Endpoint ${count('YELLOW')} • 🔴 ยังไม่ขอ Authen ${count('RED')}`
    ].join('\n');
}

async function runE2EPortalSyncAndCapture(targetChatId) {
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    try {
        const dlResult = await downloadNhsoReport();
        if (dlResult.success && dlResult.filePath) {
            logger.info(`📥 [Telegram Trigger] ดาวน์โหลดรายงานสำเร็จจาก สปสช: ${dlResult.filePath}`);
            
            // อ่าน Excel
            const fileBuffer = fs.readFileSync(dlResult.filePath);
            const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
                raw: false, 
                dateNF: 'yyyy-mm-dd hh:mm:ss' 
            });
            
            // นำเข้าข้อมูลและประมวลผล Sync
            await runHosxpSync(excelData, visit_date);
            const hosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(hosxpData, excelData);
            await saveTrackingResults(processedData);
            logger.info('✅ [Telegram Trigger] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
            
            // เคลียร์ไฟล์ดาวน์โหลด
            cleanOldDownloads(downloadsDir);
            
            // แจ้งเตือนความสำเร็จ
            await sendTelegramMessage(token, targetChatId, formatSyncSummary(visit_date, processedData));
            await sendLineMessage(`✅ ดึงข้อมูลรายงานและประมวลผลข้อมูลประจำวันที่ ${visit_date} สำเร็จแล้ว!`);
        } else {
            logger.warn(`⚠️ [Telegram Trigger] การดาวน์โหลดข้อมูลไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
            await sendTelegramMessage(token, targetChatId, `❌ ดึงข้อมูลรายงานไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
            await sendLineMessage(`❌ ดึงข้อมูลรายงานของวันที่ ${visit_date} ไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
            return;
        }
    } catch (err) {
        logger.error({ err: err }, '❌ [Telegram Trigger] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:');
        await sendTelegramMessage(token, targetChatId, `❌ ข้อผิดพลาดภายในเซิร์ฟเวอร์: ${err.message}`);
        await sendLineMessage(`❌ เกิดข้อผิดพลาดในเซิร์ฟเวอร์: ${err.message}`);
        return;
    }
}

async function startTelegramBotListener() {
    logger.info('🤖 Telegram Bot message listener started (Long Polling)...');
    
    let isPolling = false;
    
    async function poll() {
        if (isPolling) return;
        isPolling = true;
        
        try {
            // Reload only the Telegram settings from .env so they can change
            // without a restart.  A full override would also restore values the
            // process deliberately removed (e.g. an invalid PUPPETEER_EXECUTABLE_PATH).
            reloadTelegramEnv();
            
            const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            if (!token || !chatId || chatId === 'your_telegram_chat_id_here') {
                if (!warnedMissingTelegramConfig) {
                    logger.warn('⚠️ [Telegram Bot] Not polling: TELEGRAM_BOT_TOKEN (or WORKER_TELEGRAM_BOT_TOKEN) and TELEGRAM_CHAT_ID must be set in .env');
                    warnedMissingTelegramConfig = true;
                }
                isPolling = false;
                setTimeout(poll, 10000);
                return;
            }
            if (warnedMissingTelegramConfig) {
                logger.info('✅ [Telegram Bot] Configuration found, polling started.');
                warnedMissingTelegramConfig = false;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            try {
                const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    logger.warn(`⚠️ [Telegram Bot] Polling response not OK: ${response.status} ${response.statusText}`);
                    isPolling = false;
                    setTimeout(poll, 5000);
                    return;
                }
                
                const data = await response.json();
                if (data.ok && data.result.length > 0) {
                    for (const update of data.result) {
                        lastUpdateId = update.update_id;
                        
                        const message = update.message;
                        if (!message || !message.text) continue;
                        
                        const text = message.text.trim();
                        const fromChatId = message.chat.id.toString();
                        
                        // Split the comma-separated list of allowed chat IDs
                        const allowedChatIds = chatId.split(',').map(id => id.trim()).filter(id => id);
                        
                        if (allowedChatIds.includes(fromChatId)) {
                            if (text === 'เข้าระบบ' || text === 'ดึงข้อมูล' || text.toLowerCase() === '/login' || text.toLowerCase() === '/sync') {
                                logger.info(`🤖 [Telegram Bot] Received command: "${text}" from Chat: ${fromChatId}`);
                                
                                // Send initial acknowledgment
                                await sendTelegramMessage(token, fromChatId, '⏳ กำลังเตรียมการเข้าสู่ระบบ สปสช. และดึง QR Code ของ ThaiD...');
                                await sendLineMessage('⏳ [Telegram Command] กำลังเตรียมการดึงข้อมูลและขอ QR Code สแกนผ่านแอป ThaiD...');
                                
                                // Run the end-to-end sync and capture in the background
                                runE2EPortalSyncAndCapture(fromChatId).catch(err => {
                                    logger.error({ err: err }, 'Error running E2E portal sync via telegram command:');
                                });
                            }
                        } else {
                            logger.warn(`⚠️ [Telegram Bot] Ignored message from chat ${fromChatId}: not listed in TELEGRAM_CHAT_ID`);
                        }
                    }
                }
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
            
            isPolling = false;
            setTimeout(poll, 1000);
            
        } catch (error) {
            isPolling = false;
            
            // Check if it's a network/timeout error to print a cleaner message and avoid log spam
            const isNetworkError = 
                error.code === 'ETIMEDOUT' || 
                error.code === 'ENOTFOUND' || 
                error.code === 'ECONNREFUSED' || 
                error.code === 'EHOSTUNREACH' || 
                error.code === 'ECONNRESET' || 
                error.message?.includes('timeout') || 
                error.message?.includes('fetch failed') ||
                (error.cause && (
                    error.cause.code === 'ETIMEDOUT' || 
                    error.cause.code === 'ENOTFOUND' || 
                    error.cause.code === 'ECONNREFUSED' || 
                    error.cause.code === 'EHOSTUNREACH' || 
                    error.cause.code === 'ECONNRESET' || 
                    error.cause.message?.includes('timeout') || 
                    error.cause.message?.includes('connect') ||
                    (Array.isArray(error.cause.errors) && error.cause.errors.some(e => 
                        e.code === 'ETIMEDOUT' || 
                        e.code === 'ENOTFOUND' || 
                        e.code === 'ECONNREFUSED' || 
                        e.code === 'EHOSTUNREACH' || 
                        e.code === 'ECONNRESET' || 
                        e.message?.includes('timeout') || 
                        e.message?.includes('connect')
                    ))
                ));
                
            if (isNetworkError) {
                let details = error.message;
                if (error.cause) {
                    details = error.cause.message || error.cause.code || error.message;
                    if (Array.isArray(error.cause.errors) && error.cause.errors.length > 0) {
                        details += ` [${error.cause.errors.map(e => e.message || e.code).join(', ')}]`;
                    }
                }
                logger.warn(`⚠️ [Telegram Bot] Network connection/timeout while polling updates: ${details}. Retrying in 30s...`);
                setTimeout(poll, 30000);
            } else {
                logger.error({ err: error }, '❌ [Telegram Bot] Error polling Telegram updates:');
                setTimeout(poll, 10000);
            }
        }
    }
    
    poll();
}

// Start Worker Service
async function startWorker() {
    logger.info('🚀 [Notification Worker] Starting background service...');
    try {
        await checkConnections();
        logger.info('✅ Database connections verified successfully.');
        
        // Initial schedule loading
        await checkAndReloadSchedules();
        
        // Setup schedule polling interval (every 10 seconds to auto-reload if database updates)
        setInterval(checkAndReloadSchedules, 10000);
        
        // Start Telegram message listener
        startTelegramBotListener();

        // Session keep-alive launches a browser, which is heavy on this shared
        // server.  It is off unless NHSO_KEEP_ALIVE_MINUTES is set (e.g. 60);
        // without it the session may expire sooner and need another ThaiD scan.
        const keepAliveMinutes = Number(process.env.NHSO_KEEP_ALIVE_MINUTES || 0);
        if (Number.isInteger(keepAliveMinutes) && keepAliveMinutes > 0) {
            const pattern = keepAliveMinutes >= 60 ? `0 */${Math.max(1, Math.floor(keepAliveMinutes / 60))} * * *` : `*/${keepAliveMinutes} * * * *`;
            cron.schedule(pattern, () => {
                logger.info('⏰ [Worker-Cron] Automatically triggering NHSO session keep-alive refresh...');
                keepAliveNhsoSession().catch(err => {
                    logger.error({ err: err }, '❌ [Worker-Cron] NHSO session keep-alive error:');
                });
            }, {
                scheduled: true,
                timezone: "Asia/Bangkok"
            });
            logger.info(`⏰ [Worker-Cron] NHSO session keep-alive scheduled ("${pattern}").`);
        } else {
            logger.info('ℹ️ [Worker-Cron] NHSO session keep-alive is off (set NHSO_KEEP_ALIVE_MINUTES to enable).');
        }

        logger.info('✅ Background Cron Scheduler, Session Keep-Alive, and Telegram Polling are fully active.');
    } catch (err) {
        logger.error({ err: err }, '❌ Failed to start Worker Service:');
        process.exit(1);
    }
}

startWorker();
