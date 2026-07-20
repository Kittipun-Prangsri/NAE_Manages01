import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionConfig = {
    host: process.env.TRACKER_HOST,
    user: process.env.TRACKER_USER,
    password: process.env.TRACKER_PASS,
    database: process.env.TRACKER_DB,
    port: parseInt(process.env.TRACKER_PORT || '3306', 10),
    charset: 'tis620'
};

async function run() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(connectionConfig);
        console.log('Successfully connected.');
        
        console.log('\n--- Cron Schedules ---');
        const [rows] = await connection.query('SELECT * FROM cron_schedules');
        console.table(rows);
        
        console.log('\n----------------------');
    } catch (err) {
        console.error('Error querying database:', err);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

run();
