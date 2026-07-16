import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { trackerPool } from '../backend/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fetch data summary statistics from internal tracker database
 */
async function fetchSummaryStats(queryDate) {
    // 1. Total visits
    const [[{ total_visits }]] = await trackerPool.query(
        'SELECT COUNT(*) as total_visits FROM visit_tracking WHERE visit_date = ?',
        [queryDate]
    );

    // 2. Total money
    const [[{ total_money }]] = await trackerPool.query(
        'SELECT COALESCE(SUM(uc_money), 0) as total_money FROM visit_tracking WHERE visit_date = ?',
        [queryDate]
    );

    // 3. Status counts
    const [[{ endpoint_count }]] = await trackerPool.query(
        "SELECT COUNT(*) as endpoint_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'YELLOW'",
        [queryDate]
    );

    const [[{ not_imported_count }]] = await trackerPool.query(
        "SELECT COUNT(*) as not_imported_count FROM visit_tracking WHERE visit_date = ? AND check_claimcode = 'ยังไม่ได้นำเข้า'",
        [queryDate]
    );

    const [[{ authen_count }]] = await trackerPool.query(
        "SELECT COUNT(*) as authen_count FROM visit_tracking WHERE visit_date = ? AND color_status = 'GREEN'",
        [queryDate]
    );

    // 4. Top 3 rights
    const [rights] = await trackerPool.query(
        'SELECT COALESCE(pttype_note, pttype) as right_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? GROUP BY right_name ORDER BY cnt DESC LIMIT 3',
        [queryDate]
    );

    // 5. UCS outstanding
    const [[{ ucs_total }]] = await trackerPool.query(
        "SELECT COUNT(*) as ucs_total FROM visit_tracking WHERE visit_date = ? AND UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW')",
        [queryDate]
    );

    const [ucs_departments] = await trackerPool.query(
        "SELECT COALESCE(department, 'ไม่ระบุจุดบริการ') as dept_name, COUNT(*) as cnt FROM visit_tracking WHERE visit_date = ? AND UPPER(pcode) = 'UC' AND color_status IN ('RED', 'YELLOW') GROUP BY dept_name ORDER BY cnt DESC LIMIT 3",
        [queryDate]
    );

    return {
        total_visits,
        total_money,
        endpoint_count,
        not_imported_count,
        authen_count,
        rights,
        ucs_total,
        ucs_departments
    };
}

/**
 * Send text summary to Telegram Chat
 */
async function sendTextSummaryToTelegram(token, chatId, targetDate, stats) {
    console.log(`📲 Sending Text Summary to Telegram Chat: ${chatId}...`);
    try {
        const formattedDate = new Date(targetDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
        
        let msg = `📊 *สรุปข้อมูลการให้บริการ* (วันที่ ${formattedDate})\n\n`;
        msg += `👥 ผู้มารับบริการ: *${stats.total_visits}* ครั้ง\n`;
        msg += `💰 ค่ารักษาลูกหนี้ (sum): *${Number(stats.total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* บาท\n\n`;
        
        msg += `🔑 *สถานะ Authen Code:*\n`;
        msg += `• ENDPOINT (เหลือง): *${stats.endpoint_count}* ราย\n`;
        msg += `• ยังไม่ได้นำเข้า (แดง): *${stats.not_imported_count}* ราย\n`;
        msg += `• AUTHENCODE (เขียว): *${stats.authen_count}* ราย\n\n`;
        
        msg += `💳 *สิทธิการรักษา (Top 3):*\n`;
        stats.rights.forEach((r, idx) => {
            msg += `${idx + 1}. ${r.right_name || 'ไม่ระบุ'}: *${r.cnt}* ราย\n`;
        });
        msg += `\n`;
        
        msg += `⚠️ *UCS ค้างชำระ (RED/YELLOW):* *${stats.ucs_total}* ราย\n`;
        stats.ucs_departments.forEach(d => {
            msg += `• ${d.dept_name}: *${d.cnt}* ราย\n`;
        });
        
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: msg,
                parse_mode: 'Markdown'
            })
        });

        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.ok) {
            console.log('✅ Text summary sent to Telegram successfully.');
        } else {
            console.error('❌ Telegram Bot API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error sending text summary to Telegram:', error);
    }
}

