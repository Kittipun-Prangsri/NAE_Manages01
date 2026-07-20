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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

async function testReply() {
    if (!token) {
        console.error('❌ LINE Token is missing!');
        return;
    }
    try {
        console.log('Sending a dummy reply request to LINE API...');
        const res = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                replyToken: '00000000000000000000000000000000', // Dummy reply token
                messages: [
                    {
                        type: 'text',
                        text: 'Test reply'
                    }
                ]
            })
        });
        const data = await res.json().catch(() => ({}));
        console.log('Status Code:', res.statusCode || res.status);
        console.log('Response Body:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Error during LINE reply test:', err);
    }
}

testReply();
