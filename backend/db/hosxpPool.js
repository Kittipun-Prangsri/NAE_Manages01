import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// ⚠️ ใช้ user ที่มีสิทธิ์ SELECT อย่างเดียวกับฐาน HOSxP เท่านั้น
// ⚠️ charset ต้องเป็น utf8mb4 เสมอ — เคยเป็นความเสี่ยงหลักตอน deploy ระบบคิวมาแล้ว
const hosxpPool = mysql.createPool({
  host: process.env.HOSXP_HOST,
  port: parseInt(process.env.HOSXP_PORT || '3306'),
  user: process.env.HOSXP_READONLY_USER || process.env.HOSXP_USER,
  password: process.env.HOSXP_READONLY_PASS || process.env.HOSXP_PASS,
  database: process.env.HOSXP_DB || 'hos',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,      // เตี้ยไว้ก่อน อย่ากิน connection ของ HOSxP เอง
  queueLimit: 0,
});

export default hosxpPool;