/**
 * Capture Grafana dashboard as screenshot and send notifications
 */
async function captureAndNotify(targetDate = null, channels = ['line', 'telegram'], reportTypes = ['summary', 'screenshot'], userCredentials = null) {
    // Use userCredentials if provided, otherwise fall back to .env values
    const lineAccessToken = (userCredentials && userCredentials.line_token) || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const lineGroupId = (userCredentials && userCredentials.line_group_id) || process.env.LINE_GROUP_ID;
    const telegramBotToken = (userCredentials && userCredentials.telegram_token) || process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = (userCredentials && userCredentials.telegram_chat_id) || process.env.TELEGRAM_CHAT_ID;
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    const serverPublicUrl = process.env.SERVER_PUBLIC_URL || 'http://localhost:3000';

    const queryDate = targetDate || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

    let filepath = null;
    let filename = null;

    // Check if screenshot is requested
    if (reportTypes.includes('screenshot')) {
        const port = process.env.PORT || 3000;
        const isRunningUnderPm2 = typeof process.env.pm_id !== 'undefined';
        const localAppUrl = (isRunningUnderPm2 || process.env.NODE_ENV === 'production')
            ? `http://127.0.0.1:${port}`
            : (process.env.LOCAL_DASHBOARD_URL || 'http://localhost:5173');

        console.log(`🚀 Starting screenshot capture process for local dashboard: ${localAppUrl}`);

        let browser;
        try {
            console.log('🌐 Launching browser...');
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

            console.log(`🔗 Navigating to local application URL: ${localAppUrl}`);
            await page.goto(localAppUrl, { waitUntil: 'load', timeout: 30000 });

            // Generate JWT token for system capture user
            console.log('🔑 Generating system authentication token...');
            const tokenPayload = {
                username: 'system_capture',
                full_name: 'System Capture Bot',
                role: 'admin',
                department: 'IT'
            };
            const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_key_change_me';
            const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: '15m' });

            // Inject credentials and force light theme
            console.log('🧪 Injecting auth credentials and setting theme to light...');
            await page.evaluate((tok, usr) => {
                localStorage.setItem('nhso_token', tok);
                localStorage.setItem('nhso_user', JSON.stringify(usr));
                localStorage.setItem('theme', 'light');
                document.documentElement.classList.remove('dark');
            }, token, tokenPayload);

            // Reload page to apply login
            console.log('🔄 Reloading page to apply login...');
            await page.goto(localAppUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Set the target date if provided
            if (queryDate) {
                console.log(`📅 Setting target date: ${queryDate}`);
                await page.evaluate((date) => {
                    const dateInput = document.getElementById('visit-date');
                    if (dateInput) {
                        dateInput.value = date;
                        dateInput.dispatchEvent(new Event('change'));
                    }
                }, queryDate);
            }

            // Switch to the Live Dashboard tab
            console.log('📊 Switching to Live Dashboard tab...');
            await page.waitForSelector('#tab-live-dashboard', { timeout: 10000 });
            await page.click('#tab-live-dashboard');

            // Wait for the Live Dashboard container to render and load data
            console.log('⏳ Waiting for Live Dashboard content to render...');
            await page.waitForSelector('#live-dashboard-view-container', { timeout: 10000 });
            
            // Wait for charts/animations to load completely
            console.log('⏱️ Waiting for charts animations...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            const screenshotsDir = path.join(__dirname, '../screenshots');
            if (!fs.existsSync(screenshotsDir)) {
                fs.mkdirSync(screenshotsDir, { recursive: true });
            }

            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const sec = String(now.getSeconds()).padStart(2, '0');
            
            filename = `grafana_${yyyy}-${mm}-${dd}_${hh}-${min}-${sec}.png`;
            filepath = path.join(screenshotsDir, filename);

            console.log('📸 Capturing element screenshot (.uc-insight-board)...');
            const element = await page.$('.uc-insight-board');
            if (element) {
                await element.screenshot({ path: filepath });
                console.log(`💾 Element screenshot successfully saved to: ${filepath}`);
            } else {
                console.warn('⚠️ Element .uc-insight-board not found. Capturing full page instead.');
                await page.screenshot({ path: filepath });
                console.log(`💾 Full page screenshot successfully saved to: ${filepath}`);
            }

            cleanOldScreenshots(screenshotsDir);

        } catch (error) {
            console.error('❌ Error in screenshot capture:', error);
        } finally {
            if (browser) {
                await browser.close();
                console.log('🔒 Browser closed.');
            }
        }
    } else {
        console.log('ℹ️ Screenshot disabled for this run (Data Summary only).');
    }

    // Now send notifications
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ Notifications are globally disabled via DISABLE_NOTIFICATIONS=true. Skipping send.');
        return { success: true, filepath, filename };
    }

    const notificationPromises = [];

    // Fetch database stats once if summary is needed
    let stats = null;
    if (reportTypes.includes('summary')) {
        console.log('📊 Fetching database stats for summary messages...');
        try {
            stats = await fetchSummaryStats(queryDate);
        } catch (err) {
            console.error('❌ Failed to fetch database stats for summary:', err);
        }
    }

    // LINE Bot
    if (channels.includes('line') && lineAccessToken && lineGroupId) {
        if (reportTypes.includes('summary') && stats) {
            notificationPromises.push(
                sendToLineBot(lineAccessToken, lineGroupId, queryDate, stats)
            );
        } else {
            console.log('ℹ️ LINE Group: Summary not requested or failed, nothing to send.');
        }
    } else if (!channels.includes('line')) {
        console.log('ℹ️ LINE Group notifications disabled for this run.');
    } else {
        console.log('⚠️ LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID is missing in .env, skipping LINE Bot.');
    }

    // Telegram Bot
    if (channels.includes('telegram') && telegramBotToken && telegramChatId) {
        const chatIds = telegramChatId.split(',').map(id => id.trim()).filter(id => id);
        chatIds.forEach(id => {
            if (reportTypes.includes('summary') && stats) {
                notificationPromises.push(
                    sendTextSummaryToTelegram(telegramBotToken, id, queryDate, stats)
                );
            }
            if (reportTypes.includes('screenshot') && filepath && filename) {
                notificationPromises.push(
                    sendToTelegram(filepath, filename, telegramBotToken, id, queryDate)
                );
            }
        });
    } else if (!channels.includes('telegram')) {
        console.log('ℹ️ Telegram notifications disabled for this run.');
    } else {
        console.log('⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in .env, skipping Telegram Bot.');
    }

    if (notificationPromises.length > 0) {
        await Promise.allSettled(notificationPromises);
    }

    return { success: true, filepath, filename };
}

