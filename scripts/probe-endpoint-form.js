import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getPuppeteerLaunchOptions } from '../backend/puppeteerHelper.js';
import { trackerPool } from '../backend/db.js';
import { createSchedulerHolderId, releaseSchedulerLock } from '../backend/schedulerLock.js';
import { acquirePortalLock, PORTAL_LOCK_KEY } from '../jobs/keep-alive-nhso.js';
import { loginWithThaid, createTelegramQrNotifier, readThaidQr } from '../jobs/thaidLogin.js';

// Read-only survey of the NHSO "create endpoint" form, used to plan automation.
// It NEVER clicks save.  Usage on the server (worker can stay running):
//   node scripts/probe-endpoint-form.js                 # form structure only
//   node scripts/probe-endpoint-form.js 1234567890123   # also search one CID and open the officer ThaiD QR (still no save)
// Output: downloads/endpoint-probe/*.json + *.png (downloads/ is git-ignored: may contain patient data).

dotenv.config({ quiet: true });
puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(__dirname, '../puppeteer_session');
const outDir = path.join(__dirname, '../downloads/endpoint-probe');
const PORTAL_URL = process.env.NHSO_PORTAL_URL || 'https://authenservice.nhso.go.th/authencode/';
const FORM_URL = 'https://authenservice.nhso.go.th/authencode/nhso-endpoint/create/own';

const cid = process.argv[2];
if (cid && !/^\d{13}$/.test(cid)) {
    console.error('❌ เลขบัตรต้องเป็นตัวเลข 13 หลัก');
    process.exit(1);
}

/** Describes every visible control on the page, including custom dropdowns. */
function describeForm() {
    const visible = el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const clean = text => (text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const labelFor = el => {
        if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return clean(label.innerText);
        }
        const wrapping = el.closest('label');
        if (wrapping) return clean(wrapping.innerText);
        // Nearest preceding text in the same form group.
        const group = el.closest('.form-group, .mb-3, .row, .col, div');
        return group ? clean(group.innerText).slice(0, 120) : '';
    };
    const selectorOf = el => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        const cls = [...el.classList].slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
        return `${el.tagName.toLowerCase()}${cls}`;
    };

    const controls = [...document.querySelectorAll('input, select, textarea, [role="combobox"], [role="listbox"], .ng-select, .v-select, .multiselect')]
        .filter(visible)
        .map(el => ({
            tag: el.tagName.toLowerCase(),
            type: el.type || el.getAttribute('role') || null,
            selector: selectorOf(el),
            name: el.name || null,
            placeholder: el.placeholder || null,
            maxLength: el.maxLength > 0 ? el.maxLength : null,
            value: el.type === 'checkbox' || el.type === 'radio' ? el.checked : clean(el.value),
            disabled: !!el.disabled,
            required: !!el.required,
            label: labelFor(el),
            options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: clean(o.text) })) : undefined
        }));

    const buttons = [...document.querySelectorAll('button, a.btn, input[type="submit"]')]
        .filter(visible)
        .map(el => ({ text: clean(el.innerText || el.value), selector: selectorOf(el), type: el.type || null, disabled: !!el.disabled }));

    return { url: location.href, title: document.title, controls, buttons, text: clean(document.body.innerText).slice(0, 4000) };
}

async function snapshot(page, name) {
    const info = await page.evaluate(describeForm);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(info, null, 2));
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    console.log(`\n=== ${name} (${info.url}) ===`);
    for (const c of info.controls) {
        console.log(`• ${c.tag}${c.type ? `[${c.type}]` : ''} ${c.selector} — "${c.label.slice(0, 70)}"${c.placeholder ? ` placeholder="${c.placeholder}"` : ''}${c.required ? ' (required)' : ''}`);
        for (const o of c.options || []) console.log(`    - ${o.value}: ${o.text}`);
    }
    console.log(`buttons: ${info.buttons.map(b => `"${b.text}"${b.disabled ? '(disabled)' : ''}`).join(', ')}`);
    return info;
}

