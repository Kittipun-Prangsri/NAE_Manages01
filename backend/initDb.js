import { trackerPool } from './db.js';

export async function initInternalDb() {
    const schema = `
        CREATE TABLE IF NOT EXISTS visit_tracking (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vn VARCHAR(20) NOT NULL UNIQUE,
            hn VARCHAR(20) NOT NULL,
            cid VARCHAR(13) NOT NULL,
            full_name VARCHAR(150) NOT NULL,
            visit_date DATE NOT NULL,
            pttype VARCHAR(10),
            pcode VARCHAR(10),
            uc_money DOUBLE(15,3),
            claim_code VARCHAR(50),
            authen_code_type VARCHAR(100),
            pttype_note TEXT,
            department VARCHAR(150),
            subdistrict_code VARCHAR(10) DEFAULT NULL,
            subdistrict_name VARCHAR(150) DEFAULT NULL,
            nhso_authen_code VARCHAR(50) DEFAULT NULL,
            authen_status BOOLEAN DEFAULT FALSE,
            endpoint_status BOOLEAN DEFAULT FALSE,
            color_status ENUM('RED', 'YELLOW', 'GREEN') NOT NULL DEFAULT 'RED',
            staff VARCHAR(100) DEFAULT NULL,
            check_claimcode VARCHAR(50) DEFAULT 'ยังไม่ได้นำเข้า',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_cid_date (cid, visit_date),
            INDEX idx_color (color_status)
        );
    `;

    const savedQueriesSchema = `
        CREATE TABLE IF NOT EXISTS saved_queries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL UNIQUE,
            query_text TEXT NOT NULL,
            db_type VARCHAR(20) NOT NULL DEFAULT 'hosxp',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
    `;

    const cronSchedulesSchema = `
        CREATE TABLE IF NOT EXISTS cron_schedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            schedule_time TIME NOT NULL UNIQUE,
            is_enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
    `;

    const syncRunsSchema = `
        CREATE TABLE IF NOT EXISTS sync_runs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            source VARCHAR(50) NOT NULL,
            visit_date DATE NOT NULL,
            status ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running',
            username VARCHAR(100) DEFAULT NULL,
            total_records INT DEFAULT 0,
            message TEXT,
            error TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP NULL DEFAULT NULL,
            INDEX idx_sync_runs_date (visit_date),
            INDEX idx_sync_runs_status (status)
        );
    `;

    const usersSchema = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            full_name VARCHAR(200),
            role ENUM('admin', 'user', 'viewer') DEFAULT 'user',
            department VARCHAR(200),
            line_token VARCHAR(255) DEFAULT NULL,
            line_group_id VARCHAR(150) DEFAULT NULL,
            telegram_token VARCHAR(255) DEFAULT NULL,
            telegram_chat_id VARCHAR(150) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
    `;

    try {
        await trackerPool.query(usersSchema);
        console.log('✅ Internal database table "users" is ready.');

        // Check if role column exists in users table (in case table existed without it)
        const [userCols] = await trackerPool.query('SHOW COLUMNS FROM users LIKE "role"');
        if (userCols.length === 0) {
            await trackerPool.query("ALTER TABLE users ADD COLUMN role ENUM('admin', 'user', 'viewer') DEFAULT 'user' AFTER full_name");
            console.log('✅ Added "role" column to "users" table.');
        }

        // Check if line_token column exists in users table (in case table existed without it)
        const [lineTokenCols] = await trackerPool.query('SHOW COLUMNS FROM users LIKE "line_token"');
        if (lineTokenCols.length === 0) {
            await trackerPool.query(`
                ALTER TABLE users 
                ADD COLUMN line_token VARCHAR(255) DEFAULT NULL AFTER department,
                ADD COLUMN line_group_id VARCHAR(150) DEFAULT NULL AFTER line_token,
                ADD COLUMN telegram_token VARCHAR(255) DEFAULT NULL AFTER line_group_id,
                ADD COLUMN telegram_chat_id VARCHAR(150) DEFAULT NULL AFTER telegram_token
            `);
            console.log('✅ Added Line and Telegram notification columns to "users" table.');
        }

        await trackerPool.query(schema);
        console.log('✅ Internal database table "visit_tracking" is ready.');

        const [subdistrictCodeCols] = await trackerPool.query('SHOW COLUMNS FROM visit_tracking LIKE "subdistrict_code"');
        if (subdistrictCodeCols.length === 0) {
            await trackerPool.query(`
                ALTER TABLE visit_tracking
                ADD COLUMN subdistrict_code VARCHAR(10) DEFAULT NULL AFTER department,
                ADD COLUMN subdistrict_name VARCHAR(150) DEFAULT NULL AFTER subdistrict_code
            `);
            console.log('✅ Added subdistrict columns to "visit_tracking" table.');
        }

        await trackerPool.query(savedQueriesSchema);
        console.log('✅ Internal database table "saved_queries" is ready.');

        await trackerPool.query(cronSchedulesSchema);
        console.log('✅ Internal database table "cron_schedules" is ready.');

        await trackerPool.query(syncRunsSchema);
        console.log('✅ Internal database table "sync_runs" is ready.');

        // Prepopulate default cron schedules if empty
        const [schedRows] = await trackerPool.query('SELECT COUNT(*) as count FROM cron_schedules');
        if (schedRows[0].count === 0) {
            await trackerPool.query("INSERT INTO cron_schedules (schedule_time) VALUES ('15:00:00'), ('20:29:00')");
            console.log('✅ Prepopulated default cron schedules.');
        }

        // Prepopulate default queries if empty
        const [rows] = await trackerPool.query('SELECT COUNT(*) as count FROM saved_queries');
        if (rows[0].count === 0) {
            const defaultQueries = [
                {
                    name: '1. ตรวจสอบการ Authen (สิทธิ์ UCS/UC จาก HOSxP)',
                    db_type: 'hosxp',
                    query_text: `select 
  IF(ov.an is null, v.vn, "Admit") as vn, 
  concat("cid_", v.cid) as cid_check, 
  v.cid, 
  vp.pttype, 
  py.hipdata_code, 
  vp.Auth_Code, 
  vp.claim_code, 
  td.claimcode, 
  td.authen_code_type, 
  vp.pttype_note,
  vp.staff,
  IF((select count(cid) from vn_stat where $__timeFilter(vstdate) AND cid=v.cid) > 1, "ตรวจสอบ", 
    IF(vp.claim_code=td.claimcode, "ตรง", 
      IF(td.claimcode is null, "ยังไม่ได้นำเข้า", "ไม่ตรง")
    )
  ) AS check_claimcode,
  v.uc_money,
  k.department,
  count(distinct v.cid) as cc_cid
from vn_stat v
LEFT OUTER JOIN visit_pttype vp on vp.vn = v.vn 
LEFT OUTER JOIN temp_authen_code td on td.cid = v.cid AND td.status_use<>'C' and $__timeFilter(td.dateser) AND td.flag="D"
LEFT OUTER JOIN pttype py on py.pttype = v.pttype
LEFT OUTER JOIN ovst ov on ov.vn = v.vn
LEFT JOIN kskdepartment k on k.depcode = ov.main_dep
where $__timeFilter(v.vstdate) AND py.hipdata_code in ($hipdata_code) 
GROUP BY v.vn
ORDER BY vp.Auth_Code, vp.claim_code`
                },
                {
                    name: '2. สรุปความครอบคลุมการ Authen แยกตามแผนก (HOSxP)',
                    db_type: 'hosxp',
                    query_text: `SELECT 
    k.department AS แผนก,
    COUNT(DISTINCT o.vn) AS ผู้รับบริการทั้งหมด,
    COUNT(DISTINCT CASE WHEN vp.claim_code IS NOT NULL THEN o.vn END) AS มีAuthenCode,
    COUNT(DISTINCT CASE WHEN vp.claim_code IS NULL THEN o.vn END) AS ไม่มีAuthenCode,
    ROUND(COUNT(DISTINCT CASE WHEN vp.claim_code IS NOT NULL THEN o.vn END) * 100.0 / COUNT(DISTINCT o.vn), 2) AS เปอร์เซ็นต์Authen
FROM ovst o
LEFT JOIN vn_stat v ON v.vn = o.vn
LEFT JOIN visit_pttype vp ON vp.vn = o.vn
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
WHERE $__timeFilter(o.vstdate)
  AND o.pttype IN (SELECT pttype FROM pttype WHERE hipdata_code = 'UCS' OR pttype_group1 IN ('UC', 'UCS'))
GROUP BY k.department
ORDER BY ผู้รับบริการทั้งหมด DESC;`
                },
                {
                    name: '3. รายการตรวจสอบสิทธิ์ในฐานข้อมูล Tracking ภายใน',
                    db_type: 'tracker',
                    query_text: `SELECT 
    vn, hn, cid, full_name, visit_date, pttype, 
    claim_code, authen_code_type, department, subdistrict_name, color_status, updated_at
FROM visit_tracking 
WHERE visit_date = CURDATE()
ORDER BY color_status ASC;`
                }
            ];

            for (const q of defaultQueries) {
                await trackerPool.query(
                    'INSERT INTO saved_queries (name, query_text, db_type) VALUES (?, ?, ?)',
                    [q.name, q.query_text, q.db_type]
                );
            }
            console.log('✅ Prepopulated default SQL templates.');
        }

    } catch (error) {
        console.error('❌ Failed to initialize internal database:', error);
    }
}
