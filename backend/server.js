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
import { getHosxpVisits, saveTrackingResults, saveAuthenLog, executeAdvancedRunLogic, checkNhsoStatusViaApi, getHosxpTotalVisits, getLiveDashboardGeo, getLiveDashboardDeps, getHosxpSummaryStats, DEFAULT_HIPDATA_CODES, DEFAULT_HIPDATA_SQL_LIST } from './dataService.js';
import { processCrossCheck } from './crossCheckLogic.js';
import { isReadOnlySql, hasMultipleStatements, replaceGrafanaMacros } from './queryUtils.js';
import { isValidDateString, isValidTimeString, normalizeChannels, normalizeReportTypes } from './validation.js';
import { writeAuditLog } from './auditLog.js';
import { getMappingFields, inferExcelMapping, getMissingRequiredFields, normalizeExcelRows } from './excelMapping.js';
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
app.use('/screenshots', express.static(path.join(__dirname, '../screenshots')));
app.use('/screenshots', express.static(path.join(__dirname, '../jobs/screenshots')));

let currentSyncStatus = {
    status: 'idle',
    step: '',
    message: '',
    qrCodeUrl: '',
    error: null,
    visitDate: null,
    startedAt: null
};

function checkSyncStatusTimeout() {
    if (currentSyncStatus.status === 'running' && currentSyncStatus.startedAt) {
        const diffMs = Date.now() - new Date(currentSyncStatus.startedAt).getTime();
        if (diffMs > 15 * 60 * 1000) { // 15 minutes timeout
            console.warn('⚠️ Sync process has timed out (exceeded 15 minutes). Resetting to idle.');
            currentSyncStatus = {
                status: 'failed',
                step: 'timeout',
                message: 'กระบวนการซิงก์ข้อมูลหมดเวลาการทำงาน (เกิน 15 นาที)',
                qrCodeUrl: '',
                error: 'Timeout',
                visitDate: null,
                startedAt: null
            };
        }
    }
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const RIGHT_CARD_DEFINITIONS = Object.freeze([
    { key: 'comptroller_general', label: 'เบิกจ่ายตรงกรมบัญชีกลาง', pttypeSppIds: [1] },
    { key: 'agency_reimburse', label: 'เบิกต้นสังกัด', pttypeSppIds: [11] },
    { key: 'local_government', label: 'เบิกจ่ายตรง อปท.', pttypeSppIds: [7] },
    { key: 'ucs_goldcard', label: 'บัตรทอง', pttypeSppIds: [3, 4] },
    { key: 'migrant', label: 'คนต่างด้าว', pttypeSppIds: [5, 8] },
    { key: 'stateless', label: 'ผู้มีปัญหาสถานะและสิทธิ', pttypeSppIds: [10] },
    { key: 'social_security', label: 'บัตรประกันสังคม', pttypeSppIds: [2] },
    { key: 'motor_insurance', label: 'พรบ.ผู้ประสบภัยจากรถ', pttypeSppIds: [9] },
    { key: 'self_pay', label: 'อื่นๆ (ชำระเงินเอง)', pttypeSppIds: [6] }
]);

function buildNumericSqlCondition(values) {
    const normalizedValues = values
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0);
    if (normalizedValues.length === 0) {
        throw new Error('Right card pttype_spp_id mapping is empty');
    }
    if (normalizedValues.length === 1) return `= ${normalizedValues[0]}`;
    return `IN (${normalizedValues.join(', ')})`;
}

function buildRightCardCountColumn(definition) {
    if (!/^[a-z0-9_]+$/i.test(definition.key)) {
        throw new Error(`Invalid right card key: ${definition.key}`);
    }
    return `COUNT(DISTINCT CASE WHEN py.pttype_spp_id ${buildNumericSqlCondition(definition.pttypeSppIds)} THEN v.hn ELSE NULL END) AS ${definition.key}`;
}

function isLoginRateLimited(key) {
    const now = Date.now();
    const current = loginAttempts.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    if (now > current.resetAt) {
        loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return false;
    }
    current.count += 1;
    loginAttempts.set(key, current);
    return current.count > LOGIN_MAX_ATTEMPTS;
}

function resetLoginAttempts(key) {
    loginAttempts.delete(key);
}

async function createSyncRun(source, visitDate, username, req = null) {
    try {
        const [result] = await trackerPool.query(
            'INSERT INTO sync_runs (source, visit_date, username, status) VALUES (?, ?, ?, "running")',
            [source, visitDate, username || null]
        );
        await writeAuditLog(req, 'sync_started', 'sync_run', result.insertId, { source, visitDate });
        return result.insertId;
    } catch (error) {
        console.error('❌ Failed to create sync run audit:', error.message);
        return null;
    }
}

async function finishSyncRun(id, status, totalRecords, message, error = null, req = null) {
    if (!id) return;
    try {
        await trackerPool.query(
            'UPDATE sync_runs SET status = ?, total_records = ?, message = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, totalRecords || 0, message || null, error || null, id]
        );
        await writeAuditLog(req, `sync_${status}`, 'sync_run', id, { totalRecords: totalRecords || 0, message, error });
    } catch (dbError) {
        console.error('❌ Failed to update sync run audit:', dbError.message);
    }
}

app.get('/api/health', async (req, res) => {
    const health = {
        success: true,
        uptime: process.uptime(),
        backgroundJobs: process.env.ENABLE_SERVER_BACKGROUND_JOBS === 'true' ? 'server-enabled' : 'worker-only',
        database: {
            tracker: false,
            hosxp: false
        }
    };

    try {
        await trackerPool.query('SELECT 1');
        health.database.tracker = true;
    } catch (error) {
        health.success = false;
        health.trackerError = error.message;
    }

    try {
        await hosxpPool.query('SELECT 1');
        health.database.hosxp = true;
    } catch (error) {
        health.success = false;
        health.hosxpError = error.message;
    }

    res.status(health.success ? 200 : 503).json(health);
});