async function sendToLineBot(token, groupId, targetDate, stats) {
    console.log('💬 Dispatching LINE Flex summary message...');
    try {
        const rightsContents = [];
        stats.rights.forEach(r => {
            rightsContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": r.right_name || 'ไม่ระบุสิทธิ',
                        "color": "#ffffff",
                        "size": "sm"
                    },
                    {
                        "type": "text",
                        "text": String(r.cnt),
                        "color": "#52c41a",
                        "size": "md",
                        "align": "end",
                        "weight": "bold"
                    }
                ]
            });
        });

        const ucsContents = [
            {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": "UCS ไม่ได้ปิดสิทธิ",
                        "color": "#ffffff",
                        "size": "sm",
                        "weight": "bold"
                    },
                    {
                        "type": "text",
                        "text": String(stats.ucs_total),
                        "color": "#ff4d4d",
                        "size": "md",
                        "align": "end",
                        "weight": "bold"
                    }
                ]
            }
        ];

        stats.ucs_departments.forEach(d => {
            ucsContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": ` - ${d.dept_name}`,
                        "color": "#8c8c8c",
                        "size": "xs"
                    },
                    {
                        "type": "text",
                        "text": String(d.cnt),
                        "color": "#ffffff",
                        "size": "xs",
                        "align": "end"
                    }
                ]
            });
        });

        const formattedDate = new Date(targetDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
        const flexBubble = {
            "type": "bubble",
            "size": "giga",
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#18191a",
                "contents": [
                    {
                        "type": "text",
                        "text": "📊 สรุปข้อมูลการให้บริการ",
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "xl"
                    },
                    {
                        "type": "text",
                        "text": `Dashboard Summary (${formattedDate})`,
                        "size": "xs",
                        "color": "#8c8c8c",
                        "margin": "sm"
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": "จำนวนผู้มารับบริการ(ครั้ง)",
                                        "color": "#ffffff",
                                        "size": "sm",
                                        "gravity": "center"
                                    },
                                    {
                                        "type": "text",
                                        "text": String(stats.total_visits),
                                        "color": "#ff4d4d",
                                        "size": "xl",
                                        "align": "end",
                                        "weight": "bold"
                                    }
                                ]
                            },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": "ค่ารักษาลูกหนี้ (sum)",
                                        "color": "#ffffff",
                                        "size": "sm",
                                        "gravity": "center"
                                    },
                                    {
                                        "type": "text",
                                        "text": Number(stats.total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                                        "color": "#ff4d4d",
                                        "size": "xl",
                                        "align": "end",
                                        "weight": "bold"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "Visit Authen code",
                                "color": "#8c8c8c",
                                "size": "xs",
                                "weight": "bold"
                            },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "ENDPOINT",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(stats.endpoint_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    },
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "ยังไม่นำเข้า",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(stats.not_imported_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    },
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "contents": [
                                            {
                                                "type": "text",
                                                "text": "AUTHENCODE",
                                                "color": "#ffffff",
                                                "size": "xs",
                                                "align": "center"
                                            },
                                            {
                                                "type": "text",
                                                "text": String(stats.authen_count),
                                                "color": "#ff4d4d",
                                                "size": "md",
                                                "align": "center",
                                                "weight": "bold"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "สิทธิการรักษา (Top 3)",
                                "color": "#8c8c8c",
                                "size": "xs",
                                "weight": "bold"
                            },
                            ...rightsContents
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "spacing": "sm",
                        "contents": ucsContents
                    }
                ]
            }
        };

        const payload = {
            to: groupId,
            messages: [
                {
                    type: 'flex',
                    altText: `📊 สรุปข้อมูลการให้บริการ (${targetDate})`,
                    contents: flexBubble
                }
            ]
        };

        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json().catch(() => ({}));
        if (response.ok) {
            console.log('✅ Sent LINE Flex Message summary successfully.');
        } else {
            console.error('❌ LINE Messaging API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error sending Flex message to LINE:', error);
    }
}

