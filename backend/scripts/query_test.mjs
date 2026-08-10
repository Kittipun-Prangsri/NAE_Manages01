import hosxpPool from '../db/hosxpPool.js';
const [rows] = await hosxpPool.query('DESCRIBE vn_stat');
console.log(rows.map(r => r.Field).filter(f => f.includes('money') || f.includes('income')));
process.exit(0);
