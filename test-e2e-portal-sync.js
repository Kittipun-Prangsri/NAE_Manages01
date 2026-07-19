import { downloadNhsoReport, cleanOldDownloads } from './jobs/download-nhso.js';
import { captureAndNotify } from './jobs/capture-grafana.js';
import { getHosxpVisits, saveTrackingResults, runHosxpSync } from './backend/dataService.js';
import { processCrossCheck } from './backend/crossCheckLogic.js';
import { checkConnections } from './backend/db.js';
import * as xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testE2ESyncAndCapture() {
    console.log('🧪 Starting End-to-End Portal Sync and Grafana Capture Test...');
    
    // Check connections first
    await checkConnections();

    const visit_date = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    console.log(`📅 Target Date: ${visit_date}`);

    try {
        // Step 1: Download NHSO Report
        const dlResult = await downloadNhsoReport();
        if (!dlResult.success || !dlResult.filePath) {
            console.error(`❌ Download failed: ${dlResult.error}`);
            return;
        }

        console.log(`📥 Step 2: Reading Excel file: ${dlResult.filePath}`);
        const fileBuffer = fs.readFileSync(dlResult.filePath);
        const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { 
            raw: false, 
            dateNF: 'yyyy-mm-dd hh:mm:ss' 
        });

        console.log(`💾 Step 3: Importing and Syncing in Database...`);
        await runHosxpSync(excelData, visit_date);
        const hosxpData = await getHosxpVisits(visit_date);
        const processedData = processCrossCheck(hosxpData, excelData);
        await saveTrackingResults(processedData);
        console.log('✅ Sync completed in Database.');

        console.log('🧹 Step 4: Cleaning up Excel downloads...');
        cleanOldDownloads(path.join(__dirname, 'downloads'));

        console.log('📸 Step 5: Capturing Grafana and sending Telegram/LINE notifications...');
        const captureResult = await captureAndNotify();
        
        if (captureResult.success) {
            console.log(`🎉 TEST SUCCESSFUL! Screenshot saved: ${captureResult.filename}`);
        } else {
            console.error(`❌ Capture failed: ${captureResult.error}`);
        }

    } catch (error) {
        console.error('❌ E2E Test Error:', error);
    } finally {
        process.exit(0);
    }
}

testE2ESyncAndCapture();
