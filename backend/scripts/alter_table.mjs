import { trackerPool } from './backend/db.js';
async function run() {
    try {
        await trackerPool.query('ALTER TABLE visit_tracking ADD COLUMN item_money DOUBLE(15,3) DEFAULT NULL AFTER uc_money');
        console.log('Column added successfully');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('Column already exists');
        } else {
            console.error(e);
        }
    }
    process.exit(0);
}
run();
