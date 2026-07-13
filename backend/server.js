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
import { getHosxpVisits, saveTrackingResults, saveAuthenLog, executeAdvancedRunLogic, checkNhsoStatusViaApi, getHosxpTotalVisits, getLiveDashboardGeo, getLiveDashboardDeps, getHosxpSummaryStats } from './dataService.js';
import { processCrossCheck } from './crossCheckLogic.js';
import cron from 'node-cron';
import { captureAndNotify } from '../jobs/capture-grafana.js';
import { downloadNhsoReport, cleanOldDownloads } from '../jobs/download-nhso.js';
import visitRoutes from './routes/visitRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

// Visit routes
app.use('/api/visits', authenticateToken, visitRoutes);

// Serve specific frontend files
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.js')));
app.get('/api.js', (req, res) => res.sendFile(path.join(__dirname, '../frontend/api.js')));
app.get('/ui.js', (req, res) => res.sendFile(path.join(__dirname, '../frontend/ui.js')));
app.get('/utils.js', (req, res) => res.sendFile(path.join(__dirname, '../frontend/utils.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, '../frontend/style.css')));

// Serve static files from 'dist' if they exist (only in production)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));
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

// Helper to reply LINE message using Flex Report (Free)
async function sendLineReplyFlexSummary(replyToken, queryDate) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ LINE Flex summary reply is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token || token === 'your_line_token_here') {
        console.error('❌ LINE token not configured.');
        return;
    }
    
    try {
        // Query data stats
        const [[{ total_visits }]] = await trackerPool.query(
            'SELECT COUNT(*) as total_visits FROM visit_tracking WHERE visit_date = ?',
            [queryDate]
        );

        const [[{ total_money }]] = await trackerPool.query(
            'SELECT COALESCE(SUM(uc_money), 0) as total_money FROM visit_tracking WHERE visit_date = ?',
            [queryDate]
        );

        const [[{ endpoint_count }]] = await trackerPool.query(
            "SELECT COUNT(*) as endpoint_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'YELLOW'",
            [queryDate]
        );

        const [[{ not_imported_count }]] = await trackerPool.query(
            "SELECT COUNT(*) as not_imported_count FROM visit_tracking WHERE visit_date = ? AND check_claimcode = 'ยังไม่ได้นำเข้า'",
            [queryDate]
        );

        const [[{ authen_count }]] = await trackerPool.query(
            "SELECT COUNT(*) as authen_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'GREEN'",
            [queryDate]
        );

        const [rights] = await trackerPool.query(
            'SELECT COALESCE(pttype_note, pttype) as right_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? GROUP BY right_name ORDER BY cnt DESC LIMIT 3',
            [queryDate]
        );

        const [[{ ucs_total }]] = await trackerPool.query(
            "SELECT COUNT(*) as ucs_total FROM visit_tracking WHERE visit_date = ? AND UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW')",
            [queryDate]
        );

        const [ucs_departments] = await trackerPool.query(
            "SELECT COALESCE(department, 'ไม่ระบุจุดบริการ') as dept_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? AND UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW') GROUP BY dept_name ORDER BY cnt DESC LIMIT 3",
            [queryDate]
        );

        // Build right items contents dynamically
        const rightsContents = [];
        rights.forEach(r => {
            rightsContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": r.right_name || 'ไม่ระบุสิทธิ',
                        "color": "#ffffff",
                        "size": "sm"
                    },
                    {
                        "type": "text",
                        "text": String(r.cnt),
                        "color": "#52c41a",
                        "size": "md",
                        "align": "end",
                        "weight": "bold"
                    }
                ]
            });
        });

        // Build UCS department items dynamically
        const ucsContents = [
            {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": "UCS ไม่ได้ปิดสิทธิ",
                        "color": "#ffffff",
                        "size": "sm",
                        "weight": "bold"
                    },
                    {
                        "type": "text",
                        "text": String(ucs_total),
                        "color": "#ff4d4d",
                        "size": "md",
                        "align": "end",
                        "weight": "bold"
                    }
                ]
            }
        ];

        ucs_departments.forEach(d => {
            ucsContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": ` - ${d.dept_name}`,
                        "color": "#8c8c8c",
                        "size": "xs"
                    },
                    {
                        "type": "text",
                        "text": String(d.cnt),
                        "color": "#ffffff",
                        "size": "xs",
                        "align": "end"
                    }
                ]
            });
        });

        // Construct exact bubble
        const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
        const flexBubble = {
            "type": "bubble",
            "size": "giga",
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#18191a",
                "contents": [
                    {
                        "type": "text",
                        "text": "📊 สรุปข้อมูลการให้บริการ",
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "xl"
                    },
                    {
                        "type": "text",
                        "text": `Dashboard Summary (${formattedDate})`,
                        "size": "xs",
                        "color": "#8c8c8c",
                        "margin": "sm"
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": "จำนวนผู้มารับบริการ(ครั้ง)",
                                        "color": "#ffffff",
                                        "size": "sm",
                                        "gravity": "center"
                                    },
                                    {
                                        "type": "text",
                                        "text": String(total_visits),
                                        "color": "#ff4d4d",
                                        "size": "xl",
                                        "align": "end",
                                        "weight": "bold"
                                    }
                                ]
                            },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": "ค่ารักษาลูกหนี้ (sum)",
                                        "color": "#ffffff",
                                        "size": "sm",
                                        "gravity": "center"
                                    },
                                    {
                                        "type": "text",
                                        "text": Number(total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                                        "color": "#ff4d4d",
                                        "size": "xl",
                                        "align": "end",
                                        "weight": "bold"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "Visit Authen code",
                                "color": "#8c8c8c",
                                "size": "xs",
                                "weight": "bold"
                            },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "ENDPOINT",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(endpoint_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    },
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "ยังไม่นำเข้า",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(not_imported_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    },
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "AUTHENCODE",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(authen_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "สิทธิการรักษา (Top 3)",
                                "color": "#8c8c8c",
                                "size": "xs",
                                "weight": "bold"
                            },
                            ...rightsContents
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": ucsContents
                    }
                ]
            }
        };

        const payload = {
            replyToken: replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: `📊 สรุปข้อมูลการให้บริการ (${queryDate})`,
                    contents: flexBubble
                }
            ]
        };

        const response = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json().catch(() => ({}));
        if (response.ok) {
            console.log('✅ Sent LINE Reply Flex Message successfully.');
        } else {
            console.error('❌ LINE Reply API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error replying to LINE:', error);
    }
}

