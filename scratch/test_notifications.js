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

const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const lineGroupId = process.env.LINE_GROUP_ID;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

console.log('--- Checking Configurations ---');
console.log('LINE Token exists:', !!lineToken);
console.log('LINE Group ID:', lineGroupId);
console.log('Telegram Token exists:', !!telegramToken);
console.log('Telegram Chat ID:', telegramChatId);
console.log('--------------------------------\n');

async function testTelegram() {
    if (!telegramToken || !telegramChatId) {
        console.error('❌ Telegram configuration missing!');
        return { success: false, error: 'Config missing' };
    }
    try {
        console.log('🤖 Testing Telegram Bot Token via getMe...');
        const meRes = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {
            headers: { 'Connection': 'close' }
        });
        const meData = await meRes.json();
        if (!meRes.ok || !meData.ok) {
            console.error('❌ Telegram Bot Token is invalid:', meData);
            return { success: false, error: meData };
        }
        console.log(`✅ Telegram Bot is valid: @${meData.result.username} (${meData.result.first_name})`);

        console.log('📲 Sending test message to Telegram Chat ID:', telegramChatId);
        const sendRes = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Connection': 'close'
            },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: '🔔 *แจ้งเตือนทดสอบระบบ*\nสถานะการเชื่อมต่อ: *ปกติ*\nทดสอบส่งเมื่อ: ' + new Date().toLocaleString('th-TH'),
                parse_mode: 'Markdown'
            })
        });
        const sendData = await sendRes.json();
        if (!sendRes.ok || !sendData.ok) {
            console.error('❌ Failed to send Telegram message:', sendData);
            return { success: false, error: sendData };
        }
        console.log('✅ Telegram message sent successfully!');
        return { success: true };
    } catch (err) {
        console.error('❌ Error during Telegram test:', err);
        return { success: false, error: err.message };
    }
}

async function testLine() {
    if (!lineToken) {
        console.error('❌ LINE Token configuration missing!');
        return { success: false, error: 'Config missing' };
    }
    try {
        console.log('💬 Testing LINE Token via /bot/info...');
        const infoRes = await fetch('https://api.line.me/v2/bot/info', {
            headers: { 'Authorization': `Bearer ${lineToken}` }
        });
        const infoData = await infoRes.json();
        if (!infoRes.ok || infoData.message) {
            console.error('❌ LINE Token is invalid:', infoData);
            return { success: false, error: infoData };
        }
        console.log(`✅ LINE Bot is valid: @${infoData.displayName} (Basic ID: ${infoData.basicId})`);

        if (lineGroupId) {
            console.log('💬 Trying to push a test message to LINE Group (Testing Push permission)...');
            // Try sending a push message to see if Push message is allowed for this account
            const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${lineToken}`
                },
                body: JSON.stringify({
                    to: lineGroupId,
                    messages: [
                        {
                            type: 'text',
                            text: '🔔 แจ้งเตือนทดสอบระบบ (LINE Push)\nสถานะการเชื่อมต่อ: ปกติ\nทดสอบส่งเมื่อ: ' + new Date().toLocaleString('th-TH')
                        }
                    ]
                })
            });
            const pushData = await pushRes.json().catch(() => ({}));
            if (!pushRes.ok) {
                console.warn('⚠️ LINE Push message failed (this is expected if using a Free Plan without Push permission or if the Group ID is invalid):', pushData);
                return { success: false, error: 'Push not allowed / Group ID issue', details: pushData };
            }
            console.log('✅ LINE Push message sent successfully to Group!');
            return { success: true };
        } else {
            console.log('ℹ️ LINE Group ID is not set. Skipping push test.');
            return { success: true, notes: 'Token valid, group ID not tested' };
        }
    } catch (err) {
        console.error('❌ Error during LINE test:', err);
        return { success: false, error: err.message };
    }
}

async function run() {
    console.log('=== Starting Notification Verification ===');
    const telResult = await testTelegram();
    console.log('\n----------------------------------------\n');
    const lineResult = await testLine();
    console.log('\n=== Verification Finished ===');
}

run();
