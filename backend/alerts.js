import logger, { redact } from './logger.js';

// Telegram alerts for faults nobody would otherwise notice.  The same kind of
// fault is reported at most once per cooldown, with a count of the ones held back.
const COOLDOWN_MS = 30 * 60 * 1000;

export function createAlerter({ send, cooldownMs = COOLDOWN_MS, now = Date.now }) {
    const state = new Map();
    return async function alert(key, text) {
        const entry = state.get(key);
        if (entry && now() - entry.sentAt < cooldownMs) {
            entry.held += 1;
            return false;
        }
        const held = entry?.held || 0;
        state.set(key, { sentAt: now(), held: 0 });
        try {
            await send(redact(held ? `${text}\n(เกิดซ้ำอีก ${held} ครั้งตั้งแต่แจ้งครั้งก่อน)` : text));
            return true;
        } catch (err) {
            // An alert must never break the work that raised it.
            logger.warn(`⚠️ [Alert] Telegram alert failed: ${err.message}`);
            return false;
        }
    };
}

async function sendAdminTelegram(text) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') return;
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = String(process.env.ALERT_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '')
        .split(',').map(id => id.trim()).filter(Boolean);
    if (!token || !chatIds.length) throw new Error('ยังไม่ได้ตั้ง Telegram bot token หรือ chat id');
    for (const chatId of chatIds) {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    }
}

export const alertAdmin = createAlerter({ send: sendAdminTelegram });

// For callers that pace their own messages (the health monitor).
const sendNow = createAlerter({ send: sendAdminTelegram, cooldownMs: 0 });
export const notifyAdmin = text => sendNow('direct', text);

/** Short reason from a LINE Messaging API error reply. */
export function describeLineError(status, body = {}) {
    const details = (body.details || []).slice(0, 3).map(d => [d.property, d.message].filter(Boolean).join(': '));
    return [`HTTP ${status ?? '-'} ${body.message || ''}`.trim(), ...details].join('\n');
}

/** Someone in the chat asked for something and got no answer. */
export function alertLineReplyFailed(reason) {
    return alertAdmin('line-reply', `⚠️ ส่งข้อความตอบกลับ LINE ไม่สำเร็จ\n${reason}`);
}
