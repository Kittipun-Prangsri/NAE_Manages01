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

async function extractEclaimDetails() {
    const url = 'https://authenservice.nhso.go.th/authencode/';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    console.log('🕵️‍♂️ Starting ThaiD Login Flow to extract Eclaim report elements...');
    
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
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait and click ThaiD
        await page.waitForSelector('a[href*="/broker/thaid/login"]', { timeout: 15000 });
        await Promise.all([
            page.click('a[href*="/broker/thaid/login"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
        ]);

        await new Promise(resolve => setTimeout(resolve, 5000));

        // Capture QR Code page screenshot
        const thaidQrPath = path.join(__dirname, 'thaid_qr_extract.png');
        await page.screenshot({ path: thaidQrPath });

        // Send QR Code to Telegram
        await sendToTelegram(thaidQrPath, 'thaid_qr_extract.png', telegramToken, telegramChatId, '📲 กรุณาสแกนเพื่อเข้าดึงข้อมูล Element ของหน้ารายงาน Eclaim (เวลา 2 นาที)');
        console.log('📲 QR Code sent to Telegram. Please scan now...');

        // Wait for scan
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

        if (authenticated) {
            console.log('✅ Auth success. Navigating to eclaim report page...');
            await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
            
            // Wait for AJAX / Angular elements
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Extract inputs, selects, buttons, links and forms
            const elements = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input, select, button, a')).map(el => {
                    return {
                        tagName: el.tagName.toLowerCase(),
                        id: el.id || '',
                        name: el.name || '',
                        type: el.type || '',
                        className: el.className || '',
                        text: el.innerText ? el.innerText.trim() : '',
                        placeholder: el.placeholder || '',
                        value: el.value || ''
                    };
                });
                
                // Also get the outer HTML of form or form controls to understand the selectors
                const formControls = Array.from(document.querySelectorAll('.form-control, .btn, .select, input')).map(el => el.outerHTML);
                
                return {
                    title: document.title,
                    url: window.location.href,
                    elements: inputs,
                    formControls: formControls.slice(0, 50)
                };
            });
            
            console.log('--- Page Details ---');
            console.log('Title:', elements.title);
            console.log('URL:', elements.url);
            console.log('\n--- Form Elements ---');
            console.log(JSON.stringify(elements.elements, null, 2));
            console.log('\n--- Form Controls HTML ---');
            elements.formControls.forEach((html, i) => console.log(`[${i}] ${html}`));
            
        } else {
            console.error('❌ Timeout waiting for scan.');
        }

    } catch (error) {
        console.error('❌ Error during extraction:', error);
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
        formData.append('caption', text);

        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
    } catch (error) {
        console.error('❌ Error sending QR to Telegram:', error);
    }
}

extractEclaimDetails();