// Check DB Connections and Init Table
checkConnections().then(() => {
    initInternalDb();
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' });
    const rateLimitKey = `${req.ip}:${username}`;
    if (isLoginRateLimited(rateLimitKey)) {
        return res.status(429).json({ message: 'พยายามเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' });
    }
    const result = await verifyUserLogin(username, password);
    if (result.success) {
        resetLoginAttempts(rateLimitKey);
        await writeAuditLog({ user: result.user, ip: req.ip, headers: req.headers }, 'login_success', 'session', username, { role: result.user?.role });
        return res.json(result);
    }
    res.status(401).json({ message: result.message });
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
        const todayDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
        // Query data stats
        const [[{ total_visits }]] = await hosxpPool.query(
            'SELECT COUNT(DISTINCT vn) as total_visits FROM vn_stat WHERE vstdate = ?',
            [todayDate]
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
                                        "text": "จำนวนผู้มารับบริการวันนี้(ครั้ง)",
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

        const headers = Object.keys(excelData[0] || {});
        const mapping = inferExcelMapping(headers);
        const missingRequired = getMissingRequiredFields(mapping);

        const dateCounts = {};
        let mostFrequentDate = null;
        let maxCount = 0;

        const mappedData = normalizeExcelRows(excelData, mapping);
        mappedData.forEach(row => {
            let dateStr = row.visitDate || row['วันที่เข้ารับบริการ'] || row['dateser'];
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
            detected_date: mostFrequentDate,
            headers,
            mapping,
            mappingFields: getMappingFields(),
            missingRequired
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
    let syncRunId = null;
    try {
        const { visit_date } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });
        if (!isValidDateString(visit_date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        if (!req.file) return res.status(400).json({ message: 'กรุณาอัปโหลดไฟล์ Excel' });
        syncRunId = await createSyncRun('excel-upload', visit_date, req.user.username, req);

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
            raw: false, 
            dateNF: 'yyyy-mm-dd hh:mm:ss' 
        });
        const headers = Object.keys(excelData[0] || {});
        let requestedMapping = {};
        if (req.body.excel_mapping) {
            try {
                requestedMapping = JSON.parse(req.body.excel_mapping);
            } catch {
                return res.status(400).json({ message: 'รูปแบบ Excel mapping ไม่ถูกต้อง' });
            }
        }
        const mapping = { ...inferExcelMapping(headers), ...requestedMapping };
        const missingRequired = getMissingRequiredFields(mapping);
        if (missingRequired.length > 0) {
            await finishSyncRun(syncRunId, 'failed', 0, 'Excel mapping required', `Missing mapping: ${missingRequired.map(f => f.label).join(', ')}`, req);
            return res.status(422).json({
                message: 'กรุณาจับคู่คอลัมน์ Excel ให้ครบก่อนประมวลผล',
                headers,
                mapping,
                mappingFields: getMappingFields(),
                missingRequired
            });
        }
        const mappedExcelData = normalizeExcelRows(excelData, mapping);

        await saveAuthenLog(mappedExcelData, visit_date);
        await executeAdvancedRunLogic(visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            await finishSyncRun(syncRunId, 'success', 0, 'Excel upload saved but no HOSxP visits found', null, req);
            return res.status(404).json({ message: 'บันทึก Log และประมวลผลระบบสำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, mappedExcelData);
        await saveTrackingResults(processedData);
        await finishSyncRun(syncRunId, 'success', processedData.length, 'Excel upload sync completed', null, req);

        // (Auto-capture disabled in favor of frontend pop-up selection)

        res.json({
            success: true,
            message: `ประมวลผลเสร็จสิ้น ${processedData.length} รายการ และอัปเดตข้อมูลสำเร็จ`,
            data: processedData,
            mapping
        });

    } catch (error) {
        console.error('Processing Error:', error);
        await finishSyncRun(syncRunId, 'failed', 0, 'Excel upload sync failed', error.message, req);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการประมวลผลข้อมูล' });
    }
});

/**
 * Endpoint สำหรับดึงข้อมูล HOSxP และ Cross-check กับข้อมูล JSON (จาก Clipboard)
 */
app.post('/api/sync/process-json', authenticateToken, async (req, res) => {
    let syncRunId = null;
    try {
        const { visit_date, data } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });
        if (!isValidDateString(visit_date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        if (!data || !Array.isArray(data)) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
        syncRunId = await createSyncRun('clipboard-json', visit_date, req.user.username, req);

        const excelData = data; // ใช้ข้อมูลจาก JSON ที่ส่งมาโดยตรง

        await saveAuthenLog(excelData, visit_date);
        await executeAdvancedRunLogic(visit_date);
        const hosxpData = await getHosxpVisits(visit_date);

        if (hosxpData.length === 0) {
            await finishSyncRun(syncRunId, 'success', 0, 'Clipboard data saved but no HOSxP visits found', null, req);
            return res.status(404).json({ message: 'บันทึก Log และประมวลผลระบบสำเร็จ แต่ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        await finishSyncRun(syncRunId, 'success', processedData.length, 'Clipboard sync completed', null, req);

        // (Auto-capture disabled in favor of frontend pop-up selection)

        res.json({
            success: true,
            message: `ประมวลผล (Paste) เสร็จสิ้น ${processedData.length} รายการ`,
            data: processedData
        });

    } catch (error) {
        console.error('JSON Processing Error:', error);
        await finishSyncRun(syncRunId, 'failed', 0, 'Clipboard sync failed', error.message, req);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการประมวลผลข้อมูลจาก Clipboard' });
    }
});

/**
 * Endpoint สำหรับดึงข้อมูลจาก NHSO API โดยตรง (Direct API Automation)
 */
app.post('/api/sync/nhso-direct-api', authenticateToken, async (req, res) => {
    let syncRunId = null;
    try {
        const { visit_date } = req.body;
        if (!visit_date) return res.status(400).json({ message: 'กรุณาระบุวันที่ (visit_date)' });
        if (!isValidDateString(visit_date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        syncRunId = await createSyncRun('nhso-direct-api', visit_date, req.user.username, req);

        const hosxpData = await getHosxpVisits(visit_date);
        if (hosxpData.length === 0) {
            await finishSyncRun(syncRunId, 'success', 0, 'No HOSxP visits found before NHSO API sync', null, req);
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ป่วยใน HOSxP สำหรับวันที่ระบุ' });
        }

        const bearerToken = process.env.NHSO_BEARER_TOKEN;
        const serviceCode = process.env.NHSO_SERVICE_CODE;

        if (!bearerToken || bearerToken === 'YOUR_BEARER_TOKEN_HERE') {
            await finishSyncRun(syncRunId, 'failed', 0, 'NHSO bearer token is not configured', 'Missing NHSO_BEARER_TOKEN', req);
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
            await finishSyncRun(syncRunId, 'success', processedData.length, `NHSO API found ${apiResults.length} records`, null, req);
            
            res.json({
                success: true,
                message: `ดึงข้อมูลจาก NHSO API สำเร็จ ${apiResults.length} จาก ${hosxpData.length} รายการ`,
                data: processedData
            });
        } else {
            await finishSyncRun(syncRunId, 'success', 0, `NHSO API connected but found no Authen Code for ${hosxpData.length} patients`, null, req);
            res.json({
                success: true,
                message: `เชื่อมต่อ API สำเร็จ แต่ไม่พบข้อมูล Authen Code ในระบบ สปสช. (${hosxpData.length} ราย)`,
                data: []
            });
        }

    } catch (error) {
        console.error('Direct API Sync Error:', error);
        await finishSyncRun(syncRunId, 'failed', 0, 'NHSO direct API sync failed', error.message, req);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ NHSO API' });
    }
});

async function getUserNotificationCredentials(username) {
    if (!username) return null;
    const [userRows] = await trackerPool.query(
        'SELECT line_token, line_group_id, telegram_token, telegram_chat_id FROM users WHERE username = ?',
        [username]
    );
    if (userRows.length === 0) {
        console.warn(`⚠️ User ${username} not found in internal DB. Falling back to system credentials from .env.`);
        return null;
    }

    const user = userRows[0];
    const hasLine = user.line_token && user.line_group_id;
    const hasTelegram = user.telegram_token && user.telegram_chat_id;
    if (!hasLine && !hasTelegram) {
        console.warn(`⚠️ User ${username} has no notification channels configured in their profile. Falling back to system credentials from .env.`);
        return null;
    }

    console.log(`📲 Using personal notification credentials for user: ${username} (LINE: ${hasLine ? 'yes' : 'no'}, Telegram: ${hasTelegram ? 'yes' : 'no'})`);
    return {
        line_token: user.line_token || null,
        line_group_id: user.line_group_id || null,
        telegram_token: user.telegram_token || null,
        telegram_chat_id: user.telegram_chat_id || null
    };
}

/**
 * Endpoint สำหรับสั่งบันทึกหน้าจอ Grafana ด้วยตนเอง (Manual Trigger)
 */
app.post('/api/sync/capture-grafana', authenticateToken, async (req, res) => {
    try {
        const { visit_date, channels, report_types } = req.body;
        if (visit_date && !isValidDateString(visit_date)) return res.status(400).json({ success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        const normalizedChannels = normalizeChannels(channels);
        const normalizedReportTypes = normalizeReportTypes(report_types);
        const username = req.user.username;
        console.log(`📸 [Manual Trigger] Grafana Capture requested by user: ${username} for date: ${visit_date || 'today'}`);

        const userCredentials = await getUserNotificationCredentials(username);

        const result = await captureAndNotify(visit_date, normalizedChannels, normalizedReportTypes, userCredentials);
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
        if (!isValidDateString(visit_date)) return res.status(400).json({ success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        console.log(`📥 [Manual Trigger] NHSO Portal Download requested for date: ${visit_date} by user: ${req.user.username}`);

        // Check if there is already an active run, using timeout check first
        checkSyncStatusTimeout();
        if (currentSyncStatus.status === 'running') {
            return res.status(409).json({
                success: false,
                message: 'มีกระบวนการดาวน์โหลดและประมวลผลข้อมูลกำลังทำงานอยู่ในเบื้องหลังในขณะนี้ กรุณารอให้ระบบทำงานเสร็จก่อน'
            });
        }

        // Initialize state to running
        currentSyncStatus = {
            status: 'running',
            step: 'starting_browser',
            message: 'กำลังเริ่มต้นรันบราวเซอร์เพื่อล็อกอิน สปสช....',
            qrCodeUrl: '',
            error: null,
            visitDate: visit_date,
            startedAt: new Date()
        };

        const userCredentials = await getUserNotificationCredentials(req.user.username);

        // Run the sync process in the background to prevent HTTP connection timeouts
        runManualPortalSyncInBackground(visit_date, req.user.username, userCredentials).catch(err => {
            console.error('❌ Error in manual portal background sync:', err);
            currentSyncStatus.status = 'failed';
            currentSyncStatus.step = 'failed';
            currentSyncStatus.message = `เกิดข้อผิดพลาดในการรันระบบเบื้องหลัง: ${err.message}`;
            currentSyncStatus.error = err.message;
        });

        res.json({
            success: true,
            message: 'เริ่มต้นดาวน์โหลดข้อมูลผ่านบอทเรียบร้อยแล้ว'
        });

    } catch (error) {
        console.error('Manual Portal Download Sync Trigger Error:', error);
        res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการประมวลผล: ${error.message}` });
    }
});

/**
 * Endpoint สำหรับดึงสถานะความคืบหน้าการซิงก์ข้อมูล
 */
app.get('/api/sync/status', authenticateToken, (req, res) => {
    checkSyncStatusTimeout();
    res.json(currentSyncStatus);
});

async function runManualPortalSyncInBackground(visit_date, username = null, userCredentials = null) {
    console.log(`📥 [Background Portal Sync] Starting for date: ${visit_date}`);
    const syncRunId = await createSyncRun('nhso-portal', visit_date, username);
    await sendTelegramStatusMessage(`⏳ [Manual Sync] เริ่มต้นดาวน์โหลดข้อมูลและขอ QR Code สแกนผ่านแอป ThaiD ประจำวันที่ ${visit_date}...`, userCredentials);
    await sendLineStatusMessage(`⏳ [Manual Sync] เริ่มต้นดาวน์โหลดข้อมูลและขอ QR Code สแกนผ่านแอป ThaiD ประจำวันที่ ${visit_date}...`, userCredentials);
    
    try {
        const dlResult = await downloadNhsoReport((step, message, extra = null) => {
            currentSyncStatus.step = step;
            currentSyncStatus.message = message;
            if (step === 'waiting_thaid_scan' && extra) {
                currentSyncStatus.qrCodeUrl = extra;
            }
        });
        
        if (!dlResult.success || !dlResult.filePath) {
            console.error(`❌ [Background Portal Sync] Download failed: ${dlResult.error}`);
            
            currentSyncStatus.status = 'failed';
            currentSyncStatus.step = 'failed';
            currentSyncStatus.message = `ดาวน์โหลดรายงานไม่สำเร็จ: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`;
            currentSyncStatus.error = dlResult.error;

            await sendTelegramStatusMessage(`❌ ไม่สามารถดึงรายงานอัตโนมัติของวันที่ ${visit_date} ได้: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`, userCredentials);
            await sendLineStatusMessage(`❌ [Manual Sync] ไม่สามารถดึงรายงานอัตโนมัติของวันที่ ${visit_date} ได้: ${dlResult.error || 'ข้อผิดพลาดบราวเซอร์'}`, userCredentials);
            await finishSyncRun(syncRunId, 'failed', 0, 'NHSO portal download failed', dlResult.error || 'Download failed');
            return;
        }

        console.log(`📥 [Background Portal Sync] Reading downloaded file: ${dlResult.filePath}`);
        currentSyncStatus.step = 'importing_database';
        currentSyncStatus.message = 'ดาวน์โหลดรายงานสำเร็จ กำลังอ่านไฟล์และนำเข้าข้อมูลดิบลงตาราง HOSxP...';

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
        
        currentSyncStatus.step = 'cross_checking';
        currentSyncStatus.message = 'นำเข้าข้อมูลดิบสำเร็จ กำลังประมวลผลจับคู่เปรียบเทียบสิทธิ์...';

        const hosxpData = await getHosxpVisits(visit_date);
        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        await finishSyncRun(syncRunId, 'success', processedData.length, 'NHSO portal sync completed');
        
        console.log('✅ [Background Portal Sync] Database sync completed.');
        currentSyncStatus.status = 'success';
        currentSyncStatus.step = 'completed';
        currentSyncStatus.message = `การซิงก์และประมวลผลข้อมูลเปรียบเทียบประจำวันที่ ${visit_date} สำเร็จเสร็จสิ้นแล้ว!`;

        // Keep only the latest Excel download as backup
        cleanOldDownloads(path.join(__dirname, '../downloads'));

        // แจ้งเตือนใน Telegram & LINE
        await sendTelegramStatusMessage(`✅ ระบบดึงรายงานและประมวลผล Sync ประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังบันทึกภาพหน้าจอ Grafana...`, userCredentials);
        await sendLineStatusMessage(`✅ ระบบดึงรายงานและประมวลผล Sync ประจำวันที่ ${visit_date} สำเร็จแล้ว! กำลังบันทึกภาพหน้าจอ Grafana...`, userCredentials);

        // Capture Grafana and send Telegram/LINE in the background
        captureAndNotify(visit_date, ['line', 'telegram'], ['summary', 'screenshot'], userCredentials).catch(err => console.error('❌ Error capturing Grafana after portal sync:', err));

    } catch (err) {
        console.error('❌ [Background Portal Sync] Crash error:', err);
        currentSyncStatus.status = 'failed';
        currentSyncStatus.step = 'failed';
        currentSyncStatus.message = `การซิงก์ขัดข้อง: ${err.message}`;
        currentSyncStatus.error = err.message;
        await sendTelegramStatusMessage(`❌ การซิงก์ขัดข้อง: ${err.message}`, userCredentials);
        await sendLineStatusMessage(`❌ การซิงก์ขัดข้อง: ${err.message}`, userCredentials);
        await finishSyncRun(syncRunId, 'failed', 0, 'NHSO portal sync crashed', err.message);
    }
}

app.get('/api/tracking/dashboard', authenticateToken, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
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
            disableNotifications: process.env.DISABLE_NOTIFICATIONS === 'true',
            generated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('Dashboard Fetch Error:', error);
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Dashboard ได้' });
    }
});

app.get('/api/tracking/rights-table', authenticateToken, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const date = req.query.date || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
        if (!isValidDateString(date)) {
            return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        }

        const [rows] = await hosxpPool.query(
            `SELECT
                IF(ov.an IS NULL, v.vn, 'Admit') AS vn,
                CONCAT('cid_', v.cid) AS cid_check,
                v.cid,
                vp.pttype,
                py.hipdata_code AS pcode,
                vp.Auth_Code AS authCode,
                vp.claim_code,
                td.claimcode AS nhso_claim_code,
                td.authen_code_type,
                vp.pttype_note,
                vp.staff,
                CASE
                    WHEN td.claimcode IS NULL THEN 'ยังไม่ได้นำเข้า'
                    WHEN NULLIF(TRIM(vp.Auth_Code), '') IS NULL THEN 'ยังไม่เปิด Authen'
                    WHEN (SELECT COUNT(cid) FROM vn_stat WHERE vstdate = v.vstdate AND cid = v.cid) > 1 THEN 'ตรวจสอบ'
                    WHEN vp.claim_code = td.claimcode THEN 'ตรง'
                    ELSE 'ไม่ตรง'
                END AS check_claimcode,
                v.uc_money,
                CAST(CONVERT(k.department USING utf8) AS CHAR) AS department,
                COUNT(DISTINCT v.cid) AS cc_cid
             FROM vn_stat v
             LEFT OUTER JOIN visit_pttype vp ON vp.vn = v.vn
             LEFT OUTER JOIN temp_authen_code td ON td.cid = v.cid
                AND td.status_use <> 'C'
                AND td.dateser = v.vstdate
                AND td.flag = 'D'
             LEFT OUTER JOIN pttype py ON py.pttype = v.pttype
             LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
             LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
             WHERE v.vstdate = ?
             GROUP BY v.vn
             ORDER BY py.hipdata_code, vp.Auth_Code, vp.claim_code`,
            [date]
        );

        res.json({
            success: true,
            visit_date: date,
            count: rows.length,
            rows,
            generated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('Rights Tracking Table Fetch Error:', error);
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูลตารางทุกสิทธิได้' });
    }
});

app.get('/api/tracking/group-insights', authenticateToken, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        const { date, group_by = 'department', hipdata_code } = req.query;
        if (!date) return res.status(400).json({ message: 'กรุณาระบุ date' });
        if (!isValidDateString(date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        const hipdataCodes = String(hipdata_code || DEFAULT_HIPDATA_SQL_LIST)
            .split(',')
            .map(code => code.trim().replace(/^['"]|['"]$/g, '').toUpperCase())
            .filter(code => /^[A-Z0-9_-]+$/.test(code));
        const safeHipdataCodes = hipdataCodes.length > 0 ? hipdataCodes : DEFAULT_HIPDATA_CODES;
        const groupColumns = {
            department: {
                expression: "COALESCE(NULLIF(TRIM(department), ''), 'ไม่ระบุแผนก')",
                label: 'แผนก'
            },
            subdistrict: {
                expression: "COALESCE(NULLIF(TRIM(subdistrict_name), ''), 'ไม่ระบุตำบล')",
                label: 'ตำบล'
            }
        };
        const groupConfig = groupColumns[group_by] || groupColumns.department;

        let ucPendingByDepartment = [];
        try {
            const hosxpGroupColumns = {
                department: "COALESCE(NULLIF(TRIM(CONVERT(k.department USING utf8)), ''), 'ไม่ระบุแผนก')",
                subdistrict: "COALESCE(NULLIF(TRIM(CONVERT(t.name USING utf8)), ''), 'ไม่ระบุตำบล')"
            };
            const hosxpGroupExpression = hosxpGroupColumns[group_by] || hosxpGroupColumns.department;
            [ucPendingByDepartment] = await hosxpPool.query(
                `SELECT
                    ${hosxpGroupExpression} AS group_key,
                    ${hosxpGroupExpression} AS group_label,
                    COUNT(DISTINCT v.vn) AS count,
                    COALESCE(SUM(v.uc_money), 0) AS total_money,
                    COUNT(DISTINCT CASE WHEN td.claimcode IS NULL THEN v.vn ELSE NULL END) AS red_count,
                    COUNT(DISTINCT CASE WHEN td.claimcode IS NOT NULL THEN v.vn ELSE NULL END) AS yellow_count
                 FROM vn_stat v
                 LEFT JOIN ovst ov ON ov.vn = v.vn
                 LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
                 LEFT JOIN patient p ON p.hn = v.hn
                 LEFT JOIN thaiaddress t ON t.chwpart = p.chwpart
                    AND t.amppart = p.amppart
                    AND t.tmbpart = p.tmbpart
                 LEFT JOIN temp_authen_code td ON td.cid = v.cid
                    AND td.status_use <> 'C'
                    AND td.dateser = v.vstdate
                    AND td.flag = 'D'
                 LEFT JOIN pttype py ON py.pttype = v.pttype
                 WHERE v.vstdate = ?
                   AND UPPER(py.hipdata_code) = 'UCS'
                   AND COALESCE(ov.pt_subtype, '') <> '1'
                   AND ov.an IS NULL
                   AND (td.claimcode IS NULL OR td.authen_code_type IS NULL OR UPPER(td.authen_code_type) NOT IN ('EP', 'ENDPOINT'))
                 GROUP BY group_key
                 ORDER BY count DESC, total_money DESC
                 LIMIT 10`,
                [date]
            );
        } catch (hosxpError) {
            console.warn('HOSxP UC pending department summary unavailable:', hosxpError.message);
            [ucPendingByDepartment] = await trackerPool.query(
                `SELECT
                    ${groupConfig.expression} AS group_key,
                    ${groupConfig.expression} AS group_label,
                    COUNT(*) AS count,
                    COALESCE(SUM(uc_money), 0) AS total_money,
                    SUM(color_status = 'RED') AS red_count,
                    SUM(color_status = 'YELLOW') AS yellow_count
                 FROM visit_tracking
                 WHERE visit_date = ?
                   AND UPPER(COALESCE(pcode, '')) = 'UC'
                   AND color_status IN ('RED', 'YELLOW')
                 GROUP BY group_key
                 ORDER BY count DESC, total_money DESC
                 LIMIT 10`,
                [date]
            );
        }

        const [ucDebtorByDepartment] = await trackerPool.query(
            `SELECT
                ${groupConfig.expression} AS group_key,
                ${groupConfig.expression} AS group_label,
                COUNT(*) AS count,
                COALESCE(SUM(uc_money), 0) AS total_money,
                SUM(color_status = 'RED') AS red_count,
                SUM(color_status = 'YELLOW') AS yellow_count,
                SUM(color_status = 'GREEN') AS green_count
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'
               AND COALESCE(uc_money, 0) > 0
             GROUP BY group_key
             ORDER BY total_money DESC, count DESC
             LIMIT 10`,
            [date]
        );

        const [[pendingTotal]] = await trackerPool.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'
               AND color_status IN ('RED', 'YELLOW')`,
            [date]
        );

        const [[debtorTotal]] = await trackerPool.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'
               AND COALESCE(uc_money, 0) > 0`,
            [date]
        );

        const [[ucTotal]] = await trackerPool.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'`,
            [date]
        );

        const [[trackerServiceTotal]] = await trackerPool.query(
            `SELECT COUNT(*) AS count
             FROM visit_tracking
             WHERE visit_date = ?`,
            [date]
        );
        let serviceTotal = {
            count: Number(trackerServiceTotal?.count || 0),
            source: 'visit_tracking'
        };
        let serviceByGroup = [];
        try {
            const hosxpServiceGroupColumns = {
                department: "COALESCE(NULLIF(TRIM(CONVERT(k.department USING utf8)), ''), 'ไม่ระบุแผนก')",
                subdistrict: "COALESCE(NULLIF(TRIM(CONVERT(t.name USING utf8)), ''), 'ไม่ระบุตำบล')"
            };
            const hosxpServiceGroupExpression = hosxpServiceGroupColumns[group_by] || hosxpServiceGroupColumns.department;
            const [[hosxpServiceTotal]] = await hosxpPool.query(
                `SELECT COUNT(DISTINCT v.vn) AS count
                 FROM vn_stat v
                 WHERE v.vstdate = ?`,
                [date]
            );
            serviceTotal = {
                count: Number(hosxpServiceTotal?.count || 0),
                source: 'hosxp_vn_stat'
            };
            [serviceByGroup] = await hosxpPool.query(
                `SELECT
                    ${hosxpServiceGroupExpression} AS group_key,
                    ${hosxpServiceGroupExpression} AS group_label,
                    COUNT(DISTINCT v.vn) AS count
                 FROM vn_stat v
                 LEFT JOIN ovst ov ON ov.vn = v.vn
                 LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
                 LEFT JOIN patient p ON p.hn = v.hn
                 LEFT JOIN thaiaddress t ON t.chwpart = p.chwpart
                    AND t.amppart = p.amppart
                    AND t.tmbpart = p.tmbpart
                 WHERE v.vstdate = ?
                 GROUP BY group_key
                 ORDER BY count DESC
                 LIMIT 10`,
                [date]
            );
        } catch (hosxpError) {
            console.warn('HOSxP service total unavailable:', hosxpError.message);
            [serviceByGroup] = await trackerPool.query(
                `SELECT
                    ${groupConfig.expression} AS group_key,
                    ${groupConfig.expression} AS group_label,
                    COUNT(*) AS count
                 FROM visit_tracking
                 WHERE visit_date = ?
                 GROUP BY group_key
                 ORDER BY count DESC
                 LIMIT 10`,
                [date]
            );
        }

        let notImportedTotal = null;
        try {
            const hipdataPlaceholders = safeHipdataCodes.map(() => '?').join(',');
            const [[hosxpNotImportedTotal]] = await hosxpPool.query(
                `SELECT COUNT(DISTINCT v.vn) AS count, COALESCE(SUM(v.uc_money), 0) AS total_money
                 FROM vn_stat v
                 LEFT JOIN ovst ov ON ov.vn = v.vn
                 LEFT JOIN pttype py ON py.pttype = v.pttype
                 LEFT JOIN temp_authen_code td ON td.cid = v.cid
                    AND td.status_use <> 'C'
                    AND td.dateser = v.vstdate
                    AND td.flag = 'D'
                 WHERE v.vstdate = ?
                   AND UPPER(py.hipdata_code) IN (${hipdataPlaceholders})
                   AND COALESCE(ov.pt_subtype, '') <> '1'
                   AND ov.an IS NULL
                   AND td.claimcode IS NULL`,
                [date, ...safeHipdataCodes]
            );
            notImportedTotal = {
                count: Number(hosxpNotImportedTotal?.count || 0),
                total_money: Number(hosxpNotImportedTotal?.total_money || 0),
                source: 'hosxp_temp_authen_code',
                count_type: 'distinct_vn',
                hipdata_codes: safeHipdataCodes,
                condition: 'missing_temp_authen_claimcode'
            };
        } catch (hosxpError) {
            console.warn('HOSxP temp authencode not-imported summary unavailable:', hosxpError.message);
        }
        if (!notImportedTotal) {
            [[notImportedTotal]] = await trackerPool.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'
               AND color_status = 'RED'`,
                [date]
            );
        }

        const [ucPendingByRight] = await trackerPool.query(
            `SELECT
                COALESCE(NULLIF(TRIM(pttype_note), ''), NULLIF(TRIM(pttype), ''), 'ไม่ระบุสิทธิ') AS right_name,
                COUNT(*) AS count,
                COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND UPPER(COALESCE(pcode, '')) = 'UC'
               AND color_status IN ('RED', 'YELLOW')
             GROUP BY right_name
             ORDER BY count DESC, total_money DESC
             LIMIT 9`,
            [date]
        );

        let debtorBySpp = [];
        let hosxpDebtorTotal = null;
        try {
            const rightCardCountColumns = RIGHT_CARD_DEFINITIONS
                .map(buildRightCardCountColumn)
                .join(',\n                    ');
            const [sppRows] = await hosxpPool.query(
                `SELECT
                    ${rightCardCountColumns}
                 FROM vn_stat v
                 LEFT JOIN ovst ov ON ov.vn = v.vn
                 LEFT JOIN pttype py ON py.pttype = v.pttype
                 WHERE v.vstdate = ?
                   AND COALESCE(ov.pt_subtype, '') <> '1'
                   AND ov.an IS NULL`,
                [date]
            );
            const [[hosxpDebtorSummary]] = await hosxpPool.query(
                `SELECT
                    COUNT(DISTINCT CASE WHEN UPPER(py.hipdata_code) = 'UCS' THEN v.vn ELSE NULL END) AS count,
                    COALESCE(SUM(CASE WHEN UPPER(py.hipdata_code) = 'UCS' THEN v.uc_money ELSE 0 END), 0) AS total_money
                 FROM vn_stat v
                 LEFT JOIN ovst ov ON ov.vn = v.vn
                 LEFT JOIN temp_authen_code td ON td.cid = v.cid
                    AND td.status_use <> 'C'
                    AND td.dateser = v.vstdate
                    AND td.flag = 'D'
                 LEFT JOIN pttype py ON py.pttype = v.pttype
                 WHERE v.vstdate = ?
                   AND COALESCE(ov.pt_subtype, '') <> '1'
                   AND ov.an IS NULL
                   AND (td.claimcode IS NULL OR td.authen_code_type IS NULL OR UPPER(td.authen_code_type) NOT IN ('EP', 'ENDPOINT'))`,
                [date]
            );
            const sppSummary = sppRows[0] || {};
            debtorBySpp = RIGHT_CARD_DEFINITIONS.map(definition => ({
                key: definition.key,
                right_name: definition.label,
                count: Number(sppSummary[definition.key] || 0),
                total_money: 0,
                count_type: 'distinct_hn',
                source: 'hosxp_vn_stat',
                group_by: 'pttype_spp_id',
                pttype_spp_ids: definition.pttypeSppIds
            }));
            hosxpDebtorTotal = {
                count: Number(hosxpDebtorSummary?.count || 0),
                total_money: Number(hosxpDebtorSummary?.total_money || 0),
                source: 'hosxp_vn_stat',
                count_type: 'distinct_vn',
                hipdata_codes: ['UCS']
            };
        } catch (hosxpError) {
            console.warn('HOSxP debtor SPP summary unavailable:', hosxpError.message);
        }

        res.json({
            success: true,
            visit_date: date,
            generated_at: new Date().toISOString(),
            group_by: groupColumns[group_by] ? group_by : 'department',
            group_label: groupConfig.label,
            totals: {
                ucPending: pendingTotal,
                ucDebtor: hosxpDebtorTotal || debtorTotal,
                serviceTotal,
                ucTotal,
                notImported: notImportedTotal
            },
            ucPendingByRight,
            debtorBySpp,
            serviceByGroup,
            ucPendingByDepartment,
            ucDebtorByDepartment
        });
    } catch (error) {
        console.error('Group insights fetch error:', error);
        res.status(500).json({ message: 'ไม่สามารถดึงข้อมูลกลุ่มสรุปได้' });
    }
});

app.get('/api/hipdata', authenticateToken, async (req, res) => {
    try {
        const [rows] = await hosxpPool.query(
            `SELECT
                UPPER(TRIM(hipdata_code)) AS code,
                COUNT(*) AS pttype_count
             FROM pttype
             WHERE hipdata_code IS NOT NULL
               AND TRIM(hipdata_code) <> ''
             GROUP BY code
             ORDER BY code ASC`
        );
        const codes = rows
            .map(row => String(row.code || '').trim().toUpperCase())
            .filter(code => /^[A-Z0-9_-]+$/.test(code));
        const selectedCodes = codes.length > 0 ? codes : DEFAULT_HIPDATA_CODES;
        res.json({
            success: true,
            codes,
            selected_codes: selectedCodes,
            sql_list: selectedCodes.map(code => `'${code}'`).join(','),
            rows
        });
    } catch (error) {
        console.error('Hipdata fetch error:', error);
        res.json({
            success: true,
            fallback: true,
            codes: DEFAULT_HIPDATA_CODES,
            selected_codes: DEFAULT_HIPDATA_CODES,
            sql_list: DEFAULT_HIPDATA_SQL_LIST,
            rows: DEFAULT_HIPDATA_CODES.map(code => ({ code, pttype_count: 0 }))
        });
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

// 1. Endpoint รันคำสั่ง SQL Query
app.post('/api/custom-query', authenticateToken, async (req, res) => {
    try {
        const { query, db_type, visit_date, hipdata_code } = req.body;
        if (!query) return res.status(400).json({ message: 'กรุณาระบุคำสั่ง SQL Query' });
        if (visit_date && !isValidDateString(visit_date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD' });
        if (db_type && !['hosxp', 'tracker'].includes(db_type)) return res.status(400).json({ message: 'db_type ไม่ถูกต้อง' });
        if (hasMultipleStatements(query)) return res.status(400).json({ message: 'ไม่อนุญาตให้รันหลาย SQL statement ในครั้งเดียว' });

        // ตรวจสอบความปลอดภัยเบื้องต้น
        const isReadQuery = isReadOnlySql(query);

        if (!isReadQuery && (process.env.ALLOW_MUTATING_CUSTOM_QUERY !== 'true' || req.user.role !== 'admin')) {
            return res.status(403).json({ 
                message: 'Forbidden: SQL Panel เปิดให้อ่านข้อมูลเท่านั้น หากต้องการรันคำสั่งแก้ข้อมูลต้องเป็น admin และตั้งค่า ALLOW_MUTATING_CUSTOM_QUERY=true ชั่วคราว'
            });
        }

        // แปลง Grafana Macros
        const processedQuery = replaceGrafanaMacros(query, visit_date, hipdata_code || DEFAULT_HIPDATA_SQL_LIST);
        console.log(`[SQL Query] DB: ${db_type || 'hosxp'} | User: ${req.user.username} | Role: ${req.user.role}`);

        const pool = db_type === 'tracker' ? trackerPool : hosxpPool;
        const startTime = Date.now();
        const [rows] = await pool.query(processedQuery);
        const executionTimeMs = Date.now() - startTime;
        const rowsCount = Array.isArray(rows) ? rows.length : 0;

        await trackerPool.query(
            `INSERT INTO query_history (username, db_type, query_text, visit_date, hipdata_code, rows_count, execution_time_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.username || null, db_type || 'hosxp', query, visit_date || null, hipdata_code || null, rowsCount, executionTimeMs]
        );
        await writeAuditLog(req, 'custom_query_run', 'sql_query', null, {
            dbType: db_type || 'hosxp',
            readOnly: isReadQuery,
            rows: rowsCount,
            executionTimeMs
        });

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

app.get('/api/query-history', authenticateToken, async (req, res) => {
    try {
        const [rows] = await trackerPool.query(
            `SELECT id, db_type, query_text, visit_date, hipdata_code, rows_count, execution_time_ms, created_at
             FROM query_history
             WHERE username = ?
             ORDER BY id DESC
             LIMIT 20`,
            [req.user.username || null]
        );
        res.json({ success: true, history: rows });
    } catch (error) {
        console.error('Query history fetch error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/query-history', authenticateToken, async (req, res) => {
    try {
        await trackerPool.query('DELETE FROM query_history WHERE username = ?', [req.user.username || null]);
        await writeAuditLog(req, 'query_history_clear', 'query_history', req.user.username || null);
        res.json({ success: true, message: 'ล้างประวัติคำสั่ง SQL สำเร็จ' });
    } catch (error) {
        console.error('Query history clear error:', error);
        res.status(500).json({ success: false, message: error.message });
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
        await writeAuditLog(req, 'saved_query_upsert', 'saved_query', name, { dbType: db_type || 'hosxp' });
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
        await writeAuditLog(req, 'saved_query_delete', 'saved_query', id);
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
        const [result] = await trackerPool.query(
            `INSERT INTO users (username, full_name, role, department, line_token, line_group_id, telegram_token, telegram_chat_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, full_name || '', role || 'user', department || '', line_token || null, line_group_id || null, telegram_token || null, telegram_chat_id || null]
        );
        await writeAuditLog(req, 'user_create', 'user', result.insertId, { username, role: role || 'user', department: department || '' });
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
        await writeAuditLog(req, 'user_update', 'user', id, { username, role: role || 'user', department: department || '' });
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
        await writeAuditLog(req, 'user_delete', 'user', id);
        res.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/sync-runs', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await trackerPool.query(
            'SELECT id, source, visit_date, status, username, total_records, message, error, started_at, finished_at FROM sync_runs ORDER BY id DESC LIMIT 100'
        );
        const [[summary]] = await trackerPool.query(`
            SELECT
                COUNT(*) AS total_runs,
                SUM(status = 'success') AS success_runs,
                SUM(status = 'failed') AS failed_runs,
                SUM(status = 'running') AS running_runs,
                COALESCE(SUM(total_records), 0) AS total_records
            FROM sync_runs
            WHERE started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);
        res.json({ success: true, runs: rows, summary });
    } catch (error) {
        console.error('Fetch sync runs error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await trackerPool.query(
            `SELECT id, username, role, action, entity_type, entity_id, details, ip_address, created_at
             FROM audit_logs
             ORDER BY id DESC
             LIMIT 200`
        );
        res.json({ success: true, logs: rows });
    } catch (error) {
        console.error('Fetch audit logs error:', error);
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
        if (!isValidTimeString(schedule_time)) return res.status(400).json({ success: false, message: 'รูปแบบเวลาไม่ถูกต้อง กรุณาใช้ HH:MM' });

        const timeWithSeconds = `${schedule_time}:00`;
        const [result] = await trackerPool.query('INSERT INTO cron_schedules (schedule_time, is_enabled) VALUES (?, 1)', [timeWithSeconds]);
        await writeAuditLog(req, 'schedule_create', 'cron_schedule', result.insertId, { schedule_time: timeWithSeconds });
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
            if (!isValidTimeString(schedule_time)) return res.status(400).json({ success: false, message: 'รูปแบบเวลาไม่ถูกต้อง กรุณาใช้ HH:MM' });
            const timeWithSeconds = `${schedule_time}:00`;
            await trackerPool.query('UPDATE cron_schedules SET schedule_time = ? WHERE id = ?', [timeWithSeconds, id]);
            await writeAuditLog(req, 'schedule_update_time', 'cron_schedule', id, { schedule_time: timeWithSeconds });
        }
        if (is_enabled !== undefined) {
            const enabledVal = is_enabled ? 1 : 0;
            await trackerPool.query('UPDATE cron_schedules SET is_enabled = ? WHERE id = ?', [enabledVal, id]);
            await writeAuditLog(req, 'schedule_toggle', 'cron_schedule', id, { is_enabled: !!is_enabled });
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
        await writeAuditLog(req, 'schedule_delete', 'cron_schedule', id);
        await reloadSchedules();
        res.json({ success: true, message: 'ลบเวลาทำงานสำเร็จ' });
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: `ไม่พบ API endpoint: ${req.method} ${req.originalUrl}`
    });
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
            cleanOldDownloads(path.join(__dirname, '../downloads'));

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
    if (process.env.ENABLE_SERVER_BACKGROUND_JOBS !== 'true') {
        console.log('ℹ️ [Scheduler] Server scheduler disabled; worker process owns background jobs.');
        return;
    }
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
    if (process.env.ENABLE_SERVER_BACKGROUND_JOBS === 'true') {
        startTelegramBotListener();
        reloadSchedules(); // Initial loading of database schedules
    } else {
        console.log('ℹ️ [Server] Background jobs are disabled here. Run "npm run worker" for scheduler, Telegram polling, and NHSO keep-alive.');
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
                console.warn(`⚠️ [Telegram Bot] Network connection/timeout while polling updates: ${details}. Retrying in 30s...`);
                setTimeout(poll, 30000);
            } else {
                console.error('❌ [Telegram Bot] Error polling Telegram updates:', error);
                setTimeout(poll, 10000);
            }
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

async function sendTelegramStatusMessage(text, userCredentials = null) {
    const token = userCredentials?.telegram_token || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = userCredentials?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || chatId === 'your_telegram_chat_id_here') return;

    const chatIds = String(chatId).split(',').map(id => id.trim()).filter(id => id);
    for (const id of chatIds) {
        await sendTelegramMessage(token, id, text);
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

async function sendLineStatusMessage(text, userCredentials = null) {
    const token = userCredentials?.line_token || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = userCredentials?.line_group_id || process.env.LINE_GROUP_ID;
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ LINE status message is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
    if (!token || !groupId || token === 'your_line_token_here' || groupId === 'your_group_id_here') {
        return;
    }
    try {
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                to: groupId,
                messages: [{ type: 'text', text }]
            })
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
            cleanOldDownloads(path.join(__dirname, '../downloads'));
            
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
