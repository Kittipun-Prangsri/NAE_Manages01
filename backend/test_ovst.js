import { hosxpPool } from './db.js';

async function check() {
    try {
        const [rows] = await hosxpPool.query("SELECT vstdate, COUNT(*) as cnt FROM ovst GROUP BY vstdate ORDER BY vstdate DESC LIMIT 5");
        console.log("Recent visit dates in ovst:", rows);
        
        const [pttypes] = await hosxpPool.query("SELECT pttype, name, hipdata_code, pttype_group1 FROM pttype LIMIT 10");
        console.log("Sample pttypes:", pttypes);
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
