import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
        await page.goto(grafanaUrl, { waitUntil: 'networkidle2', timeout: 60000 });

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
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
                    console.log('⚠️ Navigation timeout after clicking submit, continuing...');
                })
            ]);
            console.log('✅ Logged in successfully.');
        } else {
            console.log('ℹ️ Already logged in or bypassed login screen.');
        }

        // Wait extra time for all panels and data queries to load fully (Grafana load animation)
        console.log('⏳ Waiting 15 seconds for dashboard panels to render completely...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        // Create screenshots folder if it doesn't exist
        const screenshotsDir = path.join(__dirname, 'screenshots');
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
            notificationPromises.push(
                sendToTelegram(filepath, filename, telegramBotToken, telegramChatId)
            );
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
    console.log('📲 Processing image hosting for LINE Messaging API...');
    let imageUrl = '';

    try {
        if (imgbbKey && imgbbKey !== 'your_imgbb_api_key_here') {
            console.log('📤 Uploading screenshot to ImgBB...');
            const imageBase64 = fs.readFileSync(filepath, { encoding: 'base64' });
            
            const formData = new FormData();
            formData.append('image', imageBase64);

            const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
                method: 'POST',
                body: formData
            });

            const imgbbData = await imgbbResponse.json();
            if (imgbbResponse.ok && imgbbData.success) {
                imageUrl = imgbbData.data.url;
                console.log(`✅ Uploaded to ImgBB successfully: ${imageUrl}`);
            } else {
                console.error('❌ ImgBB upload failed:', imgbbData);
            }
        }
    } catch (error) {
        console.error('❌ Error uploading to ImgBB, falling back to local server URL:', error);
    }

    // If ImgBB upload failed or key not present, use local server URL
    if (!imageUrl) {
        imageUrl = `${publicUrl}/screenshots/${filename}`;
        console.log(`ℹ️ Using local server static URL: ${imageUrl}`);
        console.log('⚠️ Please ensure this server port is exposed to the public internet so LINE servers can download the image.');
    }

    console.log('💬 Sending image message via LINE Bot push api...');
    try {
        const payload = {
            to: groupId,
            messages: [
                {
                    type: 'text',
                    text: `📊 บันทึกหน้าจอ Grafana อัตโนมัติ\n📅 วันที่บันทึก: ${new Date().toLocaleString('th-TH')}`
                },
                {
                    type: 'image',
                    originalContentUrl: imageUrl,
                    previewImageUrl: imageUrl
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
            console.log('✅ Sent message and image via LINE Bot successfully.');
        } else {
            console.error('❌ LINE Messaging API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error calling LINE Messaging API:', error);
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
