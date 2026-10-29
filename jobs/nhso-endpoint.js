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
import { bangkokNowHHMM, chooseEndpointReason, endpointTimes, getEndpointCandidates } from '../backend/endpointCandidates.js';
import { acquirePortalLock, PORTAL_LOCK_KEY } from './keep-alive-nhso.js';
import { createTelegramQrNotifier, isThaidExpiredUrl, loginWithThaid, readThaidQr, thaidOpenPageUrl } from './thaidLogin.js';

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
// Several job modules share the puppeteer-extra singleton; register stealth once.
if (!puppeteer.plugins.some(plugin => plugin.name === 'stealth')) puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(__dirname, '../puppeteer_session');
const outDir = path.join(__dirname, '../downloads/endpoint-runs');
const PORTAL_URL = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
const BEHALF_URL = 'https://authenservice.nhso.go.th/authencode/nhso-endpoint/create/behalf';
const OFFICER_SCAN_ATTEMPTS = 3;
// Who certifies on the patient's behalf (hospital decision): ผู้รับรอง =
// เจ้าหน้าที่ผู้บันทึกข้อมูล, ความสัมพันธ์ = เจ้าหน้าที่ผู้ดูแล.  See setCertifier.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

// Who the running batch belongs to.  A batch started by a person sends its QR
// codes and results only to that person's Telegram and is logged under their
// name; otherwise the shared TELEGRAM_CHAT_ID chats are used.  One batch runs at
// a time per process (the portal lock), so module state is enough.
const batchContext = { chatIds: null, requestedBy: null, progress: null };

// Live updates for the web popup: { qr } shows/clears a QR, { event } adds a result line.
function reportProgress(update) {
    try { batchContext.progress?.(update); } catch { /* the popup is best effort */ }
}

const STATUS_EVENT = {
    saved: '✅ บันทึกแล้ว',
    dry_run: '👁️ เติมฟอร์มแล้ว (ทดลอง)',
    not_scanned: '⌛ ข้าม: ไม่ได้สแกน QR ผู้รับรอง',
    needs_review: '🔎 ข้าม: ต้องตรวจเอง',
    no_reason: '⚠️ ข้าม: ไม่มีเหตุผลที่ตรงเงื่อนไข',
    save_unconfirmed: '❓ กดบันทึกแล้วไม่ได้รับการยืนยัน',
    failed: '❌ ผิดพลาด'
};

function telegramTarget() {
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = batchContext.chatIds
        || (process.env.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean);
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
    const [cols] = await trackerPool.query("SHOW COLUMNS FROM nhso_endpoint_log LIKE 'requested_by'");
    if (cols.length === 0) {
        await trackerPool.query('ALTER TABLE nhso_endpoint_log ADD COLUMN requested_by VARCHAR(100) NULL AFTER message');
    }
}

async function logCase(row, reason, status, message = null) {
    await trackerPool.query(
        'INSERT INTO nhso_endpoint_log (vn, cid, visit_date, amount, reason, status, message, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [row.vn, row.cid, row.vstdate, Number(row.uc_money), reason, status, message, batchContext.requestedBy]
    );
    const label = STATUS_EVENT[status] || status;
    reportProgress({ event: `${label} — VN ${row.vn} (${Number(row.uc_money).toFixed(2)} บาท)${status !== 'saved' && status !== 'dry_run' && message ? `: ${message}` : ''}` });
}

// Reasons offered by the NHSO behalf form (read from the live form, 2026-10-24),
// used to suggest a reason when staff do the endpoint by hand.
const PORTAL_REASON_OPTIONS = [
    'เกิดอุบัติเหตุฉุกเฉิน',
    'หมดสติ',
    'บัตรประจำตัวประชาชนไม่มี chip card',
    'ทหารเกณฑ์/ผู้ต้องขัง ไม่พกบัตรประจำตัวประชาชน',
    'ผู้เข้ารับบริการ เป็น เด็กอายุต่ำกว่า 7 ปี',
    'ผู้เข้ารับบริการ เป็น เด็กอายุต่ำกว่า 15 ปี หรือยังไม่มีบัตรประจำตัวประชาชน'
];

