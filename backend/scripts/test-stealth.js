import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Use stealth plugin
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testStealth() {
    const url = 'https://authenservice.nhso.go.th/authencode/';
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
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log('🔗 Navigating...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log(`📍 Loaded URL: ${page.url()}`);
        
        // Wait 8 seconds to ensure dynamic JS renders
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // Extract page content info
        const pageInfo = await page.evaluate(() => {
            // Find all input elements to see if login form is loaded
            const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
                id: input.id,
                name: input.name,
                type: input.type,
                placeholder: input.placeholder
            }));
            
            return {
                title: document.title,
                bodyText: document.body ? document.body.innerText.substring(0, 1000) : 'no body',
                inputs: inputs
            };
        });
        
        console.log('📝 Page Title:', pageInfo.title);
        console.log('📝 Page Inputs:', pageInfo.inputs);
        console.log('📝 Page Text (first 1000 chars):\n', pageInfo.bodyText);
        
        // Take screenshot of the bypassed page
        const screenshotPath = path.join(__dirname, 'nhso_login_stealth.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 Screenshot saved to: ${screenshotPath}`);
        
    } catch (error) {
        console.error('❌ Error during stealth test:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

testStealth();
