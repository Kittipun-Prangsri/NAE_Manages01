import crypto from 'crypto';
import { trackerPool } from './db.js';
import logger from './logger.js';

// Per-person Telegram link and endpoint permission.
// - users.telegram_chat_id is filled when the person presses Start in the bot
//   from the one-time link the web app gives them (no chat id to look up).
// - users.can_endpoint / users.can_portal are switched on per person by an admin
//   (endpoint batches, and pulling reports through the NHSO portal).

const LINK_TTL_MINUTES = 15;
let columnsReady = null;

/** Adds the columns this feature needs to older installations, once per process. */
export function ensureUserAccessColumns(pool = trackerPool) {
    if (!columnsReady) {
        columnsReady = (async () => {
            const wanted = {
                can_endpoint: 'ADD COLUMN can_endpoint TINYINT(1) NOT NULL DEFAULT 0',
                can_portal: 'ADD COLUMN can_portal TINYINT(1) NOT NULL DEFAULT 0',
                telegram_link_code: 'ADD COLUMN telegram_link_code VARCHAR(32) NULL',
                telegram_link_expires: 'ADD COLUMN telegram_link_expires DATETIME NULL'
            };
            for (const [column, ddl] of Object.entries(wanted)) {
                const [cols] = await pool.query('SHOW COLUMNS FROM users LIKE ?', [column]);
                if (cols.length === 0) {
                    await pool.query(`ALTER TABLE users ${ddl}`);
                    logger.info(`✅ Added "${column}" column to "users" table.`);
                }
            }
        })().catch(err => {
            columnsReady = null;
            throw err;
        });
    }
    return columnsReady;
}

/** Parses "/start <code>" sent by Telegram when a person opens the bot from their link. */
export function parseStartCode(text) {
    const match = /^\/start\s+([A-Za-z0-9]{8,32})$/.exec(String(text || '').trim());
    return match ? match[1] : null;
}

let botUsernameCache = null;
async function botUsername(token) {
    if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
    if (botUsernameCache) return botUsernameCache;
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`).then(r => r.json());
    if (!res.ok) throw new Error('ติดต่อบอท Telegram ไม่ได้');
    botUsernameCache = res.result.username;
    return botUsernameCache;
}

/** Creates a one-time link that ties the person's Telegram chat to their web account. */
export async function createTelegramLink(username) {
    await ensureUserAccessColumns();
    const token = process.env.WORKER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('ยังไม่ได้ตั้งค่าบอท Telegram');
    const code = crypto.randomBytes(12).toString('hex');
    const [result] = await trackerPool.query(
        'UPDATE users SET telegram_link_code = ?, telegram_link_expires = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE username = ?',
        [code, LINK_TTL_MINUTES, username]
    );
    if (result.affectedRows === 0) throw new Error('ไม่พบบัญชีผู้ใช้');
    return { url: `https://t.me/${await botUsername(token)}?start=${code}`, expiresInMinutes: LINK_TTL_MINUTES };
}

/** Called by the bot on "/start <code>": stores the chat id. Returns the user, or null for a bad/expired code. */
export async function consumeTelegramLink(code, chatId) {
    await ensureUserAccessColumns();
    const [[user]] = await trackerPool.query(
        'SELECT id, username, full_name FROM users WHERE telegram_link_code = ? AND telegram_link_expires > NOW()',
        [code]
    );
    if (!user) return null;
    // One chat belongs to one person: unlink it from anyone who had it before.
    await trackerPool.query('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id <> ?', [String(chatId), user.id]);
    await trackerPool.query(
        'UPDATE users SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_link_expires = NULL WHERE id = ?',
        [String(chatId), user.id]
    );
    return user;
}

export async function findUserByTelegramChat(chatId) {
    await ensureUserAccessColumns();
    const [[user]] = await trackerPool.query(
        'SELECT username, full_name, role, can_endpoint, can_portal, telegram_chat_id FROM users WHERE telegram_chat_id = ? LIMIT 1',
        [String(chatId)]
    );
    return user || null;
}

/** What this person may do (endpoint batches, portal pulls) and where their Telegram is. */
export async function getEndpointAccess(username) {
    await ensureUserAccessColumns();
    const [[user]] = await trackerPool.query(
        'SELECT username, full_name, can_endpoint, can_portal, telegram_chat_id FROM users WHERE username = ?',
        [username]
    );
    return {
        canEndpoint: Boolean(user?.can_endpoint),
        canPortal: Boolean(user?.can_portal),
        telegramLinked: Boolean(user?.telegram_chat_id),
        chatId: user?.telegram_chat_id || null,
        displayName: user?.full_name || username
    };
}
