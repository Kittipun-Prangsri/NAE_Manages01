import dotenv from 'dotenv';
import { trackerPool, hosxpPool } from '../backend/db.js';

dotenv.config();

async function testQuery() {
    console.log("LINE_CHANNEL_ACCESS_TOKEN:", process.env.LINE_CHANNEL_ACCESS_TOKEN ? "Present" : "Missing");
    console.log("DISABLE_NOTIFICATIONS:", process.env.DISABLE_NOTIFICATIONS);

    const queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
    console.log("Querying for date:", queryDate);

    try {
        const [vRows] = await trackerPool.query(
            `SELECT COUNT(*) as total_visits
             FROM visit_tracking
             WHERE visit_date = ?
               AND pcode = 'UCS'
               AND color_status IN ('RED', 'YELLOW')
               AND COALESCE(uc_money, 0) > 0`,
            [queryDate]
        );
        console.log("vRows:", vRows);
    } catch (err) {
        console.error("trackerPool error:", err.message);
    }

    try {
        const [sRows] = await trackerPool.query(
            `SELECT COUNT(*) as service_total FROM visit_tracking WHERE visit_date = ?`,
            [queryDate]
        );
        console.log("sRows:", sRows);
    } catch (err) {
        console.error("sRows error:", err.message);
    }

    process.exit(0);
}

testQuery();
