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
    
    // Clean up to ensure only at most 1 latest file is kept initially
    cleanOldDownloads(downloadsDir);

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
        let authenticated = false;
        let retries = 3;

        for (let attempt = 1; attempt <= retries; attempt++) {
            console.log(`🔗 Navigating to NHSO portal (Attempt ${attempt}/${retries})...`);
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

            const thaidUrl = page.url();
            console.log(`📍 Current URL (ThaiD Page): ${thaidUrl}`);

            // Temporarily set a mobile viewport for large QR code rendering
            await page.setViewport({ width: 440, height: 600 });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Capture QR Code page screenshot
            const thaidQrPath = path.join(downloadsDir, 'thaid_qr.png');
            await page.screenshot({ path: thaidQrPath });

            // Restore desktop viewport for subsequent operations
            await page.setViewport({ width: 1440, height: 900 });

            // Send QR Code to Telegram so the user can scan it
            const caption = attempt === 1 
                ? '📲 กรุณาสแกน QR Code เพื่อให้ระบบดาวน์โหลดรายงาน Authen Code อัตโนมัติ (จำกัดเวลา 2 นาที)'
                : `⚠️ QR Code ก่อนหน้านี้หมดอายุแล้ว กรุณาสแกน QR Code ใหม่นี้แทน (จำกัดเวลา 2 นาที, ครั้งที่ ${attempt}/${retries})`;
            
            await sendTelegramPhoto(thaidQrPath, 'thaid_qr.png', telegramToken, telegramChatId, caption, thaidUrl);
            console.log(`📲 QR Code (Attempt ${attempt}) sent to Telegram with action button. Waiting for user scan...`);

            // Wait for scan (Timeout: 120 seconds)
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

            if (authenticated) {
                console.log('✅ Authentication successful!');
                break;
            }

            console.warn(`⚠️ Attempt ${attempt} timed out waiting for scan.`);
        }

        if (!authenticated) {
            throw new Error('การยืนยันตัวตน ThaiD หมดเวลา หรือไม่สำเร็จในทุกความพยายาม');
        }

        console.log('✅ Authentication successful! Navigating to report/eclaim page...');
        await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('⏳ Waiting for page elements to load...');
        await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Format dates
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy_ad = now.getFullYear();
        const yyyy_be = yyyy_ad + 543;
        
        const date_be = `${dd}/${mm}/${yyyy_be}`;
        const date_ad = `${dd}/${mm}/${yyyy_ad}`;

        console.log(`📅 Prepared search dates -> BE: ${date_be}, AD: ${date_ad}`);

        // Fill dates in inputs (try BE first)
        console.log(`✍️ Setting date inputs to (BE): ${date_be}...`);
        await page.evaluate((val) => {
            const inputs = document.querySelectorAll('input[name="date"]');
            if (inputs.length >= 2) {
                inputs[0].value = val;
                inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                
                inputs[1].value = val;
                inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, date_be);

        // Click search (defaults to Today)
        console.log('🔍 Clicking "ค้นหา" to query today\'s report...');
        await page.click('button[type="submit"]');

        // Wait for download button to be enabled
        console.log('⏳ Waiting for "ดาวน์โหลดรายงาน" button to be active (BE Try)...');
        let downloadBtnSelector = 'button.btn-default.float-end:not([disabled])';
        let downloadBtnReady = false;

        try {
            await page.waitForSelector(downloadBtnSelector, { timeout: 15000 });
            downloadBtnReady = true;
        } catch (err) {
            console.log('⚠️ BE date search did not enable download button, trying AD year format...');
            
            // Fallback to AD date
            console.log(`✍️ Setting date inputs to (AD): ${date_ad}...`);
            await page.evaluate((val) => {
                const inputs = document.querySelectorAll('input[name="date"]');
                if (inputs.length >= 2) {
                    inputs[0].value = val;
                    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                    
                    inputs[1].value = val;
                    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, date_ad);

            console.log('🔍 Clicking "ค้นหา" button again...');
            await page.click('button[type="submit"]');

            console.log('⏳ Waiting for "ดาวน์โหลดรายงาน" button to be active (AD Try)...');
            await page.waitForSelector(downloadBtnSelector, { timeout: 30000 });
            downloadBtnReady = true;
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));

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

async function sendTelegramPhoto(filepath, filename, token, chatId, text, actionUrl = null) {
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', text);

        if (actionUrl) {
            const replyMarkup = {
                inline_keyboard: [
                    [
                        {
                            text: '📲 กดเพื่อเข้าสู่ระบบผ่านแอป ThaiD',
                            url: actionUrl
                        }
                    ]
                ]
            };
            formData.append('reply_markup', JSON.stringify(replyMarkup));
        }

        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
    } catch (error) {
        console.error('Error sending photo to Telegram:', error);
    }
}

export function cleanOldDownloads(downloadsDir) {
    try {
        if (!fs.existsSync(downloadsDir)) return;
        
        const files = fs.readdirSync(downloadsDir);
        const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
        
        if (xlsxFiles.length <= 1) {
            return; // 0 or 1 file, no need to clean
        }
        
        // Sort by modification time descending (newest first)
        const sorted = xlsxFiles.map(f => ({
            name: f,
            time: fs.statSync(path.join(downloadsDir, f)).mtimeMs
        })).sort((a, b) => b.time - a.time);
        
        // Keep the newest one (index 0) and delete the rest
        console.log(`🧹 Keeping latest Excel backup: ${sorted[0].name}`);
        for (let i = 1; i < sorted.length; i++) {
            const filePath = path.join(downloadsDir, sorted[i].name);
            try {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted old Excel download: ${sorted[i].name}`);
            } catch (err) {
                console.error(`❌ Error deleting old Excel file ${sorted[i].name}:`, err);
            }
        }
    } catch (error) {
        console.error('❌ Error cleaning old downloads:', error);
    }
}

// Support running directly for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    downloadNhsoReport();
}
