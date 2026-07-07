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
    saveAuthenLog, 
    executeAdvancedRunLogic 
} from '../backend/dataService.js';
import { processCrossCheck } from '../backend/crossCheckLogic.js';
import { captureAndNotify } from './capture-grafana.js';
import { downloadNhsoReport, cleanOldDownloads } from './download-nhso.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for absolute path to downloads
const downloadsDir = path.join(__dirname, '../downloads');

// We will keep track of registered cron jobs
let activeCronTasks = [];
let lastKnownSchedulesStr = '';

async function handleScheduledSyncAndCapture() {
    console.log('⏰ [Worker-Scheduler] เริ่มต้นกระบวนการดาวน์โหลดข้อมูลและบันทึกหน้าจออัตโนมัติ...');
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    await sendLineMessage(`⏰ [Scheduler] เริ่มต้นการทำรายงานและประมวลผลข้อมูลอัตโนมัติ ประจำวันที่ ${visit_date}...`);
    
    try {
        const dlResult = await downloadNhsoReport();
        if (dlResult.success && dlResult.filePath) {
            console.log(`📥 [Worker-Scheduler] ดาวน์โหลดรายงานสำเร็จจาก สปสช: ${dlResult.filePath}`);
            
            // อ่านไฟล์ Excel ที่เพิ่งโหลดมา
            const fileBuffer = fs.readFileSync(dlResult.filePath);
            const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
                raw: false, 
                dateNF: 'yyyy-mm-dd hh:mm:ss' 
            });
            
            // นำข้อมูลเข้าสู่ฐานข้อมูลและประมวลผลเปรียบเทียบ
            await saveAuthenLog(excelData, visit_date);
            const hosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(hosxpData, excelData);
            await saveTrackingResults(processedData);
            await executeAdvancedRunLogic(visit_date);
            
            // Keep only the latest Excel download as backup
            cleanOldDownloads(downloadsDir);

            console.log('✅ [Worker-Scheduler] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
        } else {
            console.warn(`⚠️ [Worker-Scheduler] การดาวน์โหลดข้อมูลอัตโนมัติไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('❌ [Worker-Scheduler] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:', err);
    }
    
    // บันทึกแดชบอร์ดสรุปผลและส่งแจ้งเตือนเข้าห้องแชท (LINE/Telegram)
    console.log('📸 [Worker-Scheduler] กำลังสั่งแคปเจอร์ภาพแดชบอร์ดและแจ้งเตือน...');
    try {
        await captureAndNotify();
    } catch (err) {
        console.error('❌ [Worker-Scheduler] ข้อผิดพลาดในการบันทึกแดชบอร์ด/ส่งแจ้งเตือน:', err);
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

        console.log(`⏰ [Worker-Scheduler] Registering ${rows.length} active schedule(s)...`);
        
        for (const row of rows) {
            const timeStr = row.schedule_time; // format 'HH:MM:SS' or 'HH:MM'
            const [hh, mm] = timeStr.split(':');
            
            // Build standard cron pattern: 'mm hh * * *'
            const cronPattern = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
            
            console.log(`⏰ [Worker-Scheduler] Scheduling job at ${hh}:${mm} (Cron pattern: "${cronPattern}")`);
            
            const task = cron.schedule(cronPattern, () => {
                console.log(`⏰ [Worker-Cron] Automatically triggering sync and capture task for time: ${timeStr}...`);
                handleScheduledSyncAndCapture();
            }, {
                scheduled: true,
                timezone: "Asia/Bangkok"
            });
            
            activeCronTasks.push(task);
        }
        console.log('✅ [Worker-Scheduler] Schedules reloaded and registered successfully.');
    } catch (error) {
        console.error('❌ [Worker-Scheduler] Error loading cron schedules:', error);
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
        console.error('❌ [Worker] Error fetching schedules from DB:', error);
    }
}

// --- Telegram Bot Command Listener (Polling) ---
let lastUpdateId = 0;

async function sendTelegramMessage(token, chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
    } catch (err) {
        console.error('Error sending message:', err);
    }
}

async function sendLineMessage(text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_GROUP_ID;
    if (!token || !groupId || token === 'your_line_token_here' || groupId === 'your_group_id_here') {
        return;
    }
    try {
        const payload = {
            to: groupId,
            messages: [
                {
                    type: 'text',
                    text: text
                }
            ]
        };
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        console.log('✅ Sent status message to LINE successfully.');
    } catch (err) {
        console.error('Error sending message to LINE:', err);
    }
}

async function runE2EPortalSyncAndCapture(targetChatId) {
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    try {
        const dlResult = await downloadNhsoReport();
        if (dlResult.success && dlResult.filePath) {
            console.log(`📥 [Telegram Trigger] ดาวน์โหลดรายงานสำเร็จจาก สปสช: ${dlResult.filePath}`);
            
            // อ่าน Excel
            const fileBuffer = fs.readFileSync(dlResult.filePath);
            const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
                raw: false, 
                dateNF: 'yyyy-mm-dd hh:mm:ss' 
            });
            
            // นำเข้าข้อมูลและประมวลผล Sync
            await saveAuthenLog(excelData, visit_date);
            const hosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(hosxpData, excelData);
            await saveTrackingResults(processedData);
            await executeAdvancedRunLogic(visit_date);
            console.log('✅ [Telegram Trigger] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
            
            // เคลียร์ไฟล์ดาวน์โหลด
            cleanOldDownloads(downloadsDir);
            
            // แจ้งเตือนความสำเร็จ
            await sendTelegramMessage(token, targetChatId, '✅ ซิงก์ข้อมูลฐานข้อมูลสำเร็จแล้ว! กำลังเตรียมบันทึกหน้าจอ Grafana...');
            await sendLineMessage(`✅ ดึงข้อมูลรายงานและประมวลผลข้อมูลประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังเตรียมส่งรายงาน Flex...`);
        } else {
            console.warn(`⚠️ [Telegram Trigger] การดาวน์โหลดข้อมูลไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
            await sendTelegramMessage(token, targetChatId, `❌ ดึงข้อมูลรายงานไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
            await sendLineMessage(`❌ ดึงข้อมูลรายงานของวันที่ ${visit_date} ไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
        }
    } catch (err) {
        console.error('❌ [Telegram Trigger] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:', err);
        await sendTelegramMessage(token, targetChatId, `❌ ข้อผิดพลาดภายในเซิร์ฟเวอร์: ${err.message}`);
        await sendLineMessage(`❌ เกิดข้อผิดพลาดในเซิร์ฟเวอร์: ${err.message}`);
    }
    
    // บันทึกแดชบอร์ดสรุปผลและส่งแจ้งเตือนเข้าห้องแชท (LINE/Telegram)
    console.log('📸 [Telegram Trigger] กำลังสั่งแคปเจอร์ภาพแดชบอร์ดและแจ้งเตือน...');
    try {
        await captureAndNotify();
    } catch (err) {
        console.error('❌ [Telegram Trigger] ข้อผิดพลาดในการบันทึกแดชบอร์ด/ส่งแจ้งเตือน:', err);
    }
}

async function startTelegramBotListener() {
    console.log('🤖 Telegram Bot message listener started (Long Polling)...');
    
    let isPolling = false;
    
    async function poll() {
        if (isPolling) return;
        isPolling = true;
        
        try {
            // Dynamically reload .env configuration changes
            dotenv.config({ override: true });
            
            const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            if (!token || !chatId || chatId === 'your_telegram_chat_id_here') {
                isPolling = false;
                setTimeout(poll, 10000);
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            try {
                const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    console.warn(`⚠️ [Telegram Bot] Polling response not OK: ${response.status} ${response.statusText}`);
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
                                console.log(`🤖 [Telegram Bot] Received command: "${text}" from Chat: ${fromChatId}`);
                                
                                // Send initial acknowledgment
                                await sendTelegramMessage(token, fromChatId, '⏳ กำลังเตรียมการเข้าสู่ระบบ สปสช. และดึง QR Code ของ ThaiD...');
                                await sendLineMessage('⏳ [Telegram Command] กำลังเตรียมการดึงข้อมูลและขอ QR Code สแกนผ่านแอป ThaiD...');
                                
                                // Run the end-to-end sync and capture in the background
                                runE2EPortalSyncAndCapture(fromChatId).catch(err => {
                                    console.error('Error running E2E portal sync via telegram command:', err);
                                });
                            }
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
            console.error('Error polling Telegram updates:', error);
            isPolling = false;
            // Wait 10 seconds before retrying on network error/timeout to avoid hammering
            setTimeout(poll, 10000);
        }
    }
    
    poll();
}

// Start Worker Service
async function startWorker() {
    console.log('🚀 [Notification Worker] Starting background service...');
    try {
        await checkConnections();
        console.log('✅ Database connections verified successfully.');
        
        // Initial schedule loading
        await checkAndReloadSchedules();
        
        // Setup schedule polling interval (every 10 seconds to auto-reload if database updates)
        setInterval(checkAndReloadSchedules, 10000);
        
        // Start Telegram message listener
        startTelegramBotListener();
        
        console.log('✅ Background Cron Scheduler and Telegram Polling are fully active.');
    } catch (err) {
        console.error('❌ Failed to start Worker Service:', err);
        process.exit(1);
    }
}

startWorker();
