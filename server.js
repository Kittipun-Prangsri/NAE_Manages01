import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { checkConnections, trackerPool, hosxpPool } from './db.js';
import { initInternalDb } from './initDb.js';
import { verifyUserLogin, authenticateToken } from './auth.js';
import { getHosxpVisits, saveTrackingResults, saveAuthenLog, executeAdvancedRunLogic, checkNhsoStatusViaApi, getHosxpTotalVisits } from './dataService.js';
import { processCrossCheck } from './crossCheckLogic.js';
import cron from 'node-cron';
import { captureAndNotify } from './capture-grafana.js';
import { downloadNhsoReport, cleanOldDownloads } from './download-nhso.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

// Serve specific frontend files
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/api.js', (req, res) => res.sendFile(path.join(__dirname, 'api.js')));
app.get('/ui.js', (req, res) => res.sendFile(path.join(__dirname, 'ui.js')));
app.get('/utils.js', (req, res) => res.sendFile(path.join(__dirname, 'utils.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));

// Serve static files from 'dist' if they exist (only in production)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
}

// Serve screenshots statically (so LINE Messaging API can access them if public domain/IP is configured)
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Check DB Connections and Init Table
checkConnections().then(() => {
    initInternalDb();
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' });
    const result = await verifyUserLogin(username, password);
    result.success ? res.json(result) : res.status(401).json({ message: result.message });
});

// --- LINE Webhook for Group ID Discovery ---
app.post('/api/line/webhook', (req, res) => {
    const events = req.body.events || [];
    events.forEach(event => {
        console.log(`💬 [LINE Webhook Event] Type: ${event.type}`);
        if (event.source) {
            console.log(`   Source Type: ${event.source.type}`);
            if (event.source.groupId) {
                console.log(`   👉 LINE Group ID: ${event.source.groupId}`);
            }
            if (event.source.roomId) {
                console.log(`   👉 LINE Room ID: ${event.source.roomId}`);
            }
            if (event.source.userId) {
                console.log(`   👉 LINE User ID: ${event.source.userId}`);
            }
        }
    });
    res.sendStatus(200);
});

// --- NHSO Tracking Routes ---

/**
 * Endpoint สำหรับดึงวันที่จากไฟล์ Excel อัตโนมัติ (Date Probing)
 */
app.post('/api/sync/probe-date', authenticateToken, upload.single('excel'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'กรุณาอัปโหลดไฟล์ Excel' });

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
            raw: false, 
            dateNF: 'yyyy-mm-dd' 
        });

        if (excelData.length === 0) {
            return res.status(400).json({ message: 'ไฟล์ Excel ไม่มีข้อมูล' });
        }

        const dateCounts = {};
        let mostFrequentDate = null;
        let maxCount = 0;

        excelData.forEach(row => {
            let dateStr = row['วันที่เข้ารับบริการ'] || row['dateser'];
            if (dateStr) {
                if (dateStr instanceof Date) {
                   dateStr = dateStr.toISOString().split('T')[0];
                } else if (typeof dateStr === 'string') {
                   const matchDmy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                   const matchYmd = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
                   if (matchDmy) {
                       let [_, d, m, y] = matchDmy;
                       if (parseInt(y) > 2500) y = (parseInt(y) - 543).toString();
                       dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                   } else if (matchYmd) {
                       let [_, y, m, d] = matchYmd;
                       if (parseInt(y) > 2500) y = (parseInt(y) - 543).toString();
                       dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                   } else {
                       dateStr = dateStr.split(' ')[0];
                   }
                }

                if (dateStr) {
                    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
                    if (dateCounts[dateStr] > maxCount) {
                        maxCount = dateCounts[dateStr];
                        mostFrequentDate = dateStr;
                    }
                }
            }
        });

        res.json({
            success: true,
            detected_date: mostFrequentDate
        });
    } catch (error) {
        console.error('Probing Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอ่านไฟล์ Excel' });
    }
});

/**
 * Endpoint สำหรับดึงข้อมูล HOSxP และ Cross-check กับไฟล์ Excel (รวม Import & Process)
 */
