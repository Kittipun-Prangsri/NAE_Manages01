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

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionConfig = {
    host: process.env.HOSXP_HOST,
    user: process.env.HOSXP_USER,
    password: process.env.HOSXP_PASS,
    database: process.env.HOSXP_DB,
    port: parseInt(process.env.HOSXP_PORT || '3306', 10),
    connectTimeout: 2000 // fast timeout
};

async function testReplyPayload(queryDate) {
    console.log(`Starting reply simulation for date: ${queryDate}...`);
    
    let total_visits = 0;
    let total_money = 0;
    let endpoint_count = 0;
    let not_imported_count = 0;
    let authen_count = 0;
    let rights = [];
    let ucs_total = 0;
    let ucs_departments = [];
    let service_total_count = 0;
    let dbErrorOccurred = false;

    let connection;
    try {
        connection = await mysql.createConnection(connectionConfig);
        console.log('✅ Connected to HOSxP DB for live data queries.');
        
        // HOSxP read-only queries (same as server.js)
        const DEFAULT_HIPDATA_SQL_LIST = "'OFC','UCS','OTH','BMT','XXX','LGO','STP','SSS','SSI','A2','BKK','PTY','A9'";
        
        const [[vRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) as total_visits
             FROM vn_stat v
             LEFT JOIN ovst ov ON ov.vn = v.vn
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
               AND COALESCE(v.uc_money, 0) > 0`,
            [queryDate]
        );
        total_visits = vRows?.total_visits || 0;

        const [[sRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) as service_total 
             FROM vn_stat v
             LEFT OUTER JOIN pttype py ON py.pttype = v.pttype
             WHERE v.vstdate = ?
               AND py.hipdata_code IN (${DEFAULT_HIPDATA_SQL_LIST})`,
            [queryDate]
        );
        service_total_count = sRows?.service_total || 0;

        const [[mRows]] = await connection.query(
            `SELECT COALESCE(SUM(v.uc_money), 0) AS total_money
             FROM vn_stat v
             LEFT JOIN ovst ov ON ov.vn = v.vn
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
               AND COALESCE(v.uc_money, 0) > 0`,
            [queryDate]
        );
        total_money = mRows?.total_money || 0;

        const [[eRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) AS endpoint_count
             FROM vn_stat v
             LEFT JOIN visit_pttype vp ON vp.vn = v.vn
             LEFT JOIN pttype py ON py.pttype = v.pttype
             WHERE v.vstdate = ?
               AND py.hipdata_code IN (${DEFAULT_HIPDATA_SQL_LIST})
               AND UPPER(vp.pttype_note) = 'ENDPOINT'`,
            [queryDate]
        );
        endpoint_count = eRows?.endpoint_count || 0;

        const [[nRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) AS not_imported_count
             FROM vn_stat v
             LEFT JOIN ovst ov ON ov.vn = v.vn
             LEFT JOIN temp_authen_code td ON td.cid = v.cid
                AND td.status_use <> 'C'
                AND td.dateser = v.vstdate
                AND td.flag = 'D'
             LEFT JOIN pttype py ON py.pttype = v.pttype
             WHERE v.vstdate = ?
               AND py.hipdata_code IN (${DEFAULT_HIPDATA_SQL_LIST})
               AND COALESCE(ov.pt_subtype, '') <> '1'
               AND ov.an IS NULL
               AND td.claimcode IS NULL`,
            [queryDate]
        );
        not_imported_count = nRows?.not_imported_count || 0;

        const [[aRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) AS authen_count
             FROM vn_stat v
             LEFT JOIN visit_pttype vp ON vp.vn = v.vn
             LEFT JOIN pttype py ON py.pttype = v.pttype
             WHERE v.vstdate = ?
               AND py.hipdata_code IN (${DEFAULT_HIPDATA_SQL_LIST})
               AND UPPER(vp.pttype_note) = 'AUTHENCODE'`,
            [queryDate]
        );
        authen_count = aRows?.authen_count || 0;

        const [rRows] = await connection.query(
            `SELECT 
                CASE 
                    WHEN py.pttype_spp_id = 1 THEN 'เบิกจ่ายตรงกรมบัญชีกลาง'
                    WHEN py.pttype_spp_id = 11 THEN 'เบิกต้นสังกัด'
                    WHEN py.pttype_spp_id = 7 THEN 'เบิกจ่ายตรง อปท.'
                    WHEN py.pttype_spp_id IN (3, 4) THEN 'บัตรทอง'
                    WHEN py.pttype_spp_id IN (5, 8) THEN 'คนต่างด้าว'
                    WHEN py.pttype_spp_id = 10 THEN 'ผู้มีปัญหาสถานะและสิทธิ'
                    WHEN py.pttype_spp_id = 2 THEN 'บัตรประกันสังคม'
                    WHEN py.pttype_spp_id = 9 THEN 'พรบ.ผู้ประสบภัยจากรถ'
                    WHEN py.pttype_spp_id = 6 THEN 'อื่นๆ (ชำระเงินเอง)'
                    ELSE 'ไม่ระบุสิทธิ'
                END as right_name,
                COUNT(DISTINCT v.vn) as cnt
             FROM vn_stat v
             LEFT OUTER JOIN pttype py ON py.pttype = v.pttype
             LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
             WHERE v.vstdate = ?
               AND COALESCE(ov.pt_subtype, '') <> '1'
               AND ov.an IS NULL
             GROUP BY right_name
             ORDER BY cnt DESC
             LIMIT 3`,
            [queryDate]
        );
        rights = rRows || [];

        const [[uRows]] = await connection.query(
            `SELECT COUNT(DISTINCT v.vn) as ucs_total
             FROM vn_stat v
             LEFT JOIN ovst ov ON ov.vn = v.vn
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
               AND COALESCE(v.uc_money, 0) > 0`,
            [queryDate]
        );
        ucs_total = uRows?.ucs_total || 0;

        const [dRows] = await connection.query(
            `SELECT COALESCE(k.department, 'ไม่ระบุจุดบริการ') as dept_name, COUNT(DISTINCT v.vn) as cnt
             FROM vn_stat v
             LEFT JOIN ovst ov ON ov.vn = v.vn
             LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
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
               AND COALESCE(v.uc_money, 0) > 0
             GROUP BY dept_name
             ORDER BY cnt DESC
             LIMIT 3`,
            [queryDate]
        );
        ucs_departments = dRows || [];
        
    } catch (dbErr) {
        console.warn('⚠️ DB Connection timeout/failed (Falling back to Mock Data):', dbErr.message);
        dbErrorOccurred = true;
        
        // Mock data fallback
        total_visits = 120;
        total_money = 45000;
        endpoint_count = 15;
        not_imported_count = 25;
        authen_count = 80;
        rights = [
            { right_name: 'สิทธิหลักประกันสุขภาพ (บัตรทอง)', cnt: 75 },
            { right_name: 'สิทธิข้าราชการ', cnt: 30 },
            { right_name: 'สิทธิประกันสังคม', cnt: 15 }
        ];
        ucs_total = 40;
        service_total_count = 343;
        ucs_departments = [
            { dept_name: 'OPD ทั่วไป', cnt: 20 },
            { dept_name: 'ห้องฉุกเฉิน (ER)', cnt: 12 },
            { dept_name: 'คลินิกโรคเรื้อรัง', cnt: 8 }
        ];
    } finally {
        if (connection) {
            await connection.end();
        }
    }

    // Build LINE Flex message layout
    const rightsContents = [];
    rights.forEach(r => {
        rightsContents.push({
            "type": "box",
            "layout": "horizontal",
            "contents": [
                { "type": "text", "text": r.right_name || 'ไม่ระบุสิทธิ', "color": "#ffffff", "size": "sm" },
                { "type": "text", "text": String(r.cnt), "color": "#52c41a", "size": "md", "align": "end", "weight": "bold" }
            ]
        });
    });

    const ucsContents = [
        {
            "type": "box",
            "layout": "horizontal",
            "contents": [
                { "type": "text", "text": "UCS ไม่ได้ปิดสิทธิ", "color": "#ffffff", "size": "sm", "weight": "bold" },
                { "type": "text", "text": String(ucs_total), "color": "#ff4d4d", "size": "md", "align": "end", "weight": "bold" }
            ]
        }
    ];

    ucs_departments.forEach(d => {
        ucsContents.push({
            "type": "box",
            "layout": "horizontal",
            "contents": [
                { "type": "text", "text": ` - ${d.dept_name}`, "color": "#8c8c8c", "size": "xs" },
                { "type": "text", "text": String(d.cnt), "color": "#ffffff", "size": "xs", "align": "end" }
            ]
        });
    });

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
                    "text": dbErrorOccurred ? "⚠️ สรุปข้อมูล (Mock - DB Offline)" : "📊 สรุปข้อมูลการให้บริการ",
                    "weight": "bold",
                    "color": dbErrorOccurred ? "#ffa940" : "#ffffff",
                    "size": "xl"
                },
                {
                    "type": "text",
                    "text": `Dashboard Summary (${formattedDate})`,
                    "size": "xs",
                    "color": "#8c8c8c",
                    "margin": "sm"
                },
                { "type": "separator", "margin": "md", "color": "#333333" },
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
                                { "type": "text", "text": "จำนวนครั้ง (count)", "color": "#ffffff", "size": "sm", "gravity": "center" },
                                { "type": "text", "text": String(total_visits), "color": "#ff4d4d", "size": "xl", "align": "end", "weight": "bold" }
                            ]
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                { "type": "text", "text": "ค่ารักษาลูกหนี้ (sum)", "color": "#ffffff", "size": "sm", "gravity": "center" },
                                { "type": "text", "text": Number(total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "color": "#ff4d4d", "size": "xl", "align": "end", "weight": "bold" }
                            ]
                        }
                    ]
                },
                { "type": "separator", "margin": "md", "color": "#333333" },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "md",
                    "spacing": "sm",
                    "contents": [
                        { "type": "text", "text": "Visit Authen code", "color": "#8c8c8c", "size": "xs", "weight": "bold" },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "box",
                                    "layout": "vertical",
                                    "contents": [
                                        { "type": "text", "text": "จำนวนผู้มารับบริการ(ครั้ง)", "color": "#ffffff", "size": "xs", "align": "center" },
                                        { "type": "text", "text": String(service_total_count), "color": "#ff4d4d", "size": "md", "align": "center", "weight": "bold" }
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "vertical",
                                    "contents": [
                                        { "type": "text", "text": "ยังไม่นำเข้า", "color": "#ffffff", "size": "xs", "align": "center" },
                                        { "type": "text", "text": String(not_imported_count), "color": "#ff4d4d", "size": "md", "align": "center", "weight": "bold" }
                                    ]
                                },
                                {
                                    "type": "box",
                                    "layout": "vertical",
                                    "contents": [
                                        { "type": "text", "text": "AUTHENCODE", "color": "#ffffff", "size": "xs", "align": "center" },
                                        { "type": "text", "text": String(authen_count), "color": "#ff4d4d", "size": "md", "align": "center", "weight": "bold" }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                { "type": "separator", "margin": "md", "color": "#333333" },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "md",
                    "spacing": "sm",
                    "contents": [
                        { "type": "text", "text": "สิทธิการรักษา (Top 3)", "color": "#8c8c8c", "size": "xs", "weight": "bold" },
                        ...rightsContents
                    ]
                },
                { "type": "separator", "margin": "md", "color": "#333333" },
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

    console.log('\n--- SIMULATED LINE FLEX BUBBLE PAYLOAD ---');
    console.log(JSON.stringify(flexBubble, null, 2));
    console.log('------------------------------------------\n');
}

const svToday = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
testReplyPayload(svToday);
