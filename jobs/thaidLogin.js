import fs from 'fs';
import logger from '../backend/logger.js';

// ThaiD QR codes (imauth.bora.dopa.go.th) expire after ~60 seconds and the page
// then redirects to /oauth2/close. To make unattended login practical we keep
// requesting a fresh QR until somebody scans it or the overall timeout passes.

const THAID_LOGIN_SELECTOR = 'a[href*="/broker/thaid/login"]';
const DEFAULT_QR_TTL_SECONDS = 60;

export function getThaidTimeoutMs(value = process.env.NHSO_THAID_TIMEOUT_MINUTES) {
    const minutes = Number(value);
    return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 10) * 60 * 1000;
}

export function isPortalAuthenticatedUrl(url) {
    return typeof url === 'string'
        && url.includes('authenservice.nhso.go.th/authencode')
        && !url.includes('/login');
}

export function isThaidExpiredUrl(url) {
    return typeof url === 'string' && url.includes('imauth.bora.dopa.go.th/oauth2/close');
}

/** Parses "หมดเวลาใน : 00:55" into seconds; returns null when no countdown is shown. */
export function parseThaidCountdown(text) {
    const match = /หมดเวลาใน\s*:?\s*(\d{1,2}):(\d{2})/.exec(text || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function parseThaidRefCode(text) {
    const match = /หมายเลขอ้างอิง\s*:?\s*([A-Z0-9]+)/i.exec(text || '');
    return match ? match[1] : null;
}

export function dataUrlToBuffer(dataUrl) {
    const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
    return match ? Buffer.from(match[1], 'base64') : null;
}

/** Reads the QR image and its metadata from the ThaiD page, or null if no QR is visible. */
export async function readThaidQr(page) {
    const raw = await page.evaluate(() => {
        const img = [...document.querySelectorAll('img')]
            .find(el => (el.getAttribute('src') || '').startsWith('data:image') && el.getBoundingClientRect().width >= 100);
        return { src: img ? img.getAttribute('src') : null, text: document.body?.innerText || '' };
    }).catch(() => null);
    if (!raw?.src) return null;
    return {
        dataUrl: raw.src,
        refCode: parseThaidRefCode(raw.text),
        secondsLeft: parseThaidCountdown(raw.text) ?? DEFAULT_QR_TTL_SECONDS
    };
}

/** Navigates from the portal to a fresh ThaiD QR page. Returns 'authenticated' or 'qr'. */
async function openThaidQrPage(page, portalUrl) {
    await page.goto(portalUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    if (isPortalAuthenticatedUrl(page.url()) && !(await page.$(THAID_LOGIN_SELECTOR))) {
        return 'authenticated';
    }
    await page.waitForSelector(THAID_LOGIN_SELECTOR, { timeout: 20000 });
    await Promise.all([
        page.click(THAID_LOGIN_SELECTOR),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
    ]);
    await page.waitForFunction(
        () => [...document.querySelectorAll('img')].some(el => (el.getAttribute('src') || '').startsWith('data:image')),
        { timeout: 20000 }
    ).catch(() => {});
    return isPortalAuthenticatedUrl(page.url()) ? 'authenticated' : 'qr';
}

/**
 * Logs in through ThaiD, regenerating the QR whenever it expires.
 * onQr({ dataUrl, buffer, refCode, expiresAt, round, deadline }) is called for every new QR.
 */
export async function loginWithThaid(page, { portalUrl, timeoutMs = getThaidTimeoutMs(), onQr } = {}) {
    const deadline = Date.now() + timeoutMs;
    let round = 0;

    while (Date.now() < deadline) {
        let state;
        try {
            state = await openThaidQrPage(page, portalUrl);
        } catch (err) {
            // Transient network errors must not abort a login that can still be scanned.
            logger.warn(`⚠️ [ThaiD] Could not open QR page (${err.message}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
        }
        if (state === 'authenticated') return { authenticated: true, rounds: round };

        const qr = await readThaidQr(page);
        if (!qr) {
            logger.warn(`⚠️ [ThaiD] QR image not found on ${page.url()}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
        }

        round += 1;
        const expiresAt = Date.now() + qr.secondsLeft * 1000;
        logger.info(`📲 [ThaiD] QR round ${round} ready (ref ${qr.refCode || '-'}, expires in ${qr.secondsLeft}s)`);
        if (onQr) {
            await Promise.resolve(onQr({ ...qr, buffer: dataUrlToBuffer(qr.dataUrl), expiresAt, round, deadline }))
                .catch(err => logger.warn('⚠️ [ThaiD] onQr callback failed:', err.message));
        }

        // Wait for scan, expiry, or the overall deadline.
        while (Date.now() < deadline) {
            const url = page.url();
            if (isPortalAuthenticatedUrl(url)) {
                logger.info(`🎉 [ThaiD] Scan confirmed after ${round} QR round(s).`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                return { authenticated: true, rounds: round };
            }
            // Leave a small buffer after the countdown in case the user scanned at the last second.
            if (isThaidExpiredUrl(url) || Date.now() > expiresAt + 5000) break;
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    return { authenticated: false, rounds: round };
}

/**
 * Keeps a single Telegram photo message per chat in sync with the current QR,
 * instead of posting a new photo every minute.
 */
export function createTelegramQrNotifier(token, chatIds) {
    const messages = new Map();
    const enabled = Boolean(token) && chatIds.length > 0 && process.env.DISABLE_NOTIFICATIONS !== 'true';

    async function call(method, formData) {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
        return data.result;
    }

    return {
        async show(buffer, caption) {
            if (!enabled || !buffer) return;
            for (const chatId of chatIds) {
                try {
                    const form = new FormData();
                    form.append('chat_id', chatId);
                    const blob = new Blob([buffer], { type: 'image/png' });
                    if (messages.has(chatId)) {
                        form.append('message_id', String(messages.get(chatId)));
                        form.append('media', JSON.stringify({ type: 'photo', media: 'attach://qr', caption }));
                        form.append('qr', blob, 'thaid_qr.png');
                        await call('editMessageMedia', form);
                    } else {
                        form.append('photo', blob, 'thaid_qr.png');
                        form.append('caption', caption);
                        const result = await call('sendPhoto', form);
                        messages.set(chatId, result.message_id);
                    }
                } catch (err) {
                    logger.warn(`⚠️ [ThaiD] Telegram QR update failed for ${chatId}:`, err.message);
                }
            }
        },
        async finish(caption) {
            if (!enabled) return;
            for (const [chatId, messageId] of messages) {
                try {
                    const form = new FormData();
                    form.append('chat_id', chatId);
                    form.append('message_id', String(messageId));
                    form.append('caption', caption);
                    await call('editMessageCaption', form);
                } catch (err) {
                    logger.warn(`⚠️ [ThaiD] Telegram QR finish failed for ${chatId}:`, err.message);
                }
            }
        }
    };
}

export function saveQrFile(buffer, filePath) {
    if (!buffer) return;
    try {
        fs.writeFileSync(filePath, buffer);
    } catch (err) {
        logger.warn('⚠️ [ThaiD] Could not save QR file:', err.message);
    }
}