async function sendToTelegram(filepath, filename, token, chatId, targetDate = null) {
    console.log('📲 Sending screenshot to Telegram via Telegram Bot API...');
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formattedDate = targetDate 
            ? new Date(targetDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
            : new Date().toLocaleString('th-TH');
        
        const captionDateLabel = targetDate ? 'วันที่บริการ' : 'วันที่บันทึก';

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', `📊 บันทึกหน้าจอ Grafana อัตโนมัติ\n📅 ${captionDateLabel}: ${formattedDate}`);

        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });

        const resData = await response.json();
        if (response.ok && resData.ok) {
            console.log('✅ Photo sent to Telegram successfully.');
        } else {
            console.error('❌ Telegram Bot API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error sending to Telegram:', error);
    }
}

function cleanOldScreenshots(screenshotsDir) {
    try {
        if (!fs.existsSync(screenshotsDir)) return;
        const files = fs.readdirSync(screenshotsDir);
        const screenshotFiles = files.filter(file => 
            file.startsWith('grafana_') && file.endsWith('.png')
        );
        if (screenshotFiles.length <= 2) return;
        screenshotFiles.sort((a, b) => b.localeCompare(a));
        const filesToDelete = screenshotFiles.slice(2);
        
        filesToDelete.forEach(file => {
            const filePath = path.join(screenshotsDir, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted old screenshot: ${file}`);
            } catch (err) {
                console.error(`❌ Error deleting file ${file}:`, err);
            }
        });
    } catch (error) {
        console.error('❌ Error during screenshots folder cleanup:', error);
    }
}

// Check if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    captureAndNotify();
}

export { captureAndNotify };