// --- LINE Webhook for Group ID Discovery & Commands ---
app.post('/api/line/webhook', (req, res) => {
    const events = req.body.events || [];
    events.forEach(async (event) => {
        console.log(`💬 [LINE Webhook Event] Type: ${event.type}`);
        
        // Log Group IDs and sources
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

        // Listen for Text Messages
        if (event.type === 'message' && event.message && event.message.type === 'text') {
            const text = event.message.text.trim();
            const replyToken = event.replyToken;

            if (text.startsWith('นำเข้าข้อมูล')) {
                const parts = text.split(/\s+/);
                // Default to today (Bangkok timezone YYYY-MM-DD)
                let queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
                
                // Allow specifying custom date, e.g. "นำเข้าข้อมูล 2026-07-07"
                if (parts.length > 1) {
                    const dateMatch = parts[1].match(/^\d{4}-\d{2}-\d{2}$/);
                    if (dateMatch) {
                        queryDate = parts[1];
                    }
                }

                console.log(`💬 [LINE Webhook] Command 'นำเข้าข้อมูล' received for date: ${queryDate}. Sending Reply Flex Message...`);
                
                // Reply asynchronously in the background
                sendLineReplyFlexSummary(replyToken, queryDate).catch(err => {
                    console.error('❌ Error executing LINE reply handler:', err);
                });
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
        await executeAdvancedRunLogic(visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            return res.status(404).json({ message: 'บันทึก Log และประมวลผลระบบสำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);

        // (Auto-capture disabled in favor of frontend pop-up selection)

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
        await executeAdvancedRunLogic(visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            return res.status(404).json({ message: 'บันทึก Log และประมวลผลระบบสำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);

        // (Auto-capture disabled in favor of frontend pop-up selection)

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
            await executeAdvancedRunLogic(visit_date);
            const updatedHosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(updatedHosxpData, apiResults);
            await saveTrackingResults(processedData);
            
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
        const { visit_date, channels, report_types } = req.body;
        const username = req.user.username;
        console.log(`📸 [Manual Trigger] Grafana Capture requested by user: ${username} for date: ${visit_date || 'today'}`);

        // Look up user-specific notification credentials from the internal DB
        const [userRows] = await trackerPool.query(
            'SELECT line_token, line_group_id, telegram_token, telegram_chat_id FROM users WHERE username = ?',
            [username]
        );

        let userCredentials = null;
        if (userRows.length > 0) {
            const u = userRows[0];
            const hasLine = u.line_token && u.line_group_id;
            const hasTelegram = u.telegram_token && u.telegram_chat_id;

            if (hasLine || hasTelegram) {
                userCredentials = {
                    line_token: u.line_token || null,
                    line_group_id: u.line_group_id || null,
                    telegram_token: u.telegram_token || null,
                    telegram_chat_id: u.telegram_chat_id || null,
                };
                console.log(`📲 Using personal notification credentials for user: ${username} (LINE: ${hasLine ? 'yes' : 'no'}, Telegram: ${hasTelegram ? 'yes' : 'no'})`);
            } else {
                console.warn(`⚠️ User ${username} has no notification channels configured in their profile. Falling back to system credentials from .env.`);
            }
        } else {
            console.warn(`⚠️ User ${username} not found in internal DB. Falling back to system credentials from .env.`);
        }

        const result = await captureAndNotify(visit_date, channels, report_types, userCredentials);
        if (result.success) {
            res.json({
                success: true,
                message: 'ส่งรายงานเรียบร้อยแล้ว',
                filename: result.filename
            });
        } else {
            res.status(500).json({
                success: false,
                message: `เกิดข้อผิดพลาดในการส่งรายงาน: ${result.error}`
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
    await sendLineMessage(`⏳ [Manual Sync] เริ่มต้นดาวน์โหลดข้อมูลและขอ QR Code สแกนผ่านแอป ThaiD ประจำวันที่ ${visit_date}...`);
    const dlResult = await downloadNhsoReport();
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = chatId ? chatId.split(',').map(id => id.trim()).filter(id => id) : [];

    if (!dlResult.success || !dlResult.filePath) {
        console.error(`❌ [Background Portal Sync] Download failed: ${dlResult.error}`);
        for (const id of chatIds) {
            await sendTelegramMessage(token, id, `❌ ไม่สามารถดึงรายงานอัตโนมัติของวันที่ ${visit_date} ได้: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
        }
        await sendLineMessage(`❌ [Manual Sync] ไม่สามารถดึงรายงานอัตโนมัติของวันที่ ${visit_date} ได้: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
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
    await executeAdvancedRunLogic(visit_date);
    const hosxpData = await getHosxpVisits(visit_date);
    const processedData = processCrossCheck(hosxpData, excelData);
    await saveTrackingResults(processedData);
    console.log('✅ [Background Portal Sync] Database sync completed.');

    // Keep only the latest Excel download as backup
    cleanOldDownloads(path.join(__dirname, 'downloads'));

    // แจ้งเตือนใน Telegram & LINE
    for (const id of chatIds) {
        await sendTelegramMessage(token, id, `✅ ระบบดึงรายงานและประมวลผล Sync ประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังบันทึกภาพหน้าจอ Grafana...`);
    }
    await sendLineMessage(`✅ ระบบดึงรายงานและประมวลผล Sync ประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังบันทึกภาพหน้าจอ Grafana...`);

    // Capture Grafana and send Telegram/LINE in the background
    captureAndNotify(visit_date).catch(err => console.error('❌ Error capturing Grafana after portal sync:', err));
}

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
            hosxpStats: hosxpStats,
            disableNotifications: process.env.DISABLE_NOTIFICATIONS === 'true'
        });
    } catch (error) {
        console.error('Dashboard Fetch Error:', error);
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Dashboard ได้' });
    }
});

/**
 * ดึงข้อมูลสรุปแบบเรียลไทม์ (แผนที่ความหนาแน่นคนไข้รายตำบล + ปริมาณคนไข้ตามแผนก)
 */
app.get('/api/dashboard/live-data', authenticateToken, async (req, res) => {
    try {
        const visit_date = req.query.date || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
        console.log(`📊 [Live Dashboard] Fetching live data for date: ${visit_date} by user: ${req.user.username}`);

        // Fetch subdistrict density map data (from HOSxP)
        const geoData = await getLiveDashboardGeo(visit_date);

        // Fetch department volumes (from HOSxP)
        const depData = await getLiveDashboardDeps(visit_date);

        // Fetch HOSxP stats for the date (total visits, total persons, total uc money)
        const hosxpStats = await getHosxpTotalVisits(visit_date);

        // Fetch pending count from the internal tracking DB (where authen is not completed yet)
        const [[{ pending_count }]] = await trackerPool.query(
            "SELECT COUNT(*) as pending_count FROM visit_tracking WHERE visit_date = ? AND color_status IN ('RED', 'YELLOW')",
            [visit_date]
        );

        res.json({
            success: true,
            visit_date,
            geoData,
            depData,
            hosxpStats,
            pending_count: pending_count || 0
        });
    } catch (error) {
        console.error('❌ Error fetching live dashboard data:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล Dashboard' });
    }
});

/**
 * ดึงไฟล์ GeoJSON ของตำบลในอำเภอคลองหาด
 */
app.get('/api/geojson', authenticateToken, async (req, res) => {
    try {
        const geojsonPath = path.join(__dirname, 'khlonghat.geojson');
        fs.readFile(geojsonPath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading GeoJSON:', err);
                return res.status(500).json({ error: 'ไม่พบไฟล์ขอบเขตแผนที่ระดับตำบล' });
            }
            res.setHeader('Content-Type', 'application/json');
            res.send(data);
        });
    } catch (error) {
        console.error('❌ Error serving geojson:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดแผนที่' });
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

// --- Admin User Management CRUD API ---

// Helper middleware to check if user has admin role
function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Forbidden: Requires admin privileges' });
    }
}

// 1. Get all users
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await trackerPool.query('SELECT id, username, full_name, role, department, line_token, line_group_id, telegram_token, telegram_chat_id, created_at, updated_at FROM users ORDER BY id ASC');
        res.json(rows);
    } catch (error) {
        console.error('Fetch users error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Create user
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, full_name, role, department, line_token, line_group_id, telegram_token, telegram_chat_id } = req.body;
        if (!username) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Username' });
        }
        await trackerPool.query(
            `INSERT INTO users (username, full_name, role, department, line_token, line_group_id, telegram_token, telegram_chat_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, full_name || '', role || 'user', department || '', line_token || null, line_group_id || null, telegram_token || null, telegram_chat_id || null]
        );
        res.json({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จ' });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Update user
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, full_name, role, department, line_token, line_group_id, telegram_token, telegram_chat_id } = req.body;
        if (!username) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Username' });
        }
        await trackerPool.query(
            `UPDATE users 
             SET username = ?, full_name = ?, role = ?, department = ?, line_token = ?, line_group_id = ?, telegram_token = ?, telegram_chat_id = ? 
             WHERE id = ?`,
            [username, full_name || '', role || 'user', department || '', line_token || null, line_group_id || null, telegram_token || null, telegram_chat_id || null, id]
        );
        res.json({ success: true, message: 'แก้ไขข้อมูลผู้ใช้งานสำเร็จ' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Delete user
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await trackerPool.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 5. Test Notification
app.post('/api/admin/users/test-notification', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, token, target } = req.body;
        if (!token || !target) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุ Token และ ID ปลายทาง' });
        }

        const testMessage = `🔔 Test Notification from NAE Manages System\n📅 Date: ${new Date().toLocaleString('th-TH')}\n⚙️ Status: Connection OK!`;

        if (type === 'line') {
            console.log(`📲 Testing LINE message push...`);
            const payload = {
                to: target,
                messages: [
                    {
                        type: 'text',
                        text: testMessage
                    }
                ]
            };

            const response = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                return res.json({ success: true, message: 'ส่งข้อความทดสอบไปยัง LINE สำเร็จ!' });
            } else {
                return res.status(400).json({ success: false, message: `LINE API Error: ${data.message || response.statusText}` });
            }
        } else if (type === 'telegram') {
            console.log(`📲 Testing Telegram message push...`);
            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: target, text: testMessage })
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok && data.ok) {
                return res.json({ success: true, message: 'ส่งข้อความทดสอบไปยัง Telegram สำเร็จ!' });
            } else {
                return res.status(400).json({ success: false, message: `Telegram API Error: ${data.description || response.statusText}` });
            }
        } else {
            return res.status(400).json({ success: false, message: 'ไม่รองรับช่องทางนี้' });
        }
    } catch (error) {
        console.error('Test notification error:', error);
        res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${error.message}` });
    }
});

// --- Cron Schedules CRUD Endpoints ---

// 1. Get all schedules
app.get('/api/admin/schedules', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await trackerPool.query('SELECT * FROM cron_schedules ORDER BY schedule_time ASC');
        const formatted = rows.map(r => {
            const [hh, mm] = r.schedule_time.split(':');
            return {
                id: r.id,
                schedule_time: `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`,
                is_enabled: !!r.is_enabled
            };
        });
        res.json({ success: true, schedules: formatted });
    } catch (error) {
        console.error('Get schedules error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Add new schedule
app.post('/api/admin/schedules', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { schedule_time } = req.body; // 'HH:MM'
        if (!schedule_time) return res.status(400).json({ success: false, message: 'กรุณาระบุเวลาทำงาน' });

        const timeWithSeconds = `${schedule_time}:00`;
        await trackerPool.query('INSERT INTO cron_schedules (schedule_time, is_enabled) VALUES (?, 1)', [timeWithSeconds]);
        await reloadSchedules();
        res.json({ success: true, message: 'เพิ่มเวลาทำงานสำเร็จ' });
    } catch (error) {
        console.error('Add schedule error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ success: false, message: 'เวลานี้ถูกกำหนดไว้แล้ว' });
        } else {
            res.status(500).json({ success: false, message: error.message });
        }
    }
});

// 3. Toggle or edit schedule
app.put('/api/admin/schedules/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_enabled, schedule_time } = req.body;

        if (schedule_time) {
            const timeWithSeconds = `${schedule_time}:00`;
            await trackerPool.query('UPDATE cron_schedules SET schedule_time = ? WHERE id = ?', [timeWithSeconds, id]);
        }
        if (is_enabled !== undefined) {
            const enabledVal = is_enabled ? 1 : 0;
            await trackerPool.query('UPDATE cron_schedules SET is_enabled = ? WHERE id = ?', [enabledVal, id]);
        }

        await reloadSchedules();
        res.json({ success: true, message: 'อัปเดตเวลาทำงานสำเร็จ' });
    } catch (error) {
        console.error('Update schedule error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Delete schedule
app.delete('/api/admin/schedules/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await trackerPool.query('DELETE FROM cron_schedules WHERE id = ?', [id]);
        await reloadSchedules();
        res.json({ success: true, message: 'ลบเวลาทำงานสำเร็จ' });
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// For any other requests, serve the index.html from the root
app.use((req, res) => {
    if (process.env.NODE_ENV === 'production') {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
        res.sendFile(path.join(__dirname, '../frontend/index.html'));
    }
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
            await executeAdvancedRunLogic(visit_date);
            const hosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(hosxpData, excelData);
            await saveTrackingResults(processedData);
            
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
    await captureAndNotify(visit_date);
}

// --- Dynamic Cron Scheduler Configurator ---
let activeCronTasks = [];

async function reloadSchedules() {
    console.log('⏰ [Scheduler] Reloading cron schedules from database...');
    try {
        // Stop and destroy all currently running tasks
        activeCronTasks.forEach(task => {
            if (task && typeof task.stop === 'function') {
                task.stop();
            }
        });
        activeCronTasks = [];

        // Fetch enabled schedules from database
        const [rows] = await trackerPool.query('SELECT schedule_time FROM cron_schedules WHERE is_enabled = TRUE');
        
        console.log(`⏰ [Scheduler] Found ${rows.length} active schedule(s). Registering tasks...`);
        
        for (const row of rows) {
            const timeStr = row.schedule_time; // format 'HH:MM:SS' or 'HH:MM'
            const [hh, mm] = timeStr.split(':');
            
            // Build standard cron pattern: 'mm hh * * *'
            const cronPattern = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
            
            console.log(`⏰ [Scheduler] Scheduling job at ${hh}:${mm} (Cron pattern: "${cronPattern}")`);
            
            const task = cron.schedule(cronPattern, () => {
                console.log(`⏰ [Cron Scheduler] Automatically triggering sync and capture task for time: ${timeStr}...`);
                handleScheduledSyncAndCapture();
            }, {
                scheduled: true,
                timezone: "Asia/Bangkok"
            });
            
            activeCronTasks.push(task);
        }
        console.log('✅ [Scheduler] Schedules reloaded and registered successfully.');
    } catch (error) {
        console.error('❌ [Scheduler] Error reloading cron schedules:', error);
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    if (process.env.DISABLE_BACKGROUND_JOBS === 'true') {
        console.log('ℹ️ [Server] DISABLE_BACKGROUND_JOBS=true: Background scheduler and Telegram bot listener are disabled on this instance.');
    } else {
        startTelegramBotListener();
        reloadSchedules(); // Initial loading of database schedules
    }
});

// --- Telegram Bot Command Listener (Polling) ---
let lastUpdateId = 0;

async function startTelegramBotListener() {
    console.log('🤖 Telegram Bot message listener started (Long Polling)...');
    
    let isPolling = false;
    
    async function poll() {
        if (isPolling) return;
        isPolling = true;
        
        try {
            // Dynamically reload .env configuration changes
            dotenv.config({ override: true });
            
            const token = process.env.TELEGRAM_BOT_TOKEN;
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
                                
                                // Run the end-to-end sync and capture in the background!
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
            setTimeout(poll, 10000);
        }
    }
    
    poll();
}

async function sendTelegramMessage(token, chatId, text) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ Telegram message is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
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
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ LINE status message is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
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
            await executeAdvancedRunLogic(visit_date);
            const hosxpData = await getHosxpVisits(visit_date);
            const processedData = processCrossCheck(hosxpData, excelData);
            await saveTrackingResults(processedData);
            console.log('✅ [Telegram Trigger] อัปเดตข้อมูลและประมวลผลฐานข้อมูลเปรียบเทียบเรียบร้อยแล้ว');
            
            // เคลียร์ไฟล์ดาวน์โหลด
            cleanOldDownloads(path.join(__dirname, 'downloads'));
            
            // แจ้งเตือนความสำเร็จ
            await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, '✅ ซิงก์ข้อมูลฐานข้อมูลสำเร็จแล้ว! กำลังเตรียมบันทึกหน้าจอ Grafana...');
            await sendLineMessage(`✅ ดึงข้อมูลรายงานและประมวลผลข้อมูลประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังเตรียมส่งรายงาน Flex...`);
        } else {
            console.warn(`⚠️ [Telegram Trigger] การดาวน์โหลดข้อมูลไม่สำเร็จ: ${dlResult.error || 'Unknown error'}`);
            await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, `❌ ดึงข้อมูลรายงานไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
            await sendLineMessage(`❌ ดึงข้อมูลรายงานของวันที่ ${visit_date} ไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`);
        }
    } catch (err) {
        console.error('❌ [Telegram Trigger] ข้อผิดพลาดในขั้นตอนดาวน์โหลด/ประมวลผลข้อมูล:', err);
        await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, targetChatId, `❌ ข้อผิดพลาดภายในเซิร์ฟเวอร์: ${err.message}`);
        await sendLineMessage(`❌ เกิดข้อผิดพลาดในเซิร์ฟเวอร์: ${err.message}`);
    }
    
    // บันทึกแดชบอร์ดสรุปผลและส่งแจ้งเตือนเข้าห้องแชท (LINE/Telegram)
    console.log('📸 [Telegram Trigger] กำลังสั่งแคปเจอร์ภาพแดชบอร์ดและแจ้งเตือน...');
    await captureAndNotify(visit_date);
}