/** Today's endpoint cases for the card-reader guide, with the reason the bot would pick. */
export async function listManualEndpointCases(visitDate = today()) {
    await ensureLogTable();
    const rows = await getEndpointCandidates(visitDate);
    const cases = [];
    for (const row of rows) {
        cases.push({
            vn: row.vn,
            cid: row.cid,
            age: row.age_y,
            amount: Number(row.uc_money).toFixed(2),
            department: row.department,
            reason: chooseEndpointReason(Number(row.age_y), PORTAL_REASON_OPTIONS),
            done: await alreadySaved(row.vn),
            ...(({ service, claim, ready }) => ({ serviceTime: service, claimTime: claim, ready }))(endpointTimes(row.vsttime, bangkokNowHHMM()))
        });
    }
    return cases;
}

const MANUAL_METHOD_LABEL = {
    manual: 'ทำด้วยมือ (เครื่องอ่านบัตร Smart Card)',
    extension: 'ส่วนเสริม Chrome อัตโนมัติ (เครื่องอ่านบัตร Smart Card)'
};

/** Records an endpoint completed in the NHSO portal on a staff PC (by hand or by the Chrome helper). */
// status 'save_unconfirmed': save was clicked but the portal never confirmed it;
// the case is then held back (like the server bot) until staff check the portal.
export async function recordManualEndpoint(vn, username, visitDate = today(), method = 'manual', status = 'saved', note = null) {
    await ensureLogTable();
    const row = (await getEndpointCandidates(visitDate)).find(r => r.vn === String(vn));
    if (!row) throw new Error('ไม่พบ VN นี้ในรายการที่ต้องทำ Endpoint วันนี้');
    if (await alreadySaved(row.vn)) return { already: true };
    await trackerPool.query(
        'INSERT INTO nhso_endpoint_log (vn, cid, visit_date, amount, reason, status, message, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [row.vn, row.cid, row.vstdate, Number(row.uc_money), chooseEndpointReason(Number(row.age_y), PORTAL_REASON_OPTIONS), status, [MANUAL_METHOD_LABEL[method] || MANUAL_METHOD_LABEL.manual, note].filter(Boolean).join(': ').slice(0, 1000), username]
    );
    return { already: false };
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

// Certifier controls on the behalf form (ids taken from the live page).
const CERTIFIER_IDS = {
    caregiver: 'guarantorType_T',     // ผู้ดูแล — clicking it opens the no-caregiver warning
    recorder: 'guarantorType_S',      // เจ้าหน้าที่ผู้บันทึกข้อมูล — the value the hospital wants
    relation: 'guarantor_relation-nosmc'
};

/** Reads the certifier section by id: which ผู้รับรอง is chosen and the ความสัมพันธ์ text. */
function readCertifier(page) {
    return page.evaluate(ids => {
        const textOf = input => (document.querySelector(`label[for="${input.id}"]`)?.innerText || input.id).trim();
        const roles = [...document.querySelectorAll('input[id^="guarantorType_"]')];
        const relation = document.getElementById(ids.relation);
        return {
            chosen: roles.filter(r => r.checked).map(textOf)[0] || null,
            recorderChecked: !!document.getElementById(ids.recorder)?.checked,
            recorderDisabled: !!document.getElementById(ids.recorder)?.disabled,
            caregiverChecked: !!document.getElementById(ids.caregiver)?.checked,
            caregiverEnabled: !!document.getElementById(ids.caregiver) && !document.getElementById(ids.caregiver).disabled,
            relationText: relation ? relation.options[relation.selectedIndex]?.text.trim() : null,
            relationHasOption: !!relation && [...relation.options].some(o => o.text.trim() === 'เจ้าหน้าที่ผู้ดูแล'),
            roles: roles.map(r => `${r.checked ? '●' : '○'}${r.disabled ? '(ปิด)' : ''} ${textOf(r)}`)
        };
    }, CERTIFIER_IDS);
}

/** Clicks "ยืนยันไม่มีผู้ดูแล" if that warning is (or becomes) visible within timeoutMs. */
async function confirmNoCaregiver(page, timeoutMs) {
    const button = await page.waitForFunction(
        () => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'ยืนยันไม่มีผู้ดูแล' && b.getBoundingClientRect().width > 0) || null,
        { timeout: timeoutMs }
    ).catch(() => null);
    if (!button?.asElement()) return false;
    await button.asElement().click();
    logger.info('🖱️ [Endpoint] Confirmed "ยืนยันไม่มีผู้ดูแล"');
    return true;
}

