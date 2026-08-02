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
                if (event.source) {
                    if (event.source.groupId) console.log(`   👉 Group ID: ${event.source.groupId}`);
                    if (event.source.userId) console.log(`   👉 User ID: ${event.source.userId}`);
                }

                if (event.type === 'message' && event.message && event.message.type === 'text') {
                    const text = event.message.text.trim();
                    const replyToken = event.replyToken;

                    if (text.startsWith('นำเข้าข้อมูล')) {
                        const parts = text.split(/\s+/);
                        let queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
                        if (parts.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
                            queryDate = parts[1];
                        }
                        console.log(`💬 Processing command 'นำเข้าข้อมูล' for date ${queryDate}`);
                        await sendLineReplyFlexSummary(replyToken, queryDate);
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

async function sendLineReplyFlexSummary(replyToken, queryDate) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
        console.error('❌ LINE Token is not configured in Vercel environment variables.');
        return;
    }

    const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

    // Mock summary data (can be replaced by DB API call if DB is connected)
    const total_visits = 120;
    const total_money = 45000;
    const endpoint_count = 15;
    const not_imported_count = 25;
    const authen_count = 80;
    const ucs_total = 40;
    const service_total_count = 343;

    const rights = [
        { right_name: 'สิทธิหลักประกันสุขภาพ (บัตรทอง)', cnt: 75 },
        { right_name: 'สิทธิข้าราชการ', cnt: 30 },
        { right_name: 'สิทธิประกันสังคม', cnt: 15 }
    ];

    const ucs_departments = [
        { dept_name: 'OPD ทั่วไป', cnt: 20 },
        { dept_name: 'ห้องฉุกเฉิน (ER)', cnt: 12 },
        { dept_name: 'คลินิกโรคเรื้อรัง', cnt: 8 }
    ];

    const rightsContents = rights.map(r => ({
        type: "box",
        layout: "horizontal",
        contents: [
            { type: "text", text: r.right_name, color: "#ffffff", size: "sm" },
            { type: "text", text: String(r.cnt), color: "#52c41a", size: "md", align: "end", weight: "bold" }
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
                { type: "text", text: ` - ${d.dept_name}`, color: "#8c8c8c", size: "xs" },
                { type: "text", text: String(d.cnt), color: "#ffffff", size: "xs", align: "end" }
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
                    text: `Dashboard Summary (${formattedDate})`,
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
        console.log('✅ Sent LINE Reply Flex Message successfully via Vercel Function.');
    } else {
        console.error('❌ LINE Reply API error:', resData);
    }
}
