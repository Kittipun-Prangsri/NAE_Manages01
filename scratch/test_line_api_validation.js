import dotenv from 'dotenv';

dotenv.config();

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const groupId = process.env.LINE_GROUP_ID;

async function testPush(name, flexBubble) {
    console.log(`➡️ Testing push for command: ${name}`);
    const payload = {
        to: groupId,
        messages: [
            {
                type: 'flex',
                altText: `Testing ${name}`,
                contents: flexBubble
            }
        ]
    };

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
        console.log(`✅ Push success for ${name}`);
    } else {
        console.error(`❌ Push failed for ${name}:`, JSON.stringify(data));
    }
}

async function run() {
    const webUrl = process.env.SERVER_PUBLIC_URL && !process.env.SERVER_PUBLIC_URL.includes('localhost') 
        ? process.env.SERVER_PUBLIC_URL 
        : 'https://nhsoauthen.nhsotracker.site';

    // 1. Report links
    const reportFlex = {
        type: "bubble", size: "giga",
        body: {
            type: "box", layout: "vertical", backgroundColor: "#0f172a",
            contents: [
                { type: "text", text: "📈 ระบบรายงาน Smart Groupinsights", weight: "bold", color: "#38bdf8", size: "lg" },
                { type: "text", text: "เลือกดูรายงานสรุปผลการดำเนินงานและสิทธิการรักษา", size: "xs", color: "#94a3b8", margin: "xs" },
                { type: "separator", margin: "md", color: "#334155" },
                {
                    type: "box", layout: "vertical", margin: "md", spacing: "sm",
                    contents: [
                        { type: "text", text: "🔗 ลิงก์เข้าใช้งานระบบ", color: "#f8fafc", size: "sm", weight: "bold" },
                        { type: "text", text: "• แดชบอร์ดสรุปรายวัน (Live Dashboard)", color: "#cbd5e1", size: "xs" },
                        { type: "text", text: "• ตรวจสอบลูกหนี้ UC และ Authen Code", color: "#cbd5e1", size: "xs" },
                        { type: "text", text: "• ประวัติการซิงก์ข้อมูล HOSxP", color: "#cbd5e1", size: "xs" }
                    ]
                }
            ]
        },
        footer: {
            type: "box", layout: "vertical", backgroundColor: "#0f172a", spacing: "sm",
            contents: [
                {
                    type: "button", style: "primary", color: "#0284c7", height: "sm",
                    action: { type: "uri", label: "🌐 เปิดหน้าแดชบอร์ดระบบ", uri: webUrl }
                }
            ]
        }
    };
    await testPush('ดูรายงาน', reportFlex);

    // 2. Debtor summary
    const debtorFlex = {
        type: "bubble", size: "giga",
        body: {
            type: "box", layout: "vertical", backgroundColor: "#1e1b4b",
            contents: [
                { type: "text", text: "📌 ตรวจสอบลูกหนี้ UC ค้างปิดสิทธิ์", weight: "bold", color: "#a855f7", size: "lg" },
                { type: "text", text: "ประจำวันที่ 11 สิงหาคม 2569", size: "xs", color: "#c084fc", margin: "xs" },
                { type: "separator", margin: "md", color: "#4338ca" },
                {
                    type: "box", layout: "vertical", margin: "md", spacing: "sm",
                    contents: [
                        {
                            type: "box", layout: "horizontal",
                            contents: [
                                { type: "text", text: "จำนวนลูกหนี้ค้างสิทธิ์:", color: "#e0e7ff", size: "sm" },
                                { type: "text", text: "8 ราย", color: "#f43f5e", size: "md", align: "end", weight: "bold" }
                            ]
                        },
                        {
                            type: "box", layout: "horizontal",
                            contents: [
                                { type: "text", text: "ยอดเงินค่ารักษาพยาบาล:", color: "#e0e7ff", size: "sm" },
                                { type: "text", text: "฿3,463.25", color: "#f43f5e", size: "md", align: "end", weight: "bold" }
                            ]
                        }
                    ]
                }
            ]
        }
    };
    await testPush('ตรวจสอบลูกหนี้', debtorFlex);

    // 3. Authen summary
    const authenFlex = {
        type: "bubble", size: "giga",
        body: {
            type: "box", layout: "vertical", backgroundColor: "#064e3b",
            contents: [
                { type: "text", text: "🔑 ตรวจสอบ Authen Code (สปสช.)", weight: "bold", color: "#34d399", size: "lg" },
                { type: "text", text: "ประจำวันที่ 11 สิงหาคม 2569", size: "xs", color: "#a7f3d0", margin: "xs" },
                { type: "separator", margin: "md", color: "#047857" },
                {
                    type: "box", layout: "vertical", margin: "md", spacing: "sm",
                    contents: [
                        {
                            type: "box", layout: "horizontal",
                            contents: [
                                { type: "text", text: "รับบริการทั้งหมด:", color: "#ecfdf5", size: "sm" },
                                { type: "text", text: "320 ราย", color: "#60a5fa", size: "md", align: "end", weight: "bold" }
                            ]
                        }
                    ]
                }
            ]
        }
    };
    await testPush('Authen Code', authenFlex);

    // 4. User manual
    const manualFlex = {
        type: "bubble", size: "giga",
        body: {
            type: "box", layout: "vertical", backgroundColor: "#1e293b",
            contents: [
                { type: "text", text: "📖 คู่มือการใช้งาน Smart Groupinsights", weight: "bold", color: "#fbbf24", size: "md" }
            ]
        },
        footer: {
            type: "box", layout: "vertical", backgroundColor: "#1e293b",
            contents: [
                {
                    type: "button", style: "secondary", color: "#334155", height: "sm",
                    action: { type: "uri", label: "🌐 เปิดคู่มือและใช้งานระบบเว็บ", uri: webUrl }
                }
            ]
        }
    };
    await testPush('คู่มือใช้งาน', manualFlex);

    // 5. Admin contact
    const contactFlex = {
        type: "bubble", size: "giga",
        body: {
            type: "box", layout: "vertical", backgroundColor: "#0f172a",
            contents: [
                { type: "text", text: "🎧 ติดต่อผู้ดูแลระบบ (Admin Support)", weight: "bold", color: "#38bdf8", size: "md" }
            ]
        }
    };
    await testPush('ติดต่อผู้ดูแล', contactFlex);
}

run();
