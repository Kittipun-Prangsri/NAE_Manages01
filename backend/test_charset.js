import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
async function run() {
    try {
        const pool = mysql.createPool({
            host: process.env.TRACKER_HOST,
            user: process.env.TRACKER_USER,
            password: process.env.TRACKER_PASS,
            database: process.env.TRACKER_DB,
            port: process.env.TRACKER_PORT || 3306,
            charset: 'tis620'
        });
        await pool.query("SELECT `รหัสหน่วย` FROM authencode LIMIT 1");
        console.log("tis620 worked");
        process.exit(0);
    } catch(e) {
        console.log("tis620 failed:", e.message);
        try {
            const pool2 = mysql.createPool({
                host: process.env.TRACKER_HOST,
                user: process.env.TRACKER_USER,
                password: process.env.TRACKER_PASS,
                database: process.env.TRACKER_DB,
                port: process.env.TRACKER_PORT || 3306,
                charset: 'utf8'
            });
            await pool2.query("SELECT `รหัสหน่วย` FROM authencode LIMIT 1");
            console.log("utf8 worked");
            process.exit(0);
        } catch(e2) {
            console.log("utf8 failed:", e2.message);
            process.exit(1);
        }
    }
}
run();
