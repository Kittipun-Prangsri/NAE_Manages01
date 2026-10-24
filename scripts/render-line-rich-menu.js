import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Renders scripts/line-rich-menu/rich-menu.html into the 2500x1686 images that
// scripts/create-line-rich-menu.js uploads. LINE rejects images over 1MB, so the
// JPG is the fallback when the PNG is too large.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const htmlPath = path.join(__dirname, 'line-rich-menu', 'rich-menu.html');
const pngPath = path.join(rootDir, 'smart-groupinsights-line-rich-menu-2500x1686.png');
const jpgPath = path.join(rootDir, 'smart-groupinsights-line-rich-menu-2500x1686.jpg');
const LINE_MAX_BYTES = 1024 * 1024;

async function run() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 2500, height: 1686, deviceScaleFactor: 1 });
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);

        const fontLoaded = await page.evaluate(() => document.fonts.check('700 100px "IBM Plex Sans Thai"'));
        if (!fontLoaded) throw new Error('IBM Plex Sans Thai did not load (needs internet for Google Fonts)');

        // Every label must fit inside its card; nowrap text would otherwise be clipped.
        const overflow = await page.$$eval('.card', cards => cards
            .map(card => {
                const box = card.getBoundingClientRect();
                return [...card.querySelectorAll('.label, .sub')]
                    .filter(el => { const r = el.getBoundingClientRect(); return r.left < box.left + 40 || r.right > box.right - 40; })
                    .map(el => el.textContent);
            })
            .flat());
        if (overflow.length) throw new Error(`Text too wide for its card: ${overflow.join(', ')}`);

        await page.screenshot({ path: pngPath, type: 'png' });
        await page.screenshot({ path: jpgPath, type: 'jpeg', quality: 90 });
    } finally {
        await browser.close();
    }

    for (const file of [pngPath, jpgPath]) {
        const size = fs.statSync(file).size;
        const note = size < LINE_MAX_BYTES ? 'OK for LINE' : 'over LINE 1MB limit';
        console.log(`✅ ${path.basename(file)} — ${(size / 1024).toFixed(0)} KB (${note})`);
    }
}

run().catch(err => {
    console.error('❌ Render failed:', err.message);
    process.exit(1);
});