app.post('/api/sync/process', authenticateToken, upload.single('excel'), async (req, res) => {
    try {
        const { visit_date } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });
        if (!req.file) return res.status(400).json({ message: 'กรุณาอัปโหลดไฟล์ Excel' });

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
            raw: false, 
            dateNF: 'yyyy-mm-dd hh:mm:ss' 
        });

        await saveAuthenLog(excelData, visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            return res.status(404).json({ message: 'บันทึก Log สำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        await executeAdvancedRunLogic(visit_date);

        // Capture Grafana and send Telegram/LINE in the background
        captureAndNotify().catch(err => console.error('❌ Error capturing Grafana after sync:', err));

        res.json({
            success: true,
            message: `ประมวลผลเสร็จสิ้น ${processedData.length} รายการ และอัปเดตข้อมูลสำเร็จ`,
            data: processedData
        });

    } catch (error) {
        console.error('Processing Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการประมวลผลข้อมูล' });
    }
});

/**
 * Endpoint สำหรับดึงข้อมูล HOSxP และ Cross-check กับข้อมูล JSON (จาก Clipboard)
 */
app.post('/api/sync/process-json', authenticateToken, async (req, res) => {
    try {
        const { visit_date, data } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });
        if (!data || !Array.isArray(data)) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });

        const excelData = data; // ใช้ข้อมูลจาก JSON ที่ส่งมาโดยตรง

        await saveAuthenLog(excelData, visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            return res.status(404).json({ message: 'บันทึก Log สำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        await executeAdvancedRunLogic(visit_date);

        // Capture Grafana and send Telegram/LINE in the background
        captureAndNotify().catch(err => console.error('❌ Error capturing Grafana after paste sync:', err));

        res.json({
            success: true,
            message: `ประมวลผล (Paste) เสร็จสิ้น ${processedData.length} รายการ`,
            data: processedData
        });

    } catch (error) {
        console.error('JSON Processing Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการประมวลผลข้อมูลจาก Clipboard' });
    }
});

/**
 * Endpoint สำหรับดึงข้อมูลจาก NHSO API โดยตรง (Direct API Automation)
 */
app.post('/api/sync/nhso-direct-api', authenticateToken, async (req, res) => {
    try {
        const { visit_date } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });

        const hosxpData = await getHosxpVisits(visit_date);
        if (hosxpData.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const bearerToken = process.env.NHSO_BEARER_TOKEN;
        const serviceCode = process.env.NHSO_SERVICE_CODE;

        if (!bearerToken || bearerToken === 'YOUR_BEARER_TOKEN_HERE') {
            return res.status(400).json({ message: 'กรุณาตั้งค่า NHSO_BEARER_TOKEN ใน .env ก่อนใช้งานฟีเจอร์นี้' });
        }

        console.log(`🚀 Starting direct API sync for ${hosxpData.length} patients on ${visit_date}`);
        
        const apiResults = [];
        const batchSize = 5; // เรียกพร้อมกันทีละ 5 รายการ

        for (let i = 0; i < hosxpData.length; i += batchSize) {
            const batch = hosxpData.slice(i, i + batchSize);
            const batchPromises = batch.map(async (patient) => {
                const nhsoInfo = await checkNhsoStatusViaApi(patient.cid, visit_date, serviceCode, bearerToken);
                // ปรับเงื่อนไขตามโครงสร้าง Response ของ NHSO API (จากผลการค้นหา JSON object)
                if (nhsoInfo && (nhsoInfo.authenCode || nhsoInfo.claimCode)) {
                    return {
                        cid: patient.cid,
                        authenCode: nhsoInfo.authenCode || nhsoInfo.claimCode,
                        channel: nhsoInfo.authenticationType || 'API Direct',
                        dateAuthen: nhsoInfo.serviceDate || visit_date,
                        fullName: nhsoInfo.patientName || patient.fullName,
                        visitDate: visit_date,
                        dateser: visit_date,
                        statusUse: 'E'
                    };
                }
                return null;
            });

            const results = await Promise.all(batchPromises);
            apiResults.push(...results.filter(r => r !== null));
            
            // ป้องกันการยิงรัวเกินไป
            if (i + batchSize < hosxpData.length) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }

        if (apiResults.length > 0) {
            await saveAuthenLog(apiResults, visit_date);
            const processedData = processCrossCheck(hosxpData, apiResults);
            await saveTrackingResults(processedData);
            await executeAdvancedRunLogic(visit_date);
            
            res.json({
                success: true,
                message: `ดึงข้อมูลจาก NHSO API สำเร็จ ${apiResults.length} จาก ${hosxpData.length} รายการ`,
                data: processedData
            });
        } else {
            res.json({
                success: true,
                message: `เชื่อมต่อ API สำเร็จ แต่ไม่พบข้อมูล Authen Code ในระบบ สปสช. (${hosxpData.length} ราย)`,
                data: []
            });
        }

    } catch (error) {
        console.error('Direct API Sync Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ NHSO API' });
    }
});

