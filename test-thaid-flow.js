import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Use stealth plugin
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testThaiDFlow() {
    const url = 'https://authenservice.nhso.go.th/authencode/';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (!telegramToken || !telegramChatId || telegramChatId === 'your_telegram_chat_id_here') {
        console.error('❌ Error: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in .env. Needed to send the QR code.');
        return;
    }

    console.log(`🕵️‍♂️ Starting ThaiD Login Flow Test targeting: ${url}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1024, height: 768 });
        
        console.log('🔗 Navigating to NHSO portal...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('🔑 Clicking ThaiD login option...');
        // Wait for the ThaiD link to appear and click it
        await page.waitForSelector('a[href*="/broker/thaid/login"]', { timeout: 15000 });
        
        await Promise.all([
            page.click('a[href*="/broker/thaid/login"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {
                console.log('⚠️ Navigation after ThaiD click timed out, continuing...');
            })
        ]);

        console.log('⏳ Waiting for ThaiD QR Code page to render...');
        // Give it 5 seconds to load the QR code from dopa servers
        await new Promise(resolve => setTimeout(resolve, 5000));

        const thaidUrl = page.url();
        console.log(`📍 Current URL (ThaiD Page): ${thaidUrl}`);

        // Capture QR Code page screenshot
        const thaidQrPath = path.join(__dirname, 'thaid_qr.png');
        await page.screenshot({ path: thaidQrPath });
        console.log(`📸 QR Code screenshot saved to: ${thaidQrPath}`);

        // Send QR Code to Telegram so the user can scan it
        await sendToTelegram(thaidQrPath, 'thaid_qr.png', telegramToken, telegramChatId);
        console.log('📲 QR Code sent to Telegram. Please scan it with your ThaiD app on your phone now!');

        // Wait loop: Poll every 2 seconds to check if we are redirected back to authencode dashboard
        console.log('⏳ Waiting for user to scan QR Code (Timeout: 120 seconds)...');
        let authenticated = false;
        const startTime = Date.now();
        const timeoutMs = 120000; // 2 minutes

        while (Date.now() - startTime < timeoutMs) {
            const currentUrl = page.url();
            
            // Check if we are redirected back to authenservice/authencode
            if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('/login')) {
                console.log(`🎉 Detected redirect to NHSO Portal! URL: ${currentUrl}`);
                authenticated = true;
                break;
            }

            // Print countdown status
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`⏳ Polling session... ${elapsed}s elapsed. Current URL: ${currentUrl.substring(0, 60)}...\r`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n');

        if (authenticated) {
            console.log('✅ Authentication successful! Navigating to /report/eclaim...');
            await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log(`📍 Loaded Report Page URL: ${page.url()}`);
            
            const successScreenshot = path.join(__dirname, 'nhso_report_page.png');
            await page.screenshot({ path: successScreenshot });
            console.log(`📸 Saved report page screenshot to: ${successScreenshot}`);
            
            // Send report page screenshot to Telegram to confirm success
            await sendToTelegram(successScreenshot, 'nhso_report_page.png', telegramToken, telegramChatId, '🎉 เข้าสู่ระบบสำเร็จและเข้าหน้าดาวน์โหลดรายงานเรียบร้อยแล้ว!');
        } else {
            console.error('❌ Timeout reached. ThaiD QR Code was not scanned in time.');
        }

    } catch (error) {
        console.error('❌ Error during ThaiD flow:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

async function sendToTelegram(filepath, filename, token, chatId, text = '') {
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', text || `📲 สแกน QR Code นี้ด้วยแอป ThaiD เพื่อเข้าใช้งานระบบ สปสช. (จำกัดเวลา 2 นาที)`);

        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });

        const resData = await response.json();
        if (!response.ok || !resData.ok) {
            console.error('❌ Telegram error:', resData);
        }
    } catch (error) {
        console.error('❌ Error sending QR to Telegram:', error);
    }
}

testThaiDFlow();
