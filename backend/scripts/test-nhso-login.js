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

async function testLogin() {
    const url = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
    const username = process.env.NHSO_PORTAL_USER;
    const password = process.env.NHSO_PORTAL_PASS;

    if (!username || !password || username === 'your_nhso_username_here') {
        console.error('❌ Error: NHSO_PORTAL_USER or NHSO_PORTAL_PASS is placeholder or missing in .env');
        return;
    }

    console.log(`🕵️‍♂️ Launching browser with STEALTH plugin to: ${url}`);
    
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
        
        // Emulate standard user-agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1440, height: 900 });
        
        console.log('🔗 Navigating to login page...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log(`📍 Loaded URL: ${page.url()}`);
        await page.waitForSelector('input#username', { timeout: 15000 });

        // Fill credentials
        console.log('🔑 Inputting credentials...');
        await page.type('input#username', username);
        await page.type('input#password', password);

        // Click login and wait for landing page load
        console.log('🚀 Click login button...');
        await Promise.all([
            page.click('input#kc-login'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(err => {
                console.log('⚠️ Navigation wait timed out, continuing...');
            })
        ]);

        console.log('🔗 Navigating directly to eclaim report page...');
        await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait extra 8 seconds for JS client-side router/rendering to load the claimcode contents
        console.log('⏳ Waiting for claimcode page content to render...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        const landingUrl = page.url();
        console.log(`📍 Post-login URL: ${landingUrl}`);

        // Take a screenshot of the dashboard
        const dashboardScreenshotPath = path.join(__dirname, 'nhso_dashboard_test.png');
        await page.screenshot({ path: dashboardScreenshotPath });
        console.log(`📸 Dashboard screenshot saved to: ${dashboardScreenshotPath}`);

        // Extract links and buttons from the landing page
        const extractedData = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a')).map(a => ({
                text: a.innerText.trim(),
                href: a.getAttribute('href')
            }));

            const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                text: b.innerText.trim(),
                id: b.id,
                className: b.className
            }));

            return {
                title: document.title,
                bodyText: document.body ? document.body.innerText.substring(0, 1000) : '',
                links: links.filter(l => l.text.length > 0),
                buttons: buttons.filter(b => b.text.length > 0)
            };
        });

        console.log('📝 Dashboard Page Title:', extractedData.title);
        console.log('📝 Extracted Menu Links:', JSON.stringify(extractedData.links, null, 2));
        console.log('📝 Extracted Buttons:', JSON.stringify(extractedData.buttons, null, 2));
        console.log('📝 Dashboard Text Preview:\n', extractedData.bodyText);

    } catch (error) {
        console.error('❌ Error during login test:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

testLogin();
