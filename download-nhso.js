import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function downloadNhsoReport() {
    const url = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    
    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
    
    // Clean old downloads first to avoid reading wrong files
    try {
        const existingFiles = fs.readdirSync(downloadsDir);
        existingFiles.forEach(f => {
            if (f.endsWith('.xlsx')) {
                fs.unlinkSync(path.join(downloadsDir, f));
            }
        });
    } catch (err) {
        console.error('Error clearing old downloads:', err);
    }

    console.log('🕵️‍♂️ Starting automated NHSO Report Downloader...');
    
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
        await page.setViewport({ width: 1440, height: 900 });
        
        // Setup download path in Chrome Headless
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadsDir
        });

        console.log('🔗 Navigating to NHSO portal...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait and click ThaiD
        console.log('🔑 Clicking ThaiD login option...');
        await page.waitForSelector('a[href*="/broker/thaid/login"]', { timeout: 15000 });
        await Promise.all([
            page.click('a[href*="/broker/thaid/login"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
        ]);

        // Wait for ThaiD QR page to render
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Capture QR Code page screenshot
        const thaidQrPath = path.join(downloadsDir, 'thaid_qr.png');
        await page.screenshot({ path: thaidQrPath });

        // Send QR Code to Telegram so the user can scan it
        await sendTelegramPhoto(thaidQrPath, 'thaid_qr.png', telegramToken, telegramChatId, '📲 กรุณาสแกน QR Code เพื่อให้ระบบดาวน์โหลดรายงาน Authen Code อัตโนมัติ (จำกัดเวลา 2 นาที)');
        console.log('📲 QR Code sent to Telegram. Waiting for user scan...');

        // Wait for scan (Timeout: 120 seconds)
        let authenticated = false;
        const startTime = Date.now();
        const timeoutMs = 120000;

        while (Date.now() - startTime < timeoutMs) {
            const currentUrl = page.url();
            if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('/login')) {
                authenticated = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!authenticated) {
            throw new Error('การยืนยันตัวตน ThaiD หมดเวลา หรือไม่สำเร็จ');
        }

        console.log('✅ Authentication successful! Navigating to report/eclaim page...');
        await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('⏳ Waiting for page elements to load...');
        await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Click search (defaults to Today)
        console.log('🔍 Clicking "ค้นหา" to query today\'s report...');
        await page.click('button[type="submit"]');

        // Wait for download button to be enabled
        console.log('⏳ Waiting for "ดาวน์โหลดรายงาน" button to be active...');
        await page.waitForSelector('button.btn-default.float-end:not([disabled])', { timeout: 45000 });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('📥 Clicking "ดาวน์โหลดรายงาน" button...');
        await page.click('button.btn-default.float-end');

        console.log('⏳ Waiting for file download to complete...');
        const filePath = await waitForDownload(downloadsDir, 60000);
        console.log(`🎉 Download successful! Saved to: ${filePath}`);

        return { success: true, filePath };

    } catch (error) {
        console.error('❌ Downloader Error:', error);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

async function waitForDownload(downloadsDir, timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const files = fs.readdirSync(downloadsDir);
        const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
        const inProgress = files.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
        
        if (xlsxFiles.length > 0 && !inProgress) {
            const sorted = xlsxFiles.map(f => ({
                name: f,
                time: fs.statSync(path.join(downloadsDir, f)).mtimeMs
            })).sort((a, b) => b.time - a.time);
            return path.join(downloadsDir, sorted[0].name);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('การดาวน์โหลดไฟล์รายงานหมดเวลา (Timeout)');
}

async function sendTelegramPhoto(filepath, filename, token, chatId, text) {
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', text);

        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
    } catch (error) {
        console.error('Error sending photo to Telegram:', error);
    }
}

// Support running directly for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    downloadNhsoReport();
}
