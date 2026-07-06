import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { trackerPool } from '../db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function captureAndNotify() {
    const grafanaUrl = process.env.GRAFANA_URL || 'https://khh.srakw.net/d/cdv2h2zc1d91ca/check-authen?orgId=1&kiosk=tv';
    const grafanaUser = process.env.GRAFANA_USER;
    const grafanaPass = process.env.GRAFANA_PASS;
    const lineAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const lineGroupId = process.env.LINE_GROUP_ID;
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    const serverPublicUrl = process.env.SERVER_PUBLIC_URL || 'http://localhost:3000';
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (!grafanaUser || !grafanaPass) {
        console.error('❌ Error: GRAFANA_USER or GRAFANA_PASS is not defined in .env file.');
        return { success: false, error: 'GRAFANA_USER or GRAFANA_PASS is missing in .env' };
    }

    console.log(`🚀 Starting screenshot capture process for: ${grafanaUrl}`);

    let browser;
    try {
        // Launch headless browser
        console.log('🌐 Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Set a wide viewport for Grafana dashboard
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to URL
        console.log('🔗 Navigating to URL...');
        await page.goto(grafanaUrl, { waitUntil: 'load', timeout: 30000 });

        const currentUrl = page.url();
        console.log(`📍 Current page URL: ${currentUrl}`);

        // Check if redirected to login page
        if (currentUrl.includes('/login')) {
            console.log('🔑 Login page detected. Filling credentials...');
            
            // Wait for user input field
            // Try different selectors commonly used in Grafana: input[name="user"], input[id="user"], or input[type="text"]
            let userField = null;
            for (const selector of ['input[name="user"]', 'input[id="user"]', 'input[type="text"]']) {
                try {
                    userField = await page.waitForSelector(selector, { timeout: 3000 });
                    if (userField) {
                        console.log(`Found username input using selector: ${selector}`);
                        await page.type(selector, grafanaUser);
                        break;
                    }
                } catch (e) {
                    // Try next selector
                }
            }

            if (!userField) {
                throw new Error('Could not find Grafana username input field.');
            }

            // Wait for password field
            let passField = null;
            for (const selector of ['input[name="password"]', 'input[id="current-password"]', 'input[type="password"]']) {
                try {
                    passField = await page.waitForSelector(selector, { timeout: 3000 });
                    if (passField) {
                        console.log(`Found password input using selector: ${selector}`);
                        await page.type(selector, grafanaPass);
                        break;
                    }
                } catch (e) {
                    // Try next selector
                }
            }

            if (!passField) {
                throw new Error('Could not find Grafana password input field.');
            }

            console.log('Submitting login form...');
            // Click log in button
            await Promise.all([
                page.click('button[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {
                    console.log('⚠️ Navigation timeout after clicking submit, continuing...');
                })
            ]);
            console.log('✅ Logged in successfully.');
        } else {
            console.log('ℹ️ Already logged in or bypassed login screen.');
        }

        // Wait extra time for all panels and data queries to load fully (Grafana load animation)
        console.log('⏳ Waiting for dashboard panels grid to render...');
        await page.waitForSelector('.react-grid-layout', { timeout: 10000 }).catch(() => {
            console.log('⚠️ Could not find react-grid-layout selector, continuing...');
        });
        
        console.log('⏳ Waiting an additional 3 seconds for charts and data queries to fully render...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Create screenshots folder if it doesn't exist
        const screenshotsDir = path.join(__dirname, '../screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        // Generate dynamic file name based on date-time
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        
        const filename = `grafana_${yyyy}-${mm}-${dd}_${hh}-${min}-${sec}.png`;
        const filepath = path.join(screenshotsDir, filename);

        // Take the screenshot
        console.log('📸 Capturing screenshot...');
        await page.screenshot({ path: filepath });
        console.log(`💾 Screenshot successfully saved to: ${filepath}`);

        // Cleanup older screenshots (keep only latest and second latest)
        cleanOldScreenshots(screenshotsDir);

        // Send to configured channels in parallel
        const notificationPromises = [];

        // LINE Bot
        if (lineAccessToken && lineGroupId) {
            notificationPromises.push(
                sendToLineBot(filepath, filename, lineAccessToken, lineGroupId, imgbbApiKey, serverPublicUrl)
            );
        } else {
            console.log('⚠️ LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID is missing in .env, skipping LINE Bot.');
        }

        // Telegram Bot
        if (telegramBotToken && telegramChatId) {
            const chatIds = telegramChatId.split(',').map(id => id.trim()).filter(id => id);
            chatIds.forEach(id => {
                notificationPromises.push(
                    sendToTelegram(filepath, filename, telegramBotToken, id)
                );
            });
        } else {
            console.log('⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in .env, skipping Telegram Bot.');
        }

        if (notificationPromises.length > 0) {
            await Promise.allSettled(notificationPromises);
        }

        return { success: true, filepath, filename };

    } catch (error) {
        console.error('❌ Error in captureAndNotify process:', error);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

async function sendToLineBot(filepath, filename, token, groupId, imgbbKey, publicUrl) {
    console.log('📊 Querying database stats for LINE Flex Message summary...');
    try {
        // Get current date (today) in Asia/Bangkok timezone ('YYYY-MM-DD' format)
        const queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

        console.log(`📅 Database stats date selected: ${queryDate}`);

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

        // Build right items contents dynamically
        const rightsContents = [];
        rights.forEach(r => {
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

        // Build UCS department items dynamically
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
                        "text": String(ucs_total),
                        "color": "#ff4d4d",
                        "size": "md",
                        "align": "end",
                        "weight": "bold"
                    }
                ]
            }
        ];

        ucs_departments.forEach(d => {
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

        // Construct exact user-requested bubble
        const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
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
                                        "text": String(total_visits),
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
                                        "text": Number(total_money).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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
                                                "text": String(endpoint_count),
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
                                                "text": String(not_imported_count),
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
                                                "text": String(authen_count),
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
                    altText: `📊 สรุปข้อมูลการให้บริการ (${queryDate})`,
                    contents: flexBubble
                }
            ]
        };

        console.log('💬 Dispatching LINE Flex summary message...');
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

async function sendToTelegram(filepath, filename, token, chatId) {
    console.log('📲 Sending screenshot to Telegram via Telegram Bot API...');
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', `📊 บันทึกหน้าจอ Grafana อัตโนมัติ\n📅 วันที่บันทึก: ${new Date().toLocaleString('th-TH')}`);

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
        
        // Read directory contents
        const files = fs.readdirSync(screenshotsDir);
        
        // Filter for files starting with 'grafana_' and ending with '.png'
        const screenshotFiles = files.filter(file => 
            file.startsWith('grafana_') && file.endsWith('.png')
        );
        
        // If we have 2 or fewer files, no need to clean
        if (screenshotFiles.length <= 2) {
            console.log(`ℹ️ Cleanup skipped: ${screenshotFiles.length} file(s) in screenshots folder.`);
            return;
        }
        
        // Sort alphabetically descending (newest first because format is grafana_YYYY-MM-DD_HH-mm-ss.png)
        screenshotFiles.sort((a, b) => b.localeCompare(a));
        
        // Keep the first 2 files (index 0 and 1 represent latest and second-latest)
        // Delete the rest (index 2 onwards)
        const filesToDelete = screenshotFiles.slice(2);
        
        console.log(`🧹 Cleaning up old screenshots. Keeping: ${screenshotFiles[0]} and ${screenshotFiles[1]}`);
        
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
