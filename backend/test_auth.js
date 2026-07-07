import { hosxpPool } from './db.js';

async function check() {
    try {
        const [rows] = await hosxpPool.query('SELECT officer_name, officer_login_name, officer_login_password FROM officer LIMIT 10');
        console.log(rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();



