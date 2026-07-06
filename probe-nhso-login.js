import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function probeLogin() {
    const url = 'https://authenservice.nhso.go.th/authencode/';
    console.log(`🌐 Launching browser to probe URL: ${url}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log('🔗 Navigating...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log(`📍 Loaded URL: ${page.url()}`);
        
        // Wait for page to load for 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const pageInfo = await page.evaluate(() => {
            return {
                title: document.title,
                bodyText: document.body ? document.body.innerText.substring(0, 1000) : 'no body',
                html: document.body ? document.body.innerHTML.substring(0, 1000) : 'no html'
            };
        });
        
        console.log('📝 Page Title:', pageInfo.title);
        console.log('📝 Page Text (first 1000 chars):\n', pageInfo.bodyText);
        console.log('📝 Page HTML (first 1000 chars):\n', pageInfo.html);
        
    } catch (error) {
        console.error('❌ Error during probe:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

probeLogin();
