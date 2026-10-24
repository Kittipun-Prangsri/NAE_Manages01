import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from '../backend/logger.js';
import { trackerPool } from '../backend/db.js';
import { getPuppeteerLaunchOptions } from '../backend/puppeteerHelper.js';
import { createSchedulerHolderId, releaseSchedulerLock } from '../backend/schedulerLock.js';
import { chooseEndpointReason, getEndpointCandidates } from '../backend/endpointCandidates.js';
import { acquirePortalLock, PORTAL_LOCK_KEY } from './keep-alive-nhso.js';
import { createTelegramQrNotifier, isThaidExpiredUrl, loginWithThaid, readThaidQr } from './thaidLogin.js';

// NHSO endpoint ("ยืนยันตัวตนแทนผู้เข้ารับบริการ") for visits that still need it.
// For each patient the bot fills the form; the officer then scans the ThaiD QR
// sent to Telegram.  That scan is the officer's attestation of the case, so the
// caption shows the amount and the reason before they scan.
//
//   node jobs/nhso-endpoint.js                 # dry run: fill + screenshot, never save
//   node jobs/nhso-endpoint.js --save --vn 691024090431   # one specific visit
//   node jobs/nhso-endpoint.js --save --limit 1
//   node jobs/nhso-endpoint.js --date 2026-10-24 --save
//
// Only today's visits are supported for saving: the form's service date
// defaults to today and the date picker is not automated yet.

dotenv.config({ quiet: true });
puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(__dirname, '../puppeteer_session');
const outDir = path.join(__dirname, '../downloads/endpoint-runs');
const PORTAL_URL = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
const BEHALF_URL = 'https://authenservice.nhso.go.th/authencode/nhso-endpoint/create/behalf';
const OFFICER_SCAN_ATTEMPTS = 3;
// Who verifies on the patient's behalf; the hospital uses its staff.
const PROXY_ROLE = 'เจ้าหน้าที่ผู้ดูแล';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

function telegramTarget() {
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = (process.env.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean);
    return { token, chatIds };
}

async function sendTelegram(text, photoPath = null) {
    const { token, chatIds } = telegramTarget();
    if (!token || process.env.DISABLE_NOTIFICATIONS === 'true') return;
    for (const chatId of chatIds) {
        try {
            const form = new FormData();
            form.append('chat_id', chatId);
            if (photoPath) {
                form.append('caption', text);
                form.append('photo', new Blob([fs.readFileSync(photoPath)], { type: 'image/png' }), path.basename(photoPath));
            } else {
                form.append('text', text);
            }
            await fetch(`https://api.telegram.org/bot${token}/${photoPath ? 'sendPhoto' : 'sendMessage'}`, { method: 'POST', body: form });
        } catch (err) {
            logger.warn({ err: err.message }, '⚠️ [Endpoint] Telegram send failed:');
        }
    }
}

async function ensureLogTable() {
    await trackerPool.query(`CREATE TABLE IF NOT EXISTS nhso_endpoint_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vn VARCHAR(20) NOT NULL,
        cid VARCHAR(13) NOT NULL,
        visit_date DATE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        reason VARCHAR(255) NULL,
        status VARCHAR(30) NOT NULL,
        message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_vn (vn)
    ) DEFAULT CHARSET=utf8mb4`);
}

async function logCase(row, reason, status, message = null) {
    await trackerPool.query(
        'INSERT INTO nhso_endpoint_log (vn, cid, visit_date, amount, reason, status, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.vn, row.cid, row.vstdate, Number(row.uc_money), reason, status, message]
    );
}

// "save_unconfirmed" may have been saved on the NHSO side: never retry it
// automatically; staff check the portal and delete that log row to retry.
async function alreadySaved(vn) {
    const [rows] = await trackerPool.query("SELECT 1 FROM nhso_endpoint_log WHERE vn = ? AND status IN ('saved', 'save_unconfirmed') LIMIT 1", [vn]);
    return rows.length > 0;
}