async function run() {
    fs.mkdirSync(outDir, { recursive: true });
    const holderId = createSchedulerHolderId();
    if (!(await acquirePortalLock(holderId))) {
        console.error('❌ มีงานดาวน์โหลด สปสช. กำลังทำงานอยู่ ลองใหม่อีกครั้งในไม่กี่นาที');
        return;
    }

    let browser;
    try {
        browser = await puppeteer.launch(getPuppeteerLaunchOptions({ userDataDir: sessionPath }));
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        const telegramChatIds = (process.env.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean);
        const telegramQr = createTelegramQrNotifier(process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN, telegramChatIds);
        const login = await loginWithThaid(page, {
            portalUrl: PORTAL_URL,
            onQr: async ({ buffer, refCode, round }) => {
                console.log(`📲 session หมดอายุ — สแกน QR ใน Telegram (ref ${refCode}, รอบ ${round})`);
                await telegramQr.show(buffer, `📲 [สำรวจฟอร์ม Endpoint] สแกน ThaiD เพื่อเข้าสู่ระบบ\nเลขอ้างอิง: ${refCode || '-'} (รอบที่ ${round})`);
            }
        });
        if (!login.authenticated) throw new Error('เข้าสู่ระบบ ThaiD ไม่สำเร็จ');
        if (login.rounds > 0) await telegramQr.finish('✅ สแกนสำเร็จ กำลังสำรวจฟอร์ม Endpoint (ไม่บันทึกข้อมูล)');

        await page.goto(FORM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        await snapshot(page, '1-form');

        // The page opens on the patient self-verification tab; the endpoint flow
        // used by staff is the guardian/officer tab.  Tabs are styled radios/labels.
        // Use the innermost element carrying the tab text and a real mouse click
        // (some frameworks ignore synthetic element.click()).
        const tabHandle = await page.evaluateHandle(() => [...document.querySelectorAll('label, button, a, li, span, div')]
            .filter(el => /ยืนยันตัวตนแทนผู้เข้ารับบริการ/.test(el.innerText || '') && (el.innerText || '').length < 120)
            .pop() || null);
        const tabInfo = await tabHandle.evaluate(el => el && { tag: el.tagName.toLowerCase(), id: el.id, for: el.getAttribute('for'), cls: el.className, text: el.innerText.trim() });
        if (tabInfo) {
            await tabHandle.asElement().click();
            console.log(`\n🗂️ คลิกแท็บ <${tabInfo.tag}${tabInfo.id ? ` id="${tabInfo.id}"` : ''}${tabInfo.for ? ` for="${tabInfo.for}"` : ''} class="${tabInfo.cls}"> "${tabInfo.text}"`);
        } else {
            console.log('\n⚠️ ไม่พบแท็บ "ยืนยันตัวตนแทนผู้เข้ารับบริการ"');
        }
        const textInputAppeared = await page.waitForFunction(
            () => [...document.querySelectorAll('input')].some(i => !['radio', 'checkbox', 'hidden', 'submit', 'button'].includes(i.type) && i.offsetParent !== null),
            { timeout: 8000 }
        ).then(() => true, () => false);
        const proxyTab = await snapshot(page, '1b-proxy-tab');
        if (!textInputAppeared) {
            // Print every input, hidden ones included, to see how the tabs are built.
            const allInputs = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].map(el => ({
                tag: el.tagName.toLowerCase(), type: el.type, id: el.id, name: el.name, value: el.type === 'radio' ? `${el.value}${el.checked ? ' (checked)' : ''}` : '',
                visible: el.offsetParent !== null, placeholder: el.placeholder || ''
            })));
            console.log('\n🔎 ทุกช่องในหน้า (รวมช่องที่ซ่อนอยู่):');
            for (const i of allInputs) console.log(`   ${i.visible ? '👁' : '🙈'} ${i.tag}[${i.type}] id="${i.id}" name="${i.name}" ${i.value} ${i.placeholder}`);
        }

        if (cid) {
            // Type the CID into the 13-digit text field and search; never save.
            const textInputs = proxyTab.controls.filter(c => c.tag === 'input' && !['radio', 'checkbox', 'submit', 'button', 'hidden'].includes(c.type));
            const target = textInputs.find(c => c.maxLength === 13)
                || textInputs.find(c => /13|เลข|บัตร|pid|cid/i.test(`${c.placeholder} ${c.label} ${c.name}`))
                || textInputs[0];
            if (!target) throw new Error('ไม่พบช่องกรอกเลขบัตรประชาชน — ดูรายการช่องด้านบน');
            await page.type(target.selector, cid, { delay: 30 });
            const searched = await page.evaluate(() => {
                const button = [...document.querySelectorAll('button')].find(el => el.innerText.trim() === 'ค้นหา');
                button?.click();
                return !!button;
            });
            if (!searched) await page.keyboard.press('Enter');
            console.log(`\n✍️ กรอกเลขบัตรลงช่อง ${target.selector} แล้ว${searched ? 'กดปุ่ม "ค้นหา"' : 'กด Enter'} (ค้นหาเท่านั้น)`);
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 20000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 2000));
            await snapshot(page, '2-after-search');

            // The officer must confirm each endpoint by scanning ThaiD.  Find out
            // where that QR appears (popup window or in-page modal); still no save.
            const popup = new Promise(resolve => {
                browser.once('targetcreated', target => resolve(target));
                setTimeout(() => resolve(null), 8000);
            });
            const clicked = await page.evaluate(() => {
                const button = [...document.querySelectorAll('button, a')].find(el => /สแกน\s*ThaiD/i.test(el.innerText));
                button?.click();
                return !!button;
            });
            if (!clicked) {
                console.log('\n⚠️ ไม่พบปุ่ม "คลิกเพื่อสแกน ThaiD QR code"');
            } else {
                const target = await popup;
                const qrPage = target?.type() === 'page' ? await target.page() : null;
                await new Promise(resolve => setTimeout(resolve, 5000));
                const where = qrPage || page;
                const qr = await readThaidQr(where);
                console.log(`\n📲 ปุ่มสแกน ThaiD ของผู้รับรอง: QR ${qrPage ? 'เปิดในหน้าต่างใหม่' : 'อยู่ในหน้าเดิม'} — ${where.url()}`);
                console.log(qr ? `   พบรูป QR (ref ${qr.refCode || '-'}, หมดอายุใน ${qr.secondsLeft}s)` : '   ไม่พบรูป QR แบบ data:image — ดูภาพ 3-officer-qr.png');
                await snapshot(where, '3-officer-qr');
            }
        }

        console.log(`\n✅ เสร็จแล้ว (ไม่ได้กดบันทึก) ไฟล์อยู่ที่ ${outDir}`);
    } finally {
        await browser?.close().catch(() => {});
        await releaseSchedulerLock(trackerPool, PORTAL_LOCK_KEY, holderId).catch(() => {});
    }
}

run()
    .catch(err => console.error('❌', err.message))
    .finally(() => process.exit(0));
