import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const configPath = path.join(__dirname, 'line-rich-menu-config.json');

// Prefer PNG if under 1MB, otherwise fallback to JPG
const pngImagePath = path.join(rootDir, 'smart-groupinsights-line-rich-menu-2500x1686.png');
const jpgImagePath = path.join(rootDir, 'smart-groupinsights-line-rich-menu-2500x1686.jpg');

let targetImagePath = null;
let contentType = 'image/png';

if (fs.existsSync(pngImagePath) && fs.statSync(pngImagePath).size < 1048576) {
    targetImagePath = pngImagePath;
    contentType = 'image/png';
} else if (fs.existsSync(jpgImagePath) && fs.statSync(jpgImagePath).size < 1048576) {
    targetImagePath = jpgImagePath;
    contentType = 'image/jpeg';
} else if (fs.existsSync(pngImagePath)) {
    console.warn(`⚠️ Warning: ${pngImagePath} exceeds LINE 1MB limit (${(fs.statSync(pngImagePath).size / 1024 / 1024).toFixed(2)} MB). Using JPG fallback.`);
    targetImagePath = jpgImagePath;
    contentType = 'image/jpeg';
}

if (!token || token === 'change_me') {
    console.error('❌ Error: LINE_CHANNEL_ACCESS_TOKEN is not configured in .env file.');
    process.exit(1);
}

if (!fs.existsSync(configPath)) {
    console.error(`❌ Error: Configuration file not found at ${configPath}`);
    process.exit(1);
}

if (!targetImagePath || !fs.existsSync(targetImagePath)) {
    console.error(`❌ Error: Rich menu image file not found or exceeds 1MB limit.`);
    process.exit(1);
}

async function run() {
    console.log('🚀 Starting LINE Rich Menu Setup...');
    console.log(`📷 Selected image: ${path.basename(targetImagePath)} (${(fs.statSync(targetImagePath).size / 1024).toFixed(1)} KB, Content-Type: ${contentType})`);

    // 1. Create Rich Menu Structure
    console.log('1️⃣ Registering Rich Menu structure...');
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(configData)
    });

    const createResult = await createRes.json();
    if (!createRes.ok) {
        console.error('❌ Failed to create Rich Menu:', createResult);
        process.exit(1);
    }

    const richMenuId = createResult.richMenuId;
    console.log(`✅ Rich Menu created successfully! ID: ${richMenuId}`);

    // 2. Upload Rich Menu Image
    console.log(`2️⃣ Uploading Rich Menu image...`);
    const imageBuffer = fs.readFileSync(targetImagePath);

    const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': contentType
        },
        body: imageBuffer
    });

    const uploadResult = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
        console.error(`❌ Failed to upload Rich Menu image (HTTP ${uploadRes.status} ${uploadRes.statusText}):`, uploadResult);
        process.exit(1);
    }
    console.log('✅ Image uploaded successfully!');

    // 3. Set as Default Rich Menu for all users
    console.log('3️⃣ Setting Rich Menu as default for all users...');
    const setDefaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!setDefaultRes.ok) {
        const setDefaultResult = await setDefaultRes.json().catch(() => ({}));
        console.error('❌ Failed to set default Rich Menu:', setDefaultResult);
        process.exit(1);
    }

    console.log('🎉 LINE Rich Menu has been successfully created, uploaded, and set as default!');
    console.log(`📌 Rich Menu ID: ${richMenuId}`);
}

run().catch(err => {
    console.error('❌ Execution error:', err);
    process.exit(1);
});