async function clickButtonByText(page, pattern) {
    return page.evaluate(source => {
        const regex = new RegExp(source);
        const button = [...document.querySelectorAll('button, a')]
            .filter(el => el.offsetParent !== null && regex.test(el.innerText.trim()))
            .pop();
        button?.click();
        return !!button;
    }, pattern.source);
}

async function setInputValue(page, selector, value) {
    await page.$eval(selector, el => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type(selector, String(value), { delay: 20 });
    await page.$eval(selector, el => el.dispatchEvent(new Event('blur', { bubbles: true })));
}

/**
 * Selects the proxy role ("เจ้าหน้าที่ผู้ดูแล") wherever the form offers it:
 * a <select> option or a radio/label.  Returns false when it is not on the page.
 */
async function selectProxyRole(page) {
    return page.evaluate(role => {
        for (const select of document.querySelectorAll('select')) {
            const option = [...select.options].find(o => o.text.trim() === role);
            if (option) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        const label = [...document.querySelectorAll('label')].find(el => el.offsetParent !== null && el.innerText.trim() === role);
        if (label) {
            const input = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input');
            if (input && !input.checked) (input || label).click();
            else if (!input) label.click();
            return true;
        }
        return false;
    }, PROXY_ROLE);
}

/** Searches the patient and fills every field.  Returns the reason used. */
async function fillForm(page, row) {
    await page.goto(BEHALF_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#search-pid', { timeout: 20000 });
    await setInputValue(page, '#search-pid', row.cid);
    if (!(await clickButtonByText(page, /^ค้นหา$/))) throw new Error('ไม่พบปุ่ม "ค้นหา"');
    await page.waitForSelector('#identity-reason', { timeout: 20000 })
        .catch(() => { throw new Error('ค้นหาผู้ป่วยไม่พบ หรือหน้าไม่แสดงฟอร์ม'); });
    await sleep(1000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const abnormalDrugs = Number((/จำนวนทั้งหมด\s*([\d,]+)\s*รายการ/.exec(bodyText) || [])[1]?.replace(/,/g, '') || 0);
    if (abnormalDrugs > 0) throw Object.assign(new Error(`มีรายการรับยาผิดปกติ ${abnormalDrugs} รายการ ต้องให้เจ้าหน้าที่ตรวจเอง`), { status: 'needs_review' });

    const optionTexts = await page.$$eval('#identity-reason option', options => options.map(o => o.text.trim()).filter(t => t && t !== 'กรุณาเลือก'));
    const reason = chooseEndpointReason(Number(row.age_y), optionTexts);
    if (!reason) throw Object.assign(new Error('ไม่มีเหตุผลที่ตรงเงื่อนไข (ตั้ง ENDPOINT_DEFAULT_REASON ใน .env)'), { status: 'no_reason' });
    await page.evaluate(text => {
        const select = document.querySelector('#identity-reason');
        const option = [...select.options].find(o => o.text.trim() === text);
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, reason);

    await setInputValue(page, '#paidAmount', Number(row.uc_money).toFixed(2));

    const serviceTypeChecked = await page.$eval('#servicetype0', el => el.checked);
    if (!serviceTypeChecked) await page.click('#servicetype0');
    // The role may only appear after the officer scan; it is checked again there.
    await selectProxyRole(page);
    return reason;
}

/** Reads back the values that must still be on the form before saving. */
async function formLooksFilled(page, row) {
    return page.evaluate(expected => {
        const paid = document.querySelector('#paidAmount')?.value || '';
        const reason = document.querySelector('#identity-reason')?.selectedIndex > 0;
        const serviceType = document.querySelector('#servicetype0')?.checked;
        return Number(paid) === Number(expected) && reason && serviceType;
    }, Number(row.uc_money).toFixed(2));
}

/** Sends the officer QR to Telegram and waits for the scan.  Returns true when scanned. */
async function officerScan(page, row, caption) {
    for (let attempt = 1; attempt <= OFFICER_SCAN_ATTEMPTS; attempt += 1) {
        if (!(await clickButtonByText(page, /สแกน\s*ThaiD/))) throw new Error('ไม่พบปุ่ม "คลิกเพื่อสแกน ThaiD QR code"');
        await page.waitForFunction(() => location.host.includes('imauth.bora.dopa.go.th'), { timeout: 20000 });
        await page.waitForFunction(() => [...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').startsWith('data:image')), { timeout: 20000 }).catch(() => {});
        const qr = await readThaidQr(page);
        if (!qr) throw new Error('ไม่พบ QR ของผู้รับรอง');

        const notifier = createTelegramQrNotifier(telegramTarget().token, telegramTarget().chatIds);
        await notifier.show(qr.buffer || Buffer.from(qr.dataUrl.split(',')[1], 'base64'), `${caption}\nเลขอ้างอิง ${qr.refCode || '-'} • QR อายุ ~1 นาที`);
        const expiresAt = Date.now() + qr.secondsLeft * 1000 + 5000;

        while (Date.now() < expiresAt) {
            const url = page.url();
            if (url.includes('authenservice.nhso.go.th') && url.includes('/nhso-endpoint/')) {
                await notifier.finish(`✅ สแกนแล้ว กำลังบันทึก\n${caption}`);
                await page.waitForSelector('#paidAmount', { timeout: 20000 });
                await sleep(1500);
                return true;
            }
            if (isThaidExpiredUrl(url)) break;
            await sleep(1500);
        }
        await notifier.finish(`⌛ QR หมดอายุ (รอบ ${attempt}/${OFFICER_SCAN_ATTEMPTS})\n${caption}`);
        if (attempt < OFFICER_SCAN_ATTEMPTS) {
            // The form is gone once the QR page closes; fill it again for a fresh QR.
            await fillForm(page, row);
        }
    }
    return false;
}

// Native browser dialogs: accepted only while saving (a "confirm save?" prompt),
// dismissed otherwise.  Their text is kept for the log.
const dialogState = { accept: false, messages: [] };

function handleDialog(dialog) {
    dialogState.messages.push(`${dialog.type()}: ${dialog.message()}`);
    logger.info(`💬 [Endpoint] Browser ${dialog.type()} "${dialog.message()}" -> ${dialogState.accept ? 'accept' : 'dismiss'}`);
    return (dialogState.accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
}

/**
 * Clicks save, confirms any in-page "are you sure" prompt, and treats the
 * print prompt (or a success message) as proof the record was saved.
 */
async function save(page) {
    dialogState.accept = true;
    dialogState.messages = [];
    // One page-side routine for every modal step, so detecting a prompt and
    // clicking it always look at the same element.  Modals are position:fixed,
    // which makes offsetParent null, so visibility is checked by size instead.
    const modalStep = action => page.evaluate(step => {
        const visible = el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const modal = [...document.querySelectorAll('.modal.show, .modal[style*="display: block"], [role="dialog"], .swal2-popup')].find(visible);
        const buttons = [...(modal || document).querySelectorAll('button, a')].filter(visible);
        const text = modal ? modal.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (step === 'confirm') {
            buttons.find(el => /^(ยืนยัน|ตกลง|ใช่|OK|Yes)$/i.test(el.innerText.trim()))?.click();
        } else if (step === 'close') {
            buttons.filter(el => /^(ยกเลิก|ปิด)$/.test(el.innerText.trim())).pop()?.click();
        }
        return {
            text,
            printable: buttons.some(el => /พิมพ์/.test(el.innerText)),
            hasConfirm: !!modal && buttons.some(el => /^(ยืนยัน|ตกลง|ใช่|OK|Yes)$/i.test(el.innerText.trim()))
        };
    }, action);

    try {
        if (!(await clickButtonByText(page, /^บันทึก$/))) throw new Error('ไม่พบปุ่ม "บันทึก"');
        let confirmClicks = 0;
        let state = { text: '' };
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            await sleep(1000);
            state = await modalStep('inspect');
            if (state.printable || /สำเร็จ/.test(state.text)) {
                await sleep(500);
                // Close the print prompt with its own "ยกเลิก", not the form's.
                await modalStep('close');
                return { ok: true, detail: state.text };
            }
            if (state.hasConfirm && confirmClicks < 2) {
                confirmClicks += 1;
                logger.info(`🖱️ [Endpoint] Confirming save prompt: "${state.text}"`);
                await modalStep('confirm');
            }
        }
        return { ok: false, detail: [state.text, ...dialogState.messages].filter(Boolean).join(' | ') || 'ไม่มีข้อความตอบกลับ' };
    } finally {
        dialogState.accept = false;
    }
}

export async function runEndpointBatch({ visitDate = today(), dryRun = true, limit = 10, vn = null } = {}) {
    if (!dryRun && visitDate !== today()) {
        throw new Error('บันทึกจริงได้เฉพาะวันนี้ (วันที่เข้ารับบริการในฟอร์มตั้งเป็นวันนี้อัตโนมัติ)');
    }
    fs.mkdirSync(outDir, { recursive: true });
    await ensureLogTable();

    const candidates = [];
    for (const row of await getEndpointCandidates(visitDate)) {
        if (vn && row.vn !== vn) continue;
        if (!(await alreadySaved(row.vn))) candidates.push(row);
    }
    const batch = candidates.slice(0, limit);
    const mode = dryRun ? 'ทดลอง (ไม่บันทึก)' : 'บันทึกจริง';
    logger.info(`🩺 [Endpoint] ${mode}: ${batch.length}/${candidates.length} case(s) for ${visitDate}`);
    if (batch.length === 0) {
        await sendTelegram(`🩺 Endpoint ${visitDate}: ไม่มีรายการที่ต้องทำ`);
        return { processed: 0 };
    }
    const total = batch.reduce((sum, row) => sum + Number(row.uc_money), 0);
    await sendTelegram(`🩺 เริ่ม Endpoint ${visitDate} — ${mode}\n${batch.length} ราย รวม ${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท${dryRun ? '' : '\nแต่ละรายจะส่ง QR มาให้ผู้รับรองสแกน ตรวจยอดและเหตุผลก่อนสแกนทุกครั้ง'}`);

    const holderId = createSchedulerHolderId();
    if (!(await acquirePortalLock(holderId))) throw new Error('มีงาน สปสช. อื่นกำลังทำงานอยู่ ลองใหม่อีกครั้ง');

    const results = { saved: 0, dry_run: 0, skipped: 0, failed: 0 };
    let browser;
    try {
        browser = await puppeteer.launch(getPuppeteerLaunchOptions({ userDataDir: sessionPath }));
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        page.on('dialog', handleDialog);

        const loginQr = createTelegramQrNotifier(telegramTarget().token, telegramTarget().chatIds);
        const login = await loginWithThaid(page, {
            portalUrl: PORTAL_URL,
            onQr: ({ buffer, refCode, round }) => loginQr.show(buffer, `📲 [Endpoint] สแกน ThaiD เพื่อเข้าสู่ระบบ สปสช.\nเลขอ้างอิง: ${refCode || '-'} (รอบที่ ${round})`)
        });
        if (!login.authenticated) throw new Error('เข้าสู่ระบบ ThaiD ไม่สำเร็จ');
        if (login.rounds > 0) await loginQr.finish('✅ เข้าสู่ระบบแล้ว กำลังเริ่ม Endpoint');

        for (const [index, row] of batch.entries()) {
            const amount = Number(row.uc_money).toFixed(2);
            let reason = null;
            try {
                reason = await fillForm(page, row);
                const caption = `🩺 Endpoint ราย ${index + 1}/${batch.length}\nVN ${row.vn} • อายุ ${row.age_y} ปี\nค่าบริการที่เบิกได้ ${amount} บาท\nเหตุผล: ${reason}`;
                const shot = path.join(outDir, `${visitDate}-${row.vn}.png`);
                await page.screenshot({ path: shot, fullPage: true });

                if (dryRun) {
                    await sendTelegram(`${caption}\n(ทดลอง — ยังไม่บันทึก)`, shot);
                    await logCase(row, reason, 'dry_run');
                    results.dry_run += 1;
                    continue;
                }

                if (!(await officerScan(page, row, caption))) {
                    await logCase(row, reason, 'not_scanned', 'QR ผู้รับรองหมดอายุครบทุกรอบ');
                    results.skipped += 1;
                    continue;
                }
                if (!(await formLooksFilled(page, row))) throw new Error('ข้อมูลในฟอร์มหายหลังสแกน — ไม่บันทึก');
                if (!(await selectProxyRole(page))) {
                    throw Object.assign(new Error(`ไม่พบตัวเลือก "${PROXY_ROLE}" ในฟอร์ม — ไม่บันทึก`), { status: 'needs_review' });
                }
                const saved = await save(page);
                if (!saved.ok) {
                    await page.screenshot({ path: shot, fullPage: true });
                    await logCase(row, reason, 'save_unconfirmed', `กดบันทึกแล้วไม่เห็นหน้าพิมพ์: ${saved.detail}`);
                    await sendTelegram(`⚠️ ราย ${index + 1} (VN ${row.vn}): กดบันทึกแล้วไม่เห็นหน้าพิมพ์ — หยุดทั้งชุด ให้ตรวจในเว็บ สปสช. ก่อน\nข้อความจากหน้าเว็บ: ${saved.detail}`, shot);
                    results.failed += 1;
                    break; // Never continue blindly after an unconfirmed save.
                }
                await logCase(row, reason, 'saved', saved.detail || null);
                results.saved += 1;
                await sendTelegram(`✅ บันทึก Endpoint ราย ${index + 1}/${batch.length} แล้ว (VN ${row.vn})`);
            } catch (err) {
                const status = err.status || 'failed';
                logger.warn({ err: err.message }, `⚠️ [Endpoint] VN ${row.vn}:`);
                await logCase(row, reason, status, err.message).catch(() => {});
                await sendTelegram(`⚠️ ข้ามราย ${index + 1} (VN ${row.vn}): ${err.message}`);
                if (status === 'failed') results.failed += 1; else results.skipped += 1;
            }
        }
    } finally {
        await browser?.close().catch(() => {});
        await releaseSchedulerLock(trackerPool, PORTAL_LOCK_KEY, holderId).catch(() => {});
    }

    const summary = dryRun
        ? `🩺 จบการทดลอง Endpoint ${visitDate}: เติมฟอร์มแล้ว ${results.dry_run} ราย, ข้าม ${results.skipped}, ผิดพลาด ${results.failed}`
        : `🩺 จบ Endpoint ${visitDate}: บันทึก ${results.saved} ราย, ข้าม ${results.skipped}, ผิดพลาด ${results.failed}`;
    await sendTelegram(summary);
    logger.info(summary);
    return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const valueOf = flag => {
        const index = args.indexOf(flag);
        return index >= 0 ? args[index + 1] : undefined;
    };
    runEndpointBatch({
        visitDate: valueOf('--date') || today(),
        dryRun: !args.includes('--save'),
        limit: Number(valueOf('--limit')) || 10,
        vn: valueOf('--vn') || null
    })
        .catch(err => logger.error({ err: err.message }, '❌ [Endpoint] Batch failed:'))
        .finally(() => process.exit(0));
}
