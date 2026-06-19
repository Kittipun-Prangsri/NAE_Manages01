import express from 'express';
import path from 'path';
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
