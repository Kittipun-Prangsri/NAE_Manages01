import { trackerPool } from './db.js';

async function check() {
    try {
        const [rows] = await trackerPool.query("SHOW CREATE TABLE authencode");
        console.log(rows[0]['Create Table']);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
