import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPuppeteerLaunchOptions } from '../backend/puppeteerHelper.js';

// Diagnoses why Chromium hangs on this machine.  Run while the worker is idle:
//   node scripts/check-browser.js
// Each step launches a browser and opens a page; the first failing step points
// at the cause (environment, the stealth plugin, or the saved session profile).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(__dirname, '../puppeteer_session');
puppeteerExtra.use(StealthPlugin());

function sh(cmd) {
    try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return '(unavailable)'; }
}

console.log('— Environment —');
console.log(`node ${process.version}, ${os.platform()} ${os.release()}, free RAM ${(os.freemem() / 1024 ** 3).toFixed(1)} GB`);
console.log(`/dev/shm: ${sh("df -h /dev/shm | tail -1")}`);
console.log(`chrome processes on session profile: ${sh('pgrep -fc "[u]ser-data-dir=.*puppeteer_session" || true')}`);
console.log(`session profile size: ${sh(`du -sh "${sessionPath}" 2>/dev/null | cut -f1`)}`);

async function step(name, launcher, extra) {
    const started = Date.now();
    let browser;
    try {
        browser = await launcher.launch({ ...getPuppeteerLaunchOptions(extra), protocolTimeout: 60000, timeout: 60000 });
        const page = await browser.newPage();
        await page.goto('https://authenservice.nhso.go.th/authencode/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`✅ ${name}: OK in ${((Date.now() - started) / 1000).toFixed(1)}s (${page.url().slice(0, 60)}...)`);
        return true;
    } catch (err) {
        console.log(`❌ ${name}: ${err.message} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return false;
    } finally {
        await browser?.close().catch(() => {});
    }
}

const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'nae-check-'));
console.log('\n— Launch tests —');
await step('1. plain Puppeteer, fresh profile', puppeteer, { userDataDir: tempProfile });
await step('2. with stealth plugin, fresh profile', puppeteerExtra, { userDataDir: tempProfile });
await step('3. with stealth plugin, saved session profile', puppeteerExtra, { userDataDir: sessionPath });
fs.rmSync(tempProfile, { recursive: true, force: true });
process.exit(0);
