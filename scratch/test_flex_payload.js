import dotenv from 'dotenv';

dotenv.config();

async function testFlexPush() {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_GROUP_ID;

    const queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

    // Mock or DB stats
    const stats = {
        total_visits: 120,
        total_money: 45000,
        not_imported_count: 25,
        authen_count: 80,
        service_total_count: 343,
        ucs_total: 40,
        rights: [
            { right_name: 'UCS', cnt: 75 },
            { right_name: 'OFC', cnt: 30 },
            { right_name: 'SSS', cnt: 15 }
        ],
        ucs_departments: [
            { dept_name: 'OPD ทั่วไป', cnt: 20 },
            { dept_name: 'ห้องฉุกเฉิน (ER)', cnt: 12 },
            { dept_name: 'คลินิกโรคเรื้อรัง', cnt: 8 }
        ],
        dataSource: 'Mock Data'
    };

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
        to: groupId,
        messages: [
            {
                type: 'flex',
                altText: `📊 สรุปข้อมูลการให้บริการ (${queryDate})`,
                contents: flexBubble
            }
        ]
    };

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json().catch(() => ({}));
        console.log("Flex Push Status:", response.status);
        console.log("Flex Push Response:", JSON.stringify(resData, null, 2));
    } catch (err) {
        console.error("Fetch Error:", err);
    }

    process.exit(0);
}

testFlexPush();
