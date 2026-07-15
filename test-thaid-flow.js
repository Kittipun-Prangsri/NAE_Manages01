import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

dotenv.config();

// Use stealth plugin
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testThaiDFlow() {
    const url = 'https://authenservice.nhso.go.th/authencode/';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    const lineAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const lineGroupId = process.env.LINE_GROUP_ID;
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    const serverPublicUrl = process.env.SERVER_PUBLIC_URL || 'http://localhost:3000';

    const hasTelegram = telegramToken && telegramChatId && telegramChatId !== 'your_telegram_chat_id_here';
    const hasLine = lineAccessToken && lineGroupId && lineGroupId !== 'your_group_id_here';

    if (!hasTelegram && !hasLine) {
        console.error('❌ Error: Neither TELEGRAM nor LINE credentials are configured in .env.');
        return;
    }

    console.log(`🕵️‍♂️ Starting ThaiD Login Flow Test targeting: ${url}`);
    
    let browser;
    try {
        const sessionPath = path.join(__dirname, 'puppeteer_session');
        
        // Terminate stale Chrome/Chromium processes under Linux to release lock handles
        if (process.platform === 'linux') {
            try {
                execSync('pkill -f "chrome|chromium" || true');
                console.log('🧹 Cleaned up stale background browser processes.');
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.warn('⚠️ Warning: Could not pkill stale browsers:', err.message);
            }
        }

        const lockFile = path.join(sessionPath, 'SingletonLock');
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
                console.log('🧹 Cleaned up stale Puppeteer SingletonLock.');
            } catch (e) {
                console.warn('⚠️ Warning: Could not remove SingletonLock:', e.message);
            }
        }

        browser = await puppeteer.launch({
            headless: true,
            userDataDir: sessionPath,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        const downloadsDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        // Setup download path
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadsDir
        });

        console.log('🔗 Navigating to NHSO portal to check session...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        let authenticated = false;
        const checkUrl = page.url();
        console.log(`📍 Initial check URL: ${checkUrl}`);

        // If we are already logged in (redirected to dashboard/authencode and no login button)
        if (checkUrl.includes('authenservice.nhso.go.th/authencode') && !checkUrl.includes('login')) {
            const hasLoginButton = await page.evaluate(() => {
                return !!document.querySelector('a[href*="/broker/thaid/login"]');
            });
            if (!hasLoginButton) {
                console.log('✅ Existing active session found! Skipping ThaiD QR Code login.');
                authenticated = true;
            }
        }

        if (!authenticated) {
            console.log(`🔗 Navigating to NHSO portal...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            console.log('🔑 Clicking ThaiD login option...');
            try {
                await page.waitForSelector('a[href*="/broker/thaid/login"]', { timeout: 15000 });
                await Promise.all([
                    page.click('a[href*="/broker/thaid/login"]'),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {
                        console.log('⚠️ Navigation after ThaiD click timed out, continuing...');
                    })
                ]);
            } catch (err) {
                // If it failed to find the login button, maybe we got authenticated in the meantime
                const currentUrl = page.url();
                if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('/login')) {
                    console.log('🎉 Detected authentication during transition!');
                    authenticated = true;
                } else {
                    throw err;
                }
            }

            if (!authenticated) {
                console.log('⏳ Waiting for ThaiD QR Code page to render...');
                await new Promise(resolve => setTimeout(resolve, 5000));

                const thaidUrl = page.url();
                console.log(`📍 Current URL (ThaiD Page): ${thaidUrl}`);

                // Temporarily set a mobile viewport for large QR code rendering
                await page.setViewport({ width: 440, height: 600 });
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Capture QR Code page screenshot in screenshots directory
                const screenshotsDir = path.join(__dirname, 'screenshots');
                if (!fs.existsSync(screenshotsDir)) {
                    fs.mkdirSync(screenshotsDir, { recursive: true });
                }
                const thaidQrFilename = 'thaid_qr.png';
                const thaidQrPath = path.join(screenshotsDir, thaidQrFilename);
                await page.screenshot({ path: thaidQrPath });
                console.log(`📸 QR Code screenshot saved to: ${thaidQrPath}`);

                // Restore desktop viewport
                await page.setViewport({ width: 1280, height: 800 });

                // Send QR Code to Telegram & LINE
                const caption = '📲 สแกน QR Code นี้ด้วยแอป ThaiD เพื่อเข้าใช้งานระบบ สปสช.';

                if (hasTelegram) {
                    const chatIds = telegramChatId.split(',').map(id => id.trim()).filter(id => id);
                    for (const id of chatIds) {
                        await sendToTelegram(thaidQrPath, 'thaid_qr.png', telegramToken, id, caption, thaidUrl);
                    }
                    console.log(`📲 QR Code sent to Telegram.`);
                }

                if (hasLine) {
                    await sendToLineBot(thaidQrPath, thaidQrFilename, lineAccessToken, lineGroupId, imgbbApiKey, serverPublicUrl, caption, thaidUrl);
                    console.log(`📲 QR Code sent to LINE.`);
                }

                // Wait loop: Poll every 2 seconds to check if we are redirected back to authencode dashboard
                console.log('⏳ Waiting for user to scan QR Code (Timeout: 10 minutes)...');
                const startTime = Date.now();
                const timeoutMs = 600000; // 10 minutes

                while (Date.now() - startTime < timeoutMs) {
                    const currentUrl = page.url();
                    
                    // Check if we are redirected back to authenservice/authencode
                    if (currentUrl.includes('authenservice.nhso.go.th/authencode') && !currentUrl.includes('/login')) {
                        console.log(`🎉 Detected redirect to NHSO Portal! URL: ${currentUrl}`);
                        console.log('⏳ Waiting 5 seconds for session and cookies to settle...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        authenticated = true;
                        break;
                    }

                    // Print countdown status
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    process.stdout.write(`⏳ Polling session... ${elapsed}s elapsed. Current URL: ${currentUrl.substring(0, 60)}...\r`);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                console.log('\n');

                if (authenticated) {
                    console.log('✅ Authentication successful!');
                } else {
                    console.warn(`⚠️ Timed out waiting for scan.`);
                }
            }
        }

        if (authenticated) {
            console.log('✅ Authentication successful! Navigating to /report/eclaim...');
            await page.goto('https://authenservice.nhso.go.th/authencode/report/eclaim', { waitUntil: 'networkidle2', timeout: 60000 });
            
            console.log('⏳ Waiting for search button to load...');
            await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log(`📍 Loaded Report Page URL: ${page.url()}`);
            
            // Format dates
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy_ad = now.getFullYear();
            const yyyy_be = yyyy_ad + 543;
            
            const date_be = `${dd}/${mm}/${yyyy_be}`;
            const date_ad = `${dd}/${mm}/${yyyy_ad}`;

            console.log(`📅 Prepared search dates -> BE: ${date_be}, AD: ${date_ad}`);

            // Fill dates in inputs (try BE first)
            console.log(`✍️ Setting date inputs to (BE): ${date_be}...`);
            await page.evaluate((val) => {
                const inputs = document.querySelectorAll('input[name="date"]');
                if (inputs.length >= 2) {
                    inputs[0].value = val;
                    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                    
                    inputs[1].value = val;
                    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, date_be);

            // Capture initial state
            const initialReportPath = path.join(__dirname, 'nhso_report_page_initial.png');
            await page.screenshot({ path: initialReportPath });
            console.log(`📸 Saved initial report page screenshot to: ${initialReportPath}`);
            
            // Click Search ("ค้นหา")
            console.log('🔍 Clicking "ค้นหา" button...');
            await page.click('button[type="submit"]');
            
            // Wait for list to render and download button to be active
            console.log('⏳ Waiting for names list to load and download button to be enabled (BE Try)...');
            let downloadBtnSelector = 'button.btn-default.float-end:not([disabled])';
            let downloadBtnReady = false;

            try {
                await page.waitForSelector(downloadBtnSelector, { timeout: 15000 });
                downloadBtnReady = true;
            } catch (err) {
                console.log('⚠️ BE date search did not enable download button, trying AD year format...');
                
                // Fallback to AD date
                console.log(`✍️ Setting date inputs to (AD): ${date_ad}...`);
                await page.evaluate((val) => {
                    const inputs = document.querySelectorAll('input[name="date"]');
                    if (inputs.length >= 2) {
                        inputs[0].value = val;
                        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                        
                        inputs[1].value = val;
                        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                        inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, date_ad);

                console.log('🔍 Clicking "ค้นหา" button again...');
                await page.click('button[type="submit"]');

                console.log('⏳ Waiting for names list to load and download button to be enabled (AD Try)...');
                await page.waitForSelector(downloadBtnSelector, { timeout: 30000 });
                downloadBtnReady = true;
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Capture loaded names state
            const loadedReportPath = path.join(__dirname, 'nhso_report_page_loaded.png');
            await page.screenshot({ path: loadedReportPath });
            console.log(`📸 Saved searched report page screenshot to: ${loadedReportPath}`);
            
            // Click Download ("ดาวน์โหลดรายงาน")
            console.log('📥 Clicking "ดาวน์โหลดรายงาน" button...');
            await page.click('button.btn-default.float-end');
            
            console.log('⏳ Waiting for file download to complete...');
            const downloadedFile = await waitForDownload(downloadsDir, 60000);
            console.log(`🎉 File downloaded successfully to: ${downloadedFile}`);

            // Send searched page screenshot and success message
            if (hasTelegram) {
                await sendToTelegram(loadedReportPath, 'nhso_report_page_loaded.png', telegramToken, telegramChatId, '🎉 ดาวน์โหลดรายงานและข้อมูล Authen Code สำเร็จแล้ว!');
            }
            if (hasLine) {
                await sendToLineBot(loadedReportPath, 'nhso_report_page_loaded.png', lineAccessToken, lineGroupId, imgbbApiKey, serverPublicUrl, '🎉 ดาวน์โหลดรายงานและข้อมูล Authen Code สำเร็จแล้ว!');
            }
        } else {
            console.error('❌ Timeout reached. ThaiD QR Code was not scanned in time.');
        }

    } catch (error) {
        console.error('❌ Error during ThaiD flow:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

async function waitForDownload(downloadsDir, timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const files = fs.readdirSync(downloadsDir);
        const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
        const inProgress = files.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
        
        if (xlsxFiles.length > 0 && !inProgress) {
            const sorted = xlsxFiles.map(f => ({
                name: f,
                time: fs.statSync(path.join(downloadsDir, f)).mtimeMs
            })).sort((a, b) => b.time - a.time);
            return path.join(downloadsDir, sorted[0].name);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('การดาวน์โหลดไฟล์รายงานหมดเวลา (Timeout)');
}

async function sendToTelegram(filepath, filename, token, chatId, text = '', actionUrl = null) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ Telegram photo sending is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
    try {
        const fileBuffer = fs.readFileSync(filepath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, filename);
        formData.append('caption', text || `📲 สแกน QR Code นี้ด้วยแอป ThaiD เพื่อเข้าใช้งานระบบ สปสช. (จำกัดเวลา 2 นาที)`);

        if (actionUrl) {
            const replyMarkup = {
                inline_keyboard: [
                    [
                        {
                            text: '📲 กดเพื่อเข้าสู่ระบบผ่านแอป ThaiD',
                            url: actionUrl
                        }
                    ]
                ]
            };
            formData.append('reply_markup', JSON.stringify(replyMarkup));
        }

        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
        });

        const resData = await response.json();
        if (!response.ok || !resData.ok) {
            console.error('❌ Telegram error:', resData);
        }
    } catch (error) {
        console.error('❌ Error sending QR to Telegram:', error);
    }
}

async function sendToLineBot(filepath, filename, token, groupId, imgbbKey, publicUrl, captionText, actionUrl = null) {
    if (process.env.DISABLE_NOTIFICATIONS === 'true') {
        console.log('ℹ️ LINE Flex message sending is globally disabled via DISABLE_NOTIFICATIONS=true.');
        return;
    }
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
    }

    console.log('💬 Sending Flex Message via LINE Bot push api...');
    try {
        // Construct standard bubble Flex Message content dynamically
        const flexBubble = {
            "type": "bubble",
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    {
                        "type": "text",
                        "text": actionUrl ? "🔑 ยืนยันตัวตน ThaiD" : "🎉 ดึงรายงาน NHSO สำเร็จ",
                        "weight": "bold",
                        "size": "md",
                        "color": actionUrl ? "#2563eb" : "#10b981"
                    },
                    {
                        "type": "text",
                        "text": captionText,
                        "wrap": true,
                        "size": "sm",
                        "color": "#4b5563"
                    }
                ]
            }
        };

        if (imageUrl) {
            if (imageUrl.startsWith('https://')) {
                flexBubble.hero = {
                    "type": "image",
                    "url": imageUrl,
                    "size": "full",
                    "aspectRatio": actionUrl ? "1:1" : "1.91:1",
                    "aspectMode": "fit"
                };
            } else {
                console.warn(`⚠️ Skipping hero image in LINE Flex message: URL must start with https:// (provided: "${imageUrl}")`);
            }
        }

        if (actionUrl) {
            flexBubble.footer = {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": "#2563eb",
                        "action": {
                            "type": "uri",
                            "label": "📲 เปิดแอป ThaiD ล็อกอิน",
                            "uri": actionUrl
                        }
                    }
                ]
            };
        }

        const payload = {
            to: groupId,
            messages: [
                {
                    type: 'flex',
                    altText: actionUrl ? '📲 สแกน QR Code ด้วยแอป ThaiD' : '🎉 ดาวน์โหลดรายงาน NHSO สำเร็จ',
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
            console.log('✅ Sent Flex Message via LINE Bot successfully.');
        } else {
            console.error('❌ LINE Messaging API returned error:', resData);
        }
    } catch (error) {
        console.error('❌ Error calling LINE Messaging API:', error);
    }
}

testThaiDFlow();
