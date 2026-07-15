import { hosxpPool } from '../backend/db.js';

async function main() {
    try {
        const [rows] = await hosxpPool.query("DESCRIBE temp_authen_code");
        console.log("Columns of temp_authen_code:", rows);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}
main();