/**
 * Sets the certifier section that appears after the officer scan:
 * click ผู้ดูแล → confirm "ยืนยันไม่มีผู้ดูแล" (the portal then chooses
 * เจ้าหน้าที่ผู้บันทึกข้อมูล) → ความสัมพันธ์ = เจ้าหน้าที่ผู้ดูแล.
 * Every step is logged; returns { ok, detail, dom } after reading back.
 */
export async function setCertifier(page) {
    await page.waitForSelector(`#${CERTIFIER_IDS.recorder}`, { timeout: 15000 }).catch(() => {});
    let state = await readCertifier(page);
    logger.info(`👤 [Endpoint] Certifier before: ${state.roles.join(', ')} | ความสัมพันธ์=${state.relationText}`);

    // The warning usually opens by itself right after the officer scan, with
    // every ผู้รับรอง choice disabled until it is answered.
    if (await confirmNoCaregiver(page, 5000)) {
        await page.waitForFunction(id => document.getElementById(id)?.checked, { timeout: 5000 }, CERTIFIER_IDS.recorder).catch(() => {});
        state = await readCertifier(page);
    }

    // No role chosen yet: clicking ผู้ดูแล opens the warning whose confirmation
    // selects the recorder.  If the portal already chose ผู้ดูแล itself, leave it.
    if (!state.recorderChecked && !state.caregiverChecked && state.caregiverEnabled) {
        // Otherwise clicking ผู้ดูแล opens it.
        await page.click(`label[for="${CERTIFIER_IDS.caregiver}"]`).catch(() => page.click(`#${CERTIFIER_IDS.caregiver}`));
        if (!(await confirmNoCaregiver(page, 5000))) {
            logger.warn('⚠️ [Endpoint] No "ยืนยันไม่มีผู้ดูแล" warning appeared after clicking ผู้ดูแล');
        }
        await page.waitForFunction(id => document.getElementById(id)?.checked, { timeout: 5000 }, CERTIFIER_IDS.recorder).catch(() => {});
        state = await readCertifier(page);
    }

    if ((state.recorderChecked || state.caregiverChecked) && state.relationText !== 'เจ้าหน้าที่ผู้ดูแล') {
        await page.waitForFunction(id => {
            const select = document.getElementById(id);
            return select && [...select.options].some(o => o.text.trim() === 'เจ้าหน้าที่ผู้ดูแล');
        }, { timeout: 5000 }, CERTIFIER_IDS.relation).catch(() => {});
        await page.evaluate(id => {
            const select = document.getElementById(id);
            const option = select && [...select.options].find(o => o.text.trim() === 'เจ้าหน้าที่ผู้ดูแล');
            if (!option) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }, CERTIFIER_IDS.relation);
        await sleep(500);
        state = await readCertifier(page);
    }

    logger.info(`👤 [Endpoint] Certifier after: ${state.roles.join(', ')} | ความสัมพันธ์=${state.relationText}`);
    // Two states the portal produces, both with ความสัมพันธ์ = เจ้าหน้าที่ผู้ดูแล:
    // (a) เจ้าหน้าที่ผู้บันทึกข้อมูล after "ยืนยันไม่มีผู้ดูแล" — the hospital's choice;
    // (b) ผู้ดูแล preselected by the portal with the recorder option disabled.
    const roleOk = state.recorderChecked || (state.caregiverChecked && state.recorderDisabled);
    const ok = roleOk && state.relationText === 'เจ้าหน้าที่ผู้ดูแล';
    return {
        ok,
        detail: `ผู้รับรอง=${state.chosen || 'ยังไม่ได้เลือก'}, ความสัมพันธ์=${state.relationText || 'ไม่พบ'}`,
        dom: ok ? null : { choices: state.roles, relationHtml: `มีตัวเลือก "เจ้าหน้าที่ผู้ดูแล": ${state.relationHasOption}` }
    };
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

    // Times (hospital rule): service = HOSxP visit time, claim = service + fixed offset.
    // Inputs in form order: service HH, MM, claim HH, MM.
    const times = endpointTimes(row.vsttime, bangkokNowHHMM());
    if (!times.ready) throw Object.assign(new Error(`ยังไม่ถึงเวลาเบิกสิทธิ (${times.claim || '-'})`), { status: 'not_ready' });
    const timeInputs = await page.$$('input.ngb-tp-input');
    if (timeInputs.length < 4) throw new Error('ไม่พบช่องเวลาในฟอร์ม');
    const [sh, sm] = times.service.split(':');
    const [ch, cm] = times.claim.split(':');
    for (const [input, value] of [[timeInputs[0], sh], [timeInputs[1], sm], [timeInputs[2], ch], [timeInputs[3], cm]]) {
        await input.click({ clickCount: 3 });
        await input.type(value, { delay: 20 });
        await input.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));
    }
    row.formTimes = times;

    const serviceTypeChecked = await page.$eval('#servicetype0', el => el.checked);
    if (!serviceTypeChecked) await page.click('#servicetype0');
    return reason;
}

