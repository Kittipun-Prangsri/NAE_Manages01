import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

dotenv.config();
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function keepAliveNhsoSession() {
    const url = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
    console.log('⏰ [Keep-Alive] Starting background NHSO portal keep-alive...');
    
    let browser;
    try {
        const sessionPath = path.join(__dirname, '../puppeteer_session');
        
        // Cleanup singleton lock
        const lockFile = path.join(sessionPath, 'SingletonLock');
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
                console.log('🧹 [Keep-Alive] Cleaned up Puppeteer SingletonLock.');
            } catch (e) {
                console.warn('⚠️ [Keep-Alive] Warning: Could not remove SingletonLock:', e.message);
            }
        }

        browser = await puppeteer.launch({
            headless: true,
            userDataDir: sessionPath,
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

        console.log('🔗 [Keep-Alive] Accessing portal to ping session...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 5000));

        const currentUrl = page.url();
        console.log(`📍 [Keep-Alive] Current portal URL: ${currentUrl}`);

        if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('login')) {
            const hasLoginButton = await page.evaluate(() => {
                return !!document.querySelector('a[href*="/broker/thaid/login"]');
            });
            if (!hasLoginButton) {
                console.log('✅ [Keep-Alive] Session is active and healthy! Cookies refreshed.');
            } else {
                console.log('⚠️ [Keep-Alive] Redirected to login page inside portal structure.');
            }
        } else {
            console.log('⚠️ [Keep-Alive] Session has expired. (Redirected to outside login)');
        }

    } catch (error) {
        console.error('❌ [Keep-Alive] Error during session keep-alive:', error.message);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 [Keep-Alive] Browser closed.');
        }
    }
}

// Support running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    keepAliveNhsoSession().then(() => process.exit(0));
}
