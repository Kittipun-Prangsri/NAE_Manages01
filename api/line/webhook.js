import { trackerPool, hosxpPool } from '../../backend/db.js';

export default async function handler(req, res) {
    // Enable CORS for testing if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).send('LINE Webhook Endpoint Active');
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const events = req.body?.events || [];

        // Log events for debugging in Vercel function logs
        if (Array.isArray(events) && events.length > 0) {
            for (const event of events) {
                console.log(`💬 [LINE Webhook Event] Type: ${event.type}`);
                let targetId = null;
                if (event.source) {
                    if (event.source.groupId) {
                        console.log(`   👉 Group ID: ${event.source.groupId}`);
                        targetId = event.source.groupId;
                    }
                    if (event.source.roomId) targetId = targetId || event.source.roomId;
                    if (event.source.userId) targetId = targetId || event.source.userId;
                }

                if (event.type === 'message' && event.message && event.message.type === 'text') {
                    const text = event.message.text.trim();
                    const replyToken = event.replyToken;

                    if (/^(|\/)(นำเข้าข้อมูล|นำเข้า|summary|สรุปข้อมูล)/i.test(text)) {
                        const parts = text.split(/\s+/);
                        let queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
                        if (parts.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
                            queryDate = parts[1];
                        }
                        console.log(`💬 Processing command '${text}' for date ${queryDate}`);
                        sendLineReplyFlexSummary(replyToken, queryDate, targetId).catch(err => {
                            console.error('❌ LINE Reply Error:', err);
                        });
                    }
                }
            }
        }

        // Always return HTTP 200 OK to satisfy LINE Webhook Verification
        return res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('❌ LINE Webhook Error:', err);
        return res.status(200).json({ status: 'ok', error: err.message });
    }
}