/** Reads back the values that must still be on the form before saving. */
async function formLooksFilled(page, row) {
    return page.evaluate(expected => {
        const paid = document.querySelector('#paidAmount')?.value || '';
        const reason = document.querySelector('#identity-reason')?.selectedIndex > 0;
        const serviceType = document.querySelector('#servicetype0')?.checked;
        const t = [...document.querySelectorAll('input.ngb-tp-input')].map(i => String(Number(i.value)).padStart(2, '0'));
        const timesOk = !expected.times || (`${t[0]}:${t[1]}` === expected.times.service && `${t[2]}:${t[3]}` === expected.times.claim);
        return Number(paid) === Number(expected.amount) && reason && serviceType && timesOk;
    }, { amount: Number(row.uc_money).toFixed(2), times: row.formTimes || null });
}

/** Sends the officer QR to Telegram and waits for the scan.  Returns true when scanned. */
/**
 * True only when the browser is really on the NHSO endpoint form.  Checked on
 * host + path: ThaiD's own URLs carry the form's address in redirect_uri, so a
 * plain substring test matches ThaiD's error page too.
 */
function isEndpointFormUrl(url) {
    try {
        const { host, pathname } = new URL(url);
        return host === 'authenservice.nhso.go.th' && pathname.includes('/nhso-endpoint/');
    } catch {
        return false;
    }
}

