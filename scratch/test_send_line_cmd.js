import dotenv from 'dotenv';
import { trackerPool } from '../backend/db.js';

dotenv.config();

async function testSendImportDataCommand() {
    const queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_GROUP_ID;

    console.log(`💬 Testing command 'นำเข้าข้อมูล' for date: ${queryDate} (${formattedDate})...`);
    console.log(`Target LINE Group ID: ${targetId}`);

    let total_visits = 0;
    let total_money = 0;
    let not_imported_count = 0;
    let authen_count = 0;
    let rights = [];
    let ucs_total = 0;
    let ucs_departments = [];
    let service_total_count = 0;
    let dataSource = 'Synced Tracking DB';

    try {
        const [[vRows]] = await trackerPool.query(
            `SELECT COUNT(*) as total_visits
             FROM visit_tracking
             WHERE visit_date = ?
               AND pcode = 'UCS'
               AND color_status IN ('RED', 'YELLOW')
               AND COALESCE(uc_money, 0) > 0`,
            [queryDate]
        );
        total_visits = vRows?.total_visits || 0;
        ucs_total = total_visits;

        const [[sRows]] = await trackerPool.query(
            `SELECT COUNT(*) as service_total FROM visit_tracking WHERE visit_date = ?`,
            [queryDate]
        );
        service_total_count = sRows?.service_total || 0;

        const [[mRows]] = await trackerPool.query(
            `SELECT COALESCE(SUM(uc_money), 0) AS total_money
             FROM visit_tracking
             WHERE visit_date = ?
               AND pcode = 'UCS'
               AND color_status IN ('RED', 'YELLOW')
               AND COALESCE(uc_money, 0) > 0`,
            [queryDate]
        );
        total_money = Number(mRows?.total_money || 0);

        const [[nRows]] = await trackerPool.query(
            `SELECT COUNT(*) AS not_imported_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'RED'`,
            [queryDate]
        );
        not_imported_count = nRows?.not_imported_count || 0;

        const [[aRows]] = await trackerPool.query(
            `SELECT COUNT(*) AS authen_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'GREEN'`,
            [queryDate]
        );
        authen_count = aRows?.authen_count || 0;

        const [rRows] = await trackerPool.query(
            `SELECT COALESCE(pcode, 'ไม่ระบุสิทธิ') as right_name, COUNT(*) as cnt
             FROM visit_tracking
             WHERE visit_date = ?
             GROUP BY right_name
             ORDER BY cnt DESC
             LIMIT 3`,
            [queryDate]
        );
        rights = rRows || [];

        const [dRows] = await trackerPool.query(
            `SELECT COALESCE(department, 'ไม่ระบุจุดบริการ') as dept_name, COUNT(*) as cnt
             FROM visit_tracking
             WHERE visit_date = ?
               AND pcode = 'UCS'
               AND color_status IN ('RED', 'YELLOW')
               AND COALESCE(uc_money, 0) > 0
             GROUP BY dept_name
             ORDER BY cnt DESC
             LIMIT 3`,
            [queryDate]
        );
        ucs_departments = dRows || [];
    } catch (err) {
        console.warn('⚠️ Database query failed/offline (using offline summary):', err.message);
        dataSource = 'No Data (DB Offline)';
    }

    const rightsContents = (rights.length > 0 ? rights : [{ right_name: 'ไม่มีข้อมูลรายการ', cnt: 0 }]).map(r => ({
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
                { type: "text", text: String(ucs_total), color: "#ff4d4d", size: "md", align: "end", weight: "bold" }
            ]
        },
        ...ucs_departments.map(d => ({
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
                    text: `Dashboard Summary (${formattedDate}) • ${dataSource}`,
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
                                { type: "text", text: String(total_visits), color: "#ff4d4d", size: "xl", align: "end", weight: "bold" }
                            ]
                        },
                        {
                            type: "box",
                            layout: "horizontal",
                            contents: [
                                { type: "text", text: "ค่ารักษาลูกหนี้ (sum)", color: "#ffffff", size: "sm", gravity: "center" },
                                { type: "text", text: Number(total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: "#ff4d4d", size: "xl", align: "end", weight: "bold" }
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
                                        { type: "text", text: String(service_total_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        { type: "text", text: "ยังไม่นำเข้า", color: "#ffffff", size: "xs", align: "center" },
                                        { type: "text", text: String(not_imported_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        { type: "text", text: "AUTHENCODE", color: "#ffffff", size: "xs", align: "center" },
                                        { type: "text", text: String(authen_count), color: "#ff4d4d", size: "md", align: "center", weight: "bold" }
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

    const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            to: targetId,
            messages: [
                {
                    type: 'flex',
                    altText: `📊 สรุปข้อมูลการให้บริการ (${queryDate})`,
                    contents: flexBubble
                }
            ]
        })
    });

    const pushData = await pushRes.json().catch(() => ({}));
    console.log("Push Status Code:", pushRes.status);
    console.log("Push API Response:", pushData);

    process.exit(0);
}

testSendImportDataCommand();