/**
 * Endpoint สำหรับสั่งบันทึกหน้าจอ Grafana ด้วยตนเอง (Manual Trigger)
 */
app.post('/api/sync/capture-grafana', authenticateToken, async (req, res) => {
    try {
        console.log(`📸 [Manual Trigger] Grafana Capture requested by user: ${req.user.username}`);
        const result = await captureAndNotify();
        if (result.success) {
            res.json({
                success: true,
                message: 'บันทึกหน้าจอและส่งรายงานสำเร็จเรียบร้อยแล้ว',
                filename: result.filename
            });
        } else {
            res.status(500).json({
                success: false,
                message: `เกิดข้อผิดพลาดในการบันทึกหน้าจอ: ${result.error}`
            });
        }
    } catch (error) {
        console.error('Manual Capture Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }
});

/**
 * Endpoint สำหรับสั่งดาวน์โหลดรายงาน สปสช และ Sync แบบแมนนวลผ่านเว็บ
 */
app.post('/api/sync/nhso-portal-download', authenticateToken, async (req, res) => {
    try {
        const visit_date = req.body.visit_date || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
        console.log(`📥 [Manual Trigger] NHSO Portal Download requested for date: ${visit_date} by user: ${req.user.username}`);

        // Run the sync process in the background to prevent HTTP connection timeouts
        runManualPortalSyncInBackground(visit_date).catch(err => {
            console.error('❌ Error in manual portal background sync:', err);
        });

        res.json({
            success: true,
            message: 'เริ่มดาวน์โหลดข้อมูลผ่านบอทหลังบ้านแล้ว! กรุณาตรวจสอบ QR Code และสแกนใน Telegram เพื่อเข้าระบบ'
        });

    } catch (error) {
        console.error('Manual Portal Download Sync Trigger Error:', error);
        res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการประมวลผล: ${error.message}` });
    }
});

async function runManualPortalSyncInBackground(visit_date) {
    console.log(`📥 [Background Portal Sync] Starting for date: ${visit_date}`);
    const dlResult = await downloadNhsoReport();
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = chatId ? chatId.split(',').map(id => id.trim()).filter(id => id) : [];

    if (!dlResult.success || !dlResult.filePath) {
        console.error(`❌ [Background Portal Sync] Download failed: ${dlResult.error}`);
        for (const id of chatIds) {
            await sendTelegramMessage(token, id, `❌ ไม่สามารถดึงรายงานอัตโนมัติของวันที่ ${visit_date} ได้: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
        }
        return;
    }

    console.log(`📥 [Background Portal Sync] Reading downloaded file: ${dlResult.filePath}`);
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
    console.log('✅ [Background Portal Sync] Database sync completed.');

    // Keep only the latest Excel download as backup
    cleanOldDownloads(path.join(__dirname, 'downloads'));

    // แจ้งเตือนใน Telegram
    for (const id of chatIds) {
        await sendTelegramMessage(token, id, `✅ ระบบดึงรายงานและประมวลผล Sync ประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังบันทึกภาพหน้าจอ Grafana...`);
    }

    // Capture Grafana and send Telegram/LINE in the background
    captureAndNotify().catch(err => console.error('❌ Error capturing Grafana after portal sync:', err));
}

/**
 * ดึงข้อมูล Dashboard จาก Internal DB
 */
app.get('/api/tracking/dashboard', authenticateToken, async (req, res) => {
    try {
        const { date, status } = req.query;
        let query = 'SELECT * FROM visit_tracking WHERE 1=1';
        const params = [];

        if (date) {
            query += ' AND visit_date = ?';
            params.push(date);
        }
        if (status) {
            query += ' AND color_status = ?';
            params.push(status);
        }

        query += ' ORDER BY color_status ASC, full_name ASC';

        const [rows] = await trackerPool.query(query, params);
        
        let hosxpStats = null;
        if (date) {
            hosxpStats = await getHosxpTotalVisits(date);
        }

        res.json({
            trackingData: rows,
            hosxpStats: hosxpStats
        });
    } catch (error) {
        console.error('Dashboard Fetch Error:', error);
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Dashboard ได้' });
    }
});

/**
 * ดึงข้อมูลสรุปรายวัน (Weekly Summary)
 */
app.get('/api/tracking/summary', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                visit_date, 
                SUM(CASE WHEN color_status = 'RED' THEN 1 ELSE 0 END) as red,
                SUM(CASE WHEN color_status = 'YELLOW' THEN 1 ELSE 0 END) as yellow,
                SUM(CASE WHEN color_status = 'GREEN' THEN 1 ELSE 0 END) as green,
                COUNT(*) as total
            FROM visit_tracking 
            WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY visit_date 
            ORDER BY visit_date DESC
        `;
        const [rows] = await trackerPool.query(query);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูลสรุปได้' });
    }
});

// --- Grafana-like Custom Query Routes ---

// ฟังก์ชันแปลงคำสั่ง Grafana Macros เป็น SQL มาตรฐาน
function replaceGrafanaMacros(query, visitDate, hipdataCodes) {
    if (!visitDate) {
        visitDate = new Date().toISOString().split('T')[0];
    }
    let processed = query;
    // แทนที่ $__timeFilter(column) ด้วย column = 'YYYY-MM-DD'
    processed = processed.replace(/\$__timeFilter\(([^)]+)\)/gi, (match, column) => {
        return `${column.trim()} = '${visitDate}'`;
    });
    // แทนที่ $hipdata_code ด้วยค่าสิทธิ์ (ค่าเริ่มต้นคือ 'UCS')
    processed = processed.replace(/\$hipdata_code/gi, hipdataCodes);
    return processed;
}

// 1. Endpoint รันคำสั่ง SQL Query
app.post('/api/custom-query', authenticateToken, async (req, res) => {
    try {
        const { query, db_type, visit_date, hipdata_code } = req.body;
        if (!query) return res.status(400).json({ message: 'กรุณาระบุคำสั่ง SQL Query' });

        // ตรวจสอบความปลอดภัยเบื้องต้น
        const trimmedQuery = query.trim().toUpperCase();
        const allowedPrefixes = ['SELECT', 'WITH', 'SHOW', 'DESCRIBE'];
        const isReadQuery = allowedPrefixes.some(prefix => trimmedQuery.startsWith(prefix));

        // ถ้าไม่ใช่คำสั่งอ่านข้อมูล และไม่ใช่ admin ให้ส่ง 403 Forbidden
        if (!isReadQuery && req.user.role !== 'admin') {
            return res.status(403).json({ 
                message: 'Forbidden: คุณไม่มีสิทธิ์ในการรันคำสั่งแก้ไขข้อมูล (UPDATE, DELETE, INSERT) เฉพาะผู้ดูแลระบบเท่านั้น' 
            });
        }

        // แปลง Grafana Macros
        const processedQuery = replaceGrafanaMacros(query, visit_date, hipdata_code || "'UCS'");
        console.log(`[SQL Query] DB: ${db_type || 'hosxp'} | User: ${req.user.username} | Role: ${req.user.role}`);

        const pool = db_type === 'tracker' ? trackerPool : hosxpPool;
        const startTime = Date.now();
        const [rows] = await pool.query(processedQuery);
        const executionTimeMs = Date.now() - startTime;

        res.json({
            success: true,
            rows,
            executionTimeMs,
            processedQuery
        });
    } catch (error) {
        console.error('❌ SQL Query Error:', error.message);
        res.status(500).json({ message: `ข้อผิดพลาด SQL: ${error.message}` });
    }
});

// 2. ดึงรายการคำสั่งที่บันทึกไว้
app.get('/api/saved-queries', authenticateToken, async (req, res) => {
    try {
        const [rows] = await trackerPool.query('SELECT * FROM saved_queries ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error('Saved queries fetch error:', error);
        res.json([]);
    }
});

// 3. บันทึกคำสั่ง
app.post('/api/saved-queries', authenticateToken, async (req, res) => {
    try {
        const { name, query_text, db_type } = req.body;
        if (!name || !query_text) return res.status(400).json({ message: 'กรุณาระบุชื่อและคำสั่ง SQL' });

        await trackerPool.query(
            'INSERT INTO saved_queries (name, query_text, db_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE query_text = VALUES(query_text), db_type = VALUES(db_type)',
            [name, query_text, db_type || 'hosxp']
        );
        res.json({ success: true, message: 'บันทึกคำสั่งสำเร็จ' });
    } catch (error) {
        res.status(500).json({ message: `ไม่สามารถบันทึกได้: ${error.message}` });
    }
});

// 4. ลบคำสั่ง
app.delete('/api/saved-queries/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await trackerPool.query('DELETE FROM saved_queries WHERE id = ?', [id]);
        res.json({ success: true, message: 'ลบคำสั่งสำเร็จ' });
    } catch (error) {
        res.status(500).json({ message: `ไม่สามารถลบได้: ${error.message}` });
    }
});

// For any other requests, serve the index.html from the root
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Grafana Screen Capture & NHSO Report Downloader Scheduler ---

// ฟังก์ชันดึงรายงานและแคปหน้าจออัตโนมัติแบบต่อเนื่อง (Sequential)
async function handleScheduledSyncAndCapture() {
    console.log('⏰ [Scheduler] เริ่มต้นกระบวนการดาวน์โหลดข้อมูลและบันทึกหน้าจออัตโนมัติ...');
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    
    try {
        const dlResult = await downloadNhsoReport();
        if (dlResult.success && dlResult.filePath) {
            console.log(`📥 [Scheduler] ดาวน์โหลดรายงานสำเร็จจาก สปสช: ${dlResult.filePath}`);
            
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
            cleanOldDownloads(path.join(__dirname, 'downloads'));

            console.log('✅ [Scheduler] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
        } else {
            console.warn(`⚠️ [Scheduler] การดาวน์โหลดข้อมูลอัตโนมัติไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('❌ [Scheduler] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:', err);
    }
    
    // บันทึกแดชบอร์ดสรุปผลและส่งแจ้งเตือนเข้าห้องแชท (LINE/Telegram)
    console.log('📸 [Scheduler] กำลังสั่งแคปเจอร์ภาพแดชบอร์ดและแจ้งเตือน...');
    await captureAndNotify();
}

// ตั้งเวลาทำงานอัตโนมัติ: 15.00 น. และ 20.29 น. (เวลาประเทศไทย Asia/Bangkok)
cron.schedule('0 15 * * *', () => {
    console.log('⏰ [Cron Scheduler] เริ่มต้นทำงานเวลา 15:00 น....');
    handleScheduledSyncAndCapture();
}, {
    scheduled: true,
    timezone: "Asia/Bangkok"
});

cron.schedule('29 20 * * *', () => {
    console.log('⏰ [Cron Scheduler] เริ่มต้นทำงานเวลา 20:29 น....');
    handleScheduledSyncAndCapture();
}, {
    scheduled: true,
    timezone: "Asia/Bangkok"
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startTelegramBotListener();
});

// --- Telegram Bot Command Listener (Polling) ---
let lastUpdateId = 0;

async function startTelegramBotListener() {
    console.log('🤖 Telegram Bot message listener started (Long Polling)...');
    
    // Background polling loop
    setInterval(async () => {
        try {
            // Dynamically reload .env configuration changes
            dotenv.config({ override: true });
            
            const token = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            if (!token || !chatId || chatId === 'your_telegram_chat_id_here') {
                return;
            }

            const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
            if (!response.ok) return;
            
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
                            
                            // Run the end-to-end sync and capture in the background!
                            runE2EPortalSyncAndCapture(fromChatId).catch(err => {
                                console.error('Error running E2E portal sync via telegram command:', err);
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error polling Telegram updates:', error);
        }
    }, 4000); // Poll every 4 seconds
}

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

async function runE2EPortalSyncAndCapture(targetChatId) {
    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
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
            cleanOldDownloads(path.join(__dirname, 'downloads'));
            
            // แจ้งเตือนความสำเร็จ
            await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, '✅ ซิงก์ข้อมูลฐานข้อมูลสำเร็จแล้ว! กำลังเตรียมบันทึกหน้าจอ Grafana...');
        } else {
            console.warn(`⚠️ [Telegram Trigger] การดาวน์โหลดข้อมูลไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
            await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, `❌ ดึงข้อมูลรายงานไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
        }
    } catch (err) {
        console.error('❌ [Telegram Trigger] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:', err);
        await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, `❌ ข้อผิดพลาดภายในเซิร์ฟเวอร์: ${err.message}`);
    }
    
    // บันทึกแดชบอร์ดสรุปผลและส่งแจ้งเตือนเข้าห้องแชท (LINE/Telegram)
    console.log('📸 [Telegram Trigger] กำลังสั่งแคปเจอร์ภาพแดชบอร์ดและแจ้งเตือน...');
    await captureAndNotify();
}
