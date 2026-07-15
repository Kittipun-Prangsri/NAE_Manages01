import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * GET /api/dashboard-data
 * ส่งคืนข้อมูลสถิติแผนที่และกราฟโดนัท
 */
app.get('/api/dashboard-data', (req, res) => {
    const dashboardData = {
        // ข้อมูลพิกัด (Longitude, Latitude) และค่าสถิติ (value) ของแต่ละตำบล
        mapData: [
            { name: 'คลองหาด', value: [102.31, 13.43, 85] },      // [lng, lat, patient_count]
            { name: 'ไทรเดี่ยว', value: [102.26, 13.48, 62] },
            { name: 'คลองไก่เถื่อน', value: [102.33, 13.32, 45] },
            { name: 'โนนหมากมุ่น', value: [102.32, 13.52, 90] },
            { name: 'เบญจขร', value: [102.38, 13.45, 30] }
        ],
        // ข้อมูลเปอร์เซ็นต์และตัวเลขดิบสำหรับ Donut Charts ทั้ง 4 ตัว
        donutCharts: {
            opd: {
                percentage: 84,
                completed: 72,
                total: 85,
                title: 'Outpatient Dept. (OPD)',
                color: '#2dd4bf' // Mint Green
            },
            er: {
                percentage: 65,
                completed: 17,
                total: 26,
                title: 'Emergency Room (ER)',
                color: '#f97316' // Orange
            },
            ncd: {
                percentage: 78,
                completed: 94,
                total: 120,
                title: 'NCD Clinic',
                color: '#38bdf8' // Light Blue
            },
            dental: {
                percentage: 52,
                completed: 21,
                total: 40,
                title: 'Dental Clinic',
                color: '#22c55e' // Green
            }
        }
    };
    res.json(dashboardData);
});

/**
 * GET /api/geojson
 * ส่งคืนไฟล์ GeoJSON ของตำบลในอำเภอคลองหาด
 */
app.get('/api/geojson', (req, res) => {
    const geojsonPath = path.join(__dirname, 'public', 'khlonghat.geojson');
    
    fs.readFile(geojsonPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading GeoJSON file:', err);
            return res.status(500).json({ error: 'ไม่พบไฟล์ขอบเขตแผนที่ระดับตำบล' });
        }
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