async function fetchSummaryData(queryDate) {
    let total_visits = 0;
    let total_money = 0;
    let endpoint_count = 0;
    let not_imported_count = 0;
    let authen_count = 0;
    let ucs_total = 0;
    let service_total_count = 0;
    let rights = [];
    let ucs_departments = [];
    let dataSource = 'No Data';

    const queryWithTimeout = (promise, ms = 2000) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB Query Timeout (2s)')), ms))
        ]);
    };

    // 1. Try querying internal visit_tracking table (synced data) first
    try {
        const [summaryRows] = await queryWithTimeout(trackerPool.query(
            `SELECT COUNT(*) AS service_total_count,
                    SUM(CASE WHEN UPPER(COALESCE(pcode, '')) IN ('UC', 'UCS') AND color_status IN ('RED', 'YELLOW') THEN 1 ELSE 0 END) AS total_visits,
                    COALESCE(SUM(CASE WHEN UPPER(COALESCE(pcode, '')) IN ('UC', 'UCS') AND color_status IN ('RED', 'YELLOW') THEN uc_money ELSE 0 END), 0) AS total_money,
                    SUM(CASE WHEN color_status = 'YELLOW' THEN 1 ELSE 0 END) AS endpoint_count,
                    SUM(CASE WHEN check_claimcode = 'ยังไม่ได้นำเข้า' THEN 1 ELSE 0 END) AS not_imported_count,
                    SUM(CASE WHEN color_status = 'GREEN' THEN 1 ELSE 0 END) AS authen_count,
                    SUM(CASE WHEN UPPER(COALESCE(pcode, '')) IN ('UC', 'UCS') AND color_status IN ('RED', 'YELLOW') THEN 1 ELSE 0 END) AS ucs_total
             FROM visit_tracking
             WHERE visit_date = ?`,
            [queryDate]
        ));

        const summary = summaryRows[0] || {};
        if (summary.service_total_count > 0) {
            service_total_count = summary.service_total_count || 0;
            total_visits = summary.total_visits || 0;
            total_money = Number(summary.total_money || 0);
            endpoint_count = summary.endpoint_count || 0;
            not_imported_count = summary.not_imported_count || 0;
            authen_count = summary.authen_count || 0;
            ucs_total = summary.ucs_total || 0;

            const [rightsRows] = await queryWithTimeout(trackerPool.query(
                `SELECT COALESCE(NULLIF(TRIM(pttype_note), ''), NULLIF(TRIM(pttype), ''), 'ไม่ระบุสิทธิ') as right_name, COUNT(*) as cnt 
                 FROM visit_tracking 
                 WHERE visit_date = ? 
                 GROUP BY right_name ORDER BY cnt DESC LIMIT 3`,
                [queryDate]
            ));
            rights = rightsRows || [];

            const [deptRows] = await queryWithTimeout(trackerPool.query(
                `SELECT COALESCE(NULLIF(TRIM(department), ''), 'ไม่ระบุจุดบริการ') as dept_name, COUNT(*) as cnt 
                 FROM visit_tracking 
                 WHERE visit_date = ? AND UPPER(COALESCE(pcode, '')) IN ('UC', 'UCS') AND color_status IN ('RED', 'YELLOW') 
                 GROUP BY dept_name ORDER BY cnt DESC LIMIT 3`,
                [queryDate]
            ));
            ucs_departments = deptRows || [];
            dataSource = 'Synced Tracking DB';
        }
    } catch (err) {
        console.warn('⚠️ Tracker DB query failed:', err.message);
    }

    // 2. If tracker DB had no records for queryDate, fallback to HOSxP Live DB
    if (dataSource === 'No Data' && hosxpPool) {
        try {
            const DEFAULT_HIPDATA_SQL_LIST = "'OFC','UCS','OTH','BMT','XXX','LGO','STP','SSS','SSI','A2','BKK','PTY','A9'";

            const [[vRows]] = await queryWithTimeout(hosxpPool.query(
                `SELECT COUNT(DISTINCT v.vn) as total_visits, COALESCE(SUM(v.uc_money), 0) AS total_money
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
            ));
            total_visits = vRows?.total_visits || 0;
            total_money = Number(vRows?.total_money || 0);
            ucs_total = total_visits;

            const [[sRows]] = await hosxpPool.query(
                `SELECT COUNT(DISTINCT v.vn) as service_total 
                 FROM vn_stat v
                 LEFT OUTER JOIN pttype py ON py.pttype = v.pttype
                 WHERE v.vstdate = ?
                   AND py.hipdata_code IN (${DEFAULT_HIPDATA_SQL_LIST})`,
                [queryDate]
            );
            service_total_count = sRows?.service_total || 0;

            const [[eRows]] = await hosxpPool.query(
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

            const [[nRows]] = await hosxpPool.query(
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

            const [[aRows]] = await hosxpPool.query(
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

            const [rRows] = await hosxpPool.query(
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

            const [dRows] = await hosxpPool.query(
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
            dataSource = 'HOSxP Live DB';
        } catch (err) {
            console.warn('⚠️ HOSxP Live DB query failed:', err.message);
        }
    }

    return {
        total_visits,
        total_money,
        endpoint_count,
        not_imported_count,
        authen_count,
        ucs_total,
        service_total_count,
        rights,
        ucs_departments,
        dataSource
    };
}

async function sendLineReplyFlexSummary(replyToken, queryDate, targetId = null) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
        console.error('❌ LINE Token is not configured in Vercel environment variables.');
        return;
    }

    const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    const stats = await fetchSummaryData(queryDate);

    const rightsContents = (stats.rights.length > 0 ? stats.rights : [{ right_name: 'ไม่มีข้อมูล', cnt: 0 }]).map(r => ({
        type: "box",
        layout: "horizontal",
        contents: [
            { type: "text", text: r.right_name || 'ไม่ระบุสิทธิ', color: "#ffffff", size: "sm" },
            { type: "text", text: String(r.cnt || 0), color: "#52c41a", size: "md", align: "end", weight: "bold" }
        ]
    }));

    const ucsContents = [
        {
            type: "box",
            layout: "horizontal",
            contents: [
                { type: "text", text: "UCS ไม่ได้ปิดสิทธิ", color: "#ffffff", size: "sm", weight: "bold" },
                { type: "text", text: String(stats.ucs_total), color: "#ff4d4d", size: "md", align: "end", weight: "bold" }
            ]
        },
        ...stats.ucs_departments.map(d => ({
            type: "box",
            layout: "horizontal",
            contents: [
                { type: "text", text: ` - ${d.dept_name || 'ไม่ระบุแผนก'}`, color: "#8c8c8c", size: "xs" },
                { type: "text", text: String(d.cnt || 0), color: "#ffffff", size: "xs", align: "end" }
            ]
        }))
    ];

    const flexBubble = {
        type: "bubble",
        size: "giga",
        body: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#18191a",
            contents: [
                {
                    type: "text",
                    text: "📊 สรุปข้อมูลการให้บริการ",
                    weight: "bold",
                    color: "#ffffff",
                    size: "xl"
                },
                {
                    type: "text",
                    text: `Dashboard Summary (${formattedDate}) • ${stats.dataSource}`,
                    size: "xs",
                    color: "#8c8c8c",
                    margin: "sm"
                },
                { type: "separator", margin: "md", color: "#333333" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "box",
                            layout: "horizontal",
                            contents: [
                                { type: "text", text: "จำนวนครั้ง (count)", color: "#ffffff", size: "sm", gravity: "center" },
                                { type: "text", text: String(stats.total_visits), color: "#ff4d4d", size: "xl", align: "end", weight: "bold" }
                            ]
                        },
                        {
                            type: "box",
                            layout: "horizontal",
                            contents: [
                                { type: "text", text: "ค่ารักษาลูกหนี้ (sum)", color: "#ffffff", size: "sm", gravity: "center" },
                                { type: "text", text: Number(stats.total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: "#ff4d4d", size: "xl", align: "end", weight: "bold" }
                            ]
                        }
                    ]
                },
                { type: "separator", margin: "md", color: "#333333" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        { type: "text", text: "Visit Authen code", color: "#8c8c8c", size: "xs", weight: "bold" },
                        {
                            type: "box",
                            layout: "horizontal",
                            contents: [
                                {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        { type: "text", text: "จำนวนผู้มารับบริการ(ครั้ง)", color: "#ffffff", size: "xs", align: "center" },
                                        { type: "text", text: String(stats.service_total_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        { type: "text", text: "ยังไม่นำเข้า", color: "#ffffff", size: "xs", align: "center" },
                                        { type: "text", text: String(stats.not_imported_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        { type: "text", text: "AUTHENCODE", color: "#ffffff", size: "xs", align: "center" },
                                        { type: "text", text: String(stats.authen_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                { type: "separator", margin: "md", color: "#333333" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        { type: "text", text: "สิทธิการรักษา (Top 3)", color: "#8c8c8c", size: "xs", weight: "bold" },
                        ...rightsContents
                    ]
                },
                { type: "separator", margin: "md", color: "#333333" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: ucsContents
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let response = null;

    try {
        response = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } catch (fetchErr) {
        console.warn('⚠️ LINE Reply fetch error:', fetchErr.message);
    } finally {
        clearTimeout(timeoutId);
    }

    const resData = response ? await response.json().catch(() => ({})) : {};
    if (response && response.ok) {
        console.log('✅ Sent LINE Reply Flex Message successfully via Vercel Function.');
    } else {
        console.error('❌ LINE Reply API error:', resData);

        // Fallback to push message if replyToken failed or expired
        const fallbackTarget = targetId || process.env.LINE_GROUP_ID;
        if (fallbackTarget) {
            console.log(`📲 Attempting fallback Push message to ${fallbackTarget}...`);
            const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    to: fallbackTarget,
                    messages: payload.messages
                })
            });
            const pushData = await pushRes.json().catch(() => ({}));
            if (pushRes.ok) {
                console.log('✅ Sent LINE Fallback Push Flex Message successfully.');
            } else {
                console.error('❌ LINE Fallback Push API error:', pushData);
            }
        }
    }
}