/** Screenshot + where we are + what the page says, sent to Telegram, for a step that went wrong. */
async function reportPageState(page, row, label) {
    const shot = path.join(outDir, `${row.vstdate}-${row.vn}-${label}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const text = await page.evaluate(() => document.body?.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) || '').catch(() => '');
    const where = page.url().replace(/txID=[^&]+/, 'txID=…').replace(/AUTHEN-[^&]+/, 'AUTHEN-…').replace(/code=[^&]+/, 'code=…');
    logger.warn(`🔎 [Endpoint] ${label} VN ${row.vn}: ${where} | text="${text}"`);
    await sendTelegram(`🔎 ${label} (VN ${row.vn})\nหน้า: ${where}\nข้อความบนหน้า: ${text || '-'}`, shot);
    return { where, text };
}

/** After ThaiD sends us back, the filled form must be on the page; otherwise report what is. */
async function waitForFormBack(page, row) {
    const ok = await page.waitForSelector('#paidAmount', { timeout: 20000 }).then(() => true, () => false);
    if (ok) return;
    const { where, text } = await reportPageState(page, row, 'กลับจาก ThaiD แต่ไม่พบฟอร์ม');
    throw Object.assign(new Error(`กลับจาก ThaiD แต่ไม่พบฟอร์ม (หน้า ${where.split('?')[0]}: ${text.slice(0, 60) || 'ว่าง'})`), { notified: true });
}

async function officerScan(page, row, caption) {
    for (let attempt = 1; attempt <= OFFICER_SCAN_ATTEMPTS; attempt += 1) {
        if (!(await clickButtonByText(page, /สแกน\s*ThaiD/))) throw new Error('ไม่พบปุ่ม "คลิกเพื่อสแกน ThaiD QR code"');
        await page.waitForFunction(() => location.host.includes('imauth.bora.dopa.go.th'), { timeout: 20000 });
        // Wait for the QR, or for the portal to take us straight back (already confirmed).
        await page.waitForFunction(
            () => [...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').startsWith('data:image'))
                || (location.host.includes('authenservice.nhso.go.th') && location.pathname.includes('/nhso-endpoint/')),
            { timeout: 30000 }
        ).catch(() => {});
        // ThaiD refused the portal's request (seen since 2026-10-28: redirect_uri mismatch).
        const refusal = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            return /"error"\s*:\s*"invalid_request"|redirect or callback url mismatch/i.test(text) ? text.slice(0, 200) : null;
        }).catch(() => null);
        if (refusal) {
            await reportPageState(page, row, 'ThaiD ปฏิเสธคำขอผู้รับรอง');
            // A portal-side fault: every remaining case would fail the same way.
            throw Object.assign(new Error('ThaiD ปฏิเสธคำขอสแกนผู้รับรอง (redirect url mismatch) — ปัญหาฝั่ง สปสช./ThaiD ทำด้วยมือก็ไม่ได้ หยุดทั้งชุด'), { notified: true, abortBatch: true });
        }
        if (isEndpointFormUrl(page.url())) {
            logger.info(`🖱️ [Endpoint] VN ${row.vn}: ThaiD returned without a QR (already confirmed)`);
            await waitForFormBack(page, row);
            await sleep(1500);
            return true;
        }
        const qr = await readThaidQr(page);
        if (!qr) {
            const { text } = await reportPageState(page, row, 'ไม่พบ QR ผู้รับรอง');
            throw Object.assign(new Error(`ไม่พบ QR ของผู้รับรอง (หน้า ThaiD แสดง: ${text.slice(0, 80) || 'ว่าง'})`), { notified: true });
        }

        const notifier = createTelegramQrNotifier(telegramTarget().token, telegramTarget().chatIds);
        await notifier.show(qr.buffer || Buffer.from(qr.dataUrl.split(',')[1], 'base64'), `${caption}\nเลขอ้างอิง ${qr.refCode || '-'} • QR อายุ ~1 นาที`, thaidOpenPageUrl(qr.txId));
        reportProgress({ qr: { kind: 'officer', dataUrl: qr.dataUrl, refCode: qr.refCode, expiresAt: new Date(Date.now() + qr.secondsLeft * 1000).toISOString(), round: attempt } });
        const expiresAt = Date.now() + qr.secondsLeft * 1000 + 5000;

        while (Date.now() < expiresAt) {
            const url = page.url();
            if (isEndpointFormUrl(url)) {
                await notifier.finish(`✅ สแกนแล้ว กำลังบันทึก\n${caption}`);
                reportProgress({ qr: null });
                await waitForFormBack(page, row);
                await sleep(1500);
                return true;
            }
            if (isThaidExpiredUrl(url)) break;
            await sleep(1500);
        }
        await notifier.finish(`⌛ QR หมดอายุ (รอบ ${attempt}/${OFFICER_SCAN_ATTEMPTS})\n${caption}`);
        reportProgress({ qr: null });
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
export async function saveEndpointForm(page) {
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

/**
 * Telegram command: "endpoint" = dry run, "endpoint บันทึก" = save,
 * optionally followed by one VN ("endpoint บันทึก 691024085344").
 * Returns null when the text is not an endpoint command.
 */
export function parseEndpointCommand(text) {
    const match = /^\/?(endpoint|ปิดสิทธิ)(?:\s+(.*))?$/i.exec(String(text || '').trim());
    if (!match) return null;
    const rest = match[2] || '';
    return {
        dryRun: !/(บันทึก|save)/i.test(rest),
        vn: (/\b(\d{12})\b/.exec(rest) || [])[1] || null
    };
}

/**
 * Runs one endpoint batch.  chatIds/requestedBy: the person who asked for it
 * (QR codes and results go only to them); omitted = shared chats, no name.
 */
export async function runEndpointBatch({ chatIds = null, requestedBy = null, ...options } = {}) {
    batchContext.chatIds = chatIds?.length ? chatIds.map(String) : null;
    batchContext.requestedBy = requestedBy;
    batchContext.progress = options.onProgress || null;
    try {
        return await runBatch(options);
    } finally {
        batchContext.chatIds = null;
        batchContext.requestedBy = null;
        batchContext.progress = null;
    }
}

// vn / vns: limit the batch to visits the person picked; picked visits that
// cannot be done are reported instead of silently dropped.
async function runBatch({ visitDate = today(), dryRun = true, limit = 10, vn = null, vns = null, onProgress = () => {} } = {}) {
    if (!dryRun && visitDate !== today()) {
        throw new Error('บันทึกจริงได้เฉพาะวันนี้ (วันที่เข้ารับบริการในฟอร์มตั้งเป็นวันนี้อัตโนมัติ)');
    }
    fs.mkdirSync(outDir, { recursive: true });
    await ensureLogTable();

    const picked = vn ? [String(vn)] : (Array.isArray(vns) && vns.length ? vns.map(String) : null);
    const candidates = [];
    const done = [];
    const waiting = []; // claim time (visit + offset) not reached yet: done in a later run
    for (const row of await getEndpointCandidates(visitDate)) {
        if (picked && !picked.includes(row.vn)) continue;
        if (await alreadySaved(row.vn)) done.push(row.vn);
        else if (!endpointTimes(row.vsttime, bangkokNowHHMM()).ready) waiting.push(`${row.vn} (เบิกได้ ${endpointTimes(row.vsttime, bangkokNowHHMM()).claim || 'ไม่มีเวลามา'})`);
        else candidates.push(row);
    }
    const notEligible = picked ? picked.filter(v => !done.includes(v) && !candidates.some(row => row.vn === v) && !waiting.some(w => w.startsWith(v))) : [];
    const skippedNote = [
        done.length ? `ทำไปแล้ว: ${done.join(', ')}` : '',
        notEligible.length ? `ไม่อยู่ในเงื่อนไข Endpoint (ไม่ใช่ UC/ไม่มียอด/ทำแล้วหรือ Admit): ${notEligible.join(', ')}` : '',
        waiting.length ? `รอถึงเวลาเบิกสิทธิ: ${waiting.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    const batch = candidates.slice(0, limit);
    const mode = dryRun ? 'ทดลอง (ไม่บันทึก)' : 'บันทึกจริง';
    logger.info(`🩺 [Endpoint] ${mode}: ${batch.length}/${candidates.length} case(s) for ${visitDate}${picked ? ` (picked ${picked.length})` : ''}`);
    onProgress({ total: batch.length, done: 0, message: `${mode}: ${batch.length} ราย` });
    if (batch.length === 0) {
        await sendTelegram(`🩺 Endpoint ${visitDate}: ไม่มีรายการที่ต้องทำ${skippedNote ? `\n${skippedNote}` : ''}`);
        onProgress({ total: 0, done: 0, message: `ไม่มีรายการที่ต้องทำ${skippedNote ? ` — ${skippedNote.replace(/\n/g, ' • ')}` : ''}` });
        return { processed: 0 };
    }
    if (skippedNote) await sendTelegram(`ℹ️ ข้ามรายที่เลือก\n${skippedNote}`);
    const total = batch.reduce((sum, row) => sum + Number(row.uc_money), 0);
    await sendTelegram(`🩺 เริ่ม Endpoint ${visitDate} — ${mode}${batchContext.requestedBy ? ` (สั่งโดย ${batchContext.requestedBy})` : ''}\n${batch.length} ราย รวม ${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท${dryRun ? '' : '\nแต่ละรายจะส่ง QR มาให้ผู้รับรองสแกน ตรวจยอดและเหตุผลก่อนสแกนทุกครั้ง'}`);

    const holderId = createSchedulerHolderId();
    if (!(await acquirePortalLock(holderId))) throw new Error('มีงาน สปสช. อื่นกำลังทำงานอยู่ ลองใหม่อีกครั้ง');

    const results = { saved: 0, dry_run: 0, skipped: 0, failed: 0 };
    let browser;
    try {
        browser = await puppeteer.launch(getPuppeteerLaunchOptions({ userDataDir: sessionPath }));
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        page.on('dialog', handleDialog);
        // The persistent profile may hold an old copy of the NHSO web app (HTTP
        // cache / service worker) that builds outdated ThaiD redirect URLs. Drop
        // those caches every run; cookies stay, so the NHSO login is kept.
        try {
            const cdp = await page.target().createCDPSession();
            await cdp.send('Network.clearBrowserCache');
            await cdp.send('Storage.clearDataForOrigin', { origin: 'https://authenservice.nhso.go.th', storageTypes: 'service_workers,cache_storage' });
        } catch (err) {
            logger.warn({ err: err.message }, '⚠️ [Endpoint] Could not clear NHSO web app cache:');
        }

        const loginQr = createTelegramQrNotifier(telegramTarget().token, telegramTarget().chatIds);
        const login = await loginWithThaid(page, {
            portalUrl: PORTAL_URL,
            onQr: async ({ buffer, dataUrl, refCode, round, txId, expiresAt }) => {
                reportProgress({ message: 'สแกน QR ThaiD เพื่อเข้าสู่ระบบ สปสช.', qr: { kind: 'login', dataUrl, refCode, expiresAt: new Date(expiresAt).toISOString(), round } });
                await loginQr.show(buffer, `📲 [Endpoint] สแกน ThaiD เพื่อเข้าสู่ระบบ สปสช.\nเลขอ้างอิง: ${refCode || '-'} (รอบที่ ${round})`, thaidOpenPageUrl(txId));
            }
        });
        reportProgress({ qr: null });
        if (!login.authenticated) throw new Error('เข้าสู่ระบบ ThaiD ไม่สำเร็จ');
        if (login.rounds > 0) await loginQr.finish('✅ เข้าสู่ระบบแล้ว กำลังเริ่ม Endpoint');

        for (const [index, row] of batch.entries()) {
            const amount = Number(row.uc_money).toFixed(2);
            let reason = null;
            onProgress({ total: batch.length, done: index, message: `ราย ${index + 1}/${batch.length} (VN ${row.vn}, ${amount} บาท): ${dryRun ? 'กำลังเติมฟอร์ม' : 'เติมฟอร์ม แล้วรอผู้รับรองสแกน QR'}` });
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
                const certifier = await setCertifier(page);
                if (!certifier.ok) {
                    // Keep what the section looked like, so the selectors can be fixed.
                    await page.screenshot({ path: shot, fullPage: true });
                    fs.writeFileSync(shot.replace(/\.png$/, '-certifier.json'), JSON.stringify(certifier.dom, null, 2));
                    logger.warn(`🔎 [Endpoint] Certifier section VN ${row.vn}:\n  choices: ${certifier.dom.choices.join('\n           ')}\n  relation row: ${certifier.dom.relationHtml}`);
                    await sendTelegram(`🔎 ราย ${index + 1} (VN ${row.vn}): ตั้งผู้รับรองไม่ได้ (${certifier.detail}) — ไม่บันทึก`, shot);
                    throw Object.assign(new Error(`ตั้งผู้รับรองไม่ได้ (${certifier.detail}) — ไม่บันทึก`), { status: 'needs_review', notified: true });
                }
                const saved = await saveEndpointForm(page);
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
                if (!err.notified) await sendTelegram(`⚠️ ข้ามราย ${index + 1} (VN ${row.vn}): ${err.message}`);
                if (status === 'failed') results.failed += 1; else results.skipped += 1;
                if (err.abortBatch) {
                    // Tells the web popup to offer the card-reader route instead.
                    results.thaidUnavailable = true;
                    reportProgress({ thaidUnavailable: true });
                    await sendTelegram('⛔ หยุด Endpoint ทั้งชุด: ThaiD ปฏิเสธคำขอผู้รับรองจากเว็บ สปสช. (ทำด้วยมือก็ไม่ได้)\nถ้าเครื่องที่ใช้มีเครื่องอ่านบัตร Smart Card ใช้ปุ่ม "ทำด้วยเครื่องอ่านบัตร" บนหน้าเว็บแทนได้');
                    break;
                }
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
    onProgress({ total: batch.length, done: batch.length, message: summary });
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
