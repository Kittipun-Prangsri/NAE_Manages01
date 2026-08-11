import dotenv from 'dotenv';
import { default as handler } from '../api/line/webhook.js';

dotenv.config();

const commands = [
    'นำเข้าข้อมูล',
    'ดูรายงาน',
    'ตรวจสอบลูกหนี้',
    'Authen Code',
    'คู่มือใช้งาน',
    'ติดต่อผู้ดูแล'
];

async function testAll() {
    console.log('🧪 Testing all 6 LINE Rich Menu webhook command handlers...\n');

    for (const cmd of commands) {
        console.log(`➡️ Testing command: "${cmd}"`);
        const req = {
            method: 'POST',
            body: {
                events: [
                    {
                        type: 'message',
                        replyToken: 'dummy_token_for_test',
                        source: { type: 'user', userId: 'Ucb1a03f4cb54294893787c33afe77d2b' },
                        message: { type: 'text', text: cmd }
                    }
                ]
            }
        };

        const res = {
            setHeader: () => {},
            status: (code) => ({
                json: (data) => console.log(`   [HTTP ${code}] Response:`, data),
                send: (data) => console.log(`   [HTTP ${code}] Response:`, data)
            })
        };

        await handler(req, res);
        await new Promise(r => setTimeout(r, 500));
        console.log('');
    }
}

testAll();
