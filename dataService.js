import { hosxpPool, trackerPool } from './db.js';

/**
 * ดึงข้อมูลผู้ป่วยจาก HOSxP ตามวันที่ระบุ (เฉพาะสิทธิ สปสช.)
 */
export async function getHosxpVisits(visitDate) {
    const query = `
        SELECT 
            IF(ov.an IS NULL, v.vn, 'Admit') AS vn,
            CONCAT('cid_', v.cid) AS cid_check,
            v.cid,
            CONCAT(p.pname, p.fname, ' ', p.lname) as fullName,
            v.vstdate as visitDate,
            vp.pttype,
            py.hipdata_code as pcode,
            vp.Auth_Code as authCode,
            vp.claim_code,
            td.claimcode as nhso_claim_code,
            td.authen_code_type,
            vp.pttype_note,
            vp.staff,
            IF((SELECT COUNT(cid) 
                FROM vn_stat 
                WHERE vstdate = ?
                  AND cid = v.cid) > 1, 
               'ตรวจสอบ', 
               IF(vp.claim_code = td.claimcode, 'ตรง', 
                  IF(td.claimcode IS NULL, 'ยังไม่ได้นำเข้า', 'ไม่ตรง')
               )
            ) AS check_claimcode,
            v.uc_money,
            CONVERT(k.department USING utf8) AS department,
            COUNT(DISTINCT v.cid) AS cc_cid
        FROM vn_stat v
        LEFT JOIN patient p ON p.hn = v.hn
        LEFT OUTER JOIN visit_pttype vp ON vp.vn = v.vn 
        LEFT OUTER JOIN temp_authen_code td ON td.cid = v.cid 
            AND td.status_use <> 'C' 
            AND td.dateser = ?
            AND td.flag = 'D'
        LEFT OUTER JOIN pttype py ON py.pttype = v.pttype
        LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
        LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
        WHERE v.vstdate = ?
          AND py.hipdata_code IN ('UCS', 'OFC')
        GROUP BY v.vn
        ORDER BY vp.Auth_Code, vp.claim_code
    `;

    try {
        const [rows] = await hosxpPool.query(query, [visitDate, visitDate, visitDate]);
        return rows;
    } catch (error) {
        console.error('❌ HOSxP Query Error:', error);
        throw error;
    }
}

/**
 * ดึงจำนวนผู้มาใช้บริการทั้งหมด (คน/Visit) จากตาราง VN_STAT ใน HOSxP
 */
export async function getHosxpTotalVisits(visitDate) {
    const query = `
        SELECT 
            COUNT(DISTINCT hn) as totalPersons,
            COUNT(vn) as totalVisits,
            SUM(uc_money) as totalUcMoney
        FROM vn_stat 
        WHERE vstdate = ?
    `;

    try {
        const [rows] = await hosxpPool.query(query, [visitDate]);
        return rows[0] || { totalPersons: 0, totalVisits: 0, totalUcMoney: 0 };
    } catch (error) {
        console.error('❌ HOSxP Total Visits Query Error:', error);
        return { totalPersons: 0, totalVisits: 0, totalUcMoney: 0 };
    }
}

/**
 * บันทึกหรืออัปเดตข้อมูลผลการ Cross-check ลงใน Internal DB
 */
export async function saveTrackingResults(results) {
    const query = `
        INSERT INTO visit_tracking 
        (vn, hn, cid, full_name, visit_date, pttype, pcode, uc_money, claim_code, authen_code_type, pttype_note, department, nhso_authen_code, authen_status, endpoint_status, color_status, staff, check_claimcode)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        pttype = VALUES(pttype),
        pcode = VALUES(pcode),
        uc_money = VALUES(uc_money),
        claim_code = VALUES(claim_code),
        authen_code_type = VALUES(authen_code_type),
        pttype_note = VALUES(pttype_note),
        department = VALUES(department),
        nhso_authen_code = VALUES(nhso_authen_code),
        authen_status = VALUES(authen_status),
        endpoint_status = VALUES(endpoint_status),
        color_status = VALUES(color_status),
        staff = VALUES(staff),
        check_claimcode = VALUES(check_claimcode),
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = results.map(r => [
        r.vn, r.hn, r.cid, r.full_name, r.visit_date, r.pttype,
        r.pcode, r.uc_money, r.claim_code, r.authen_code_type, r.pttype_note, r.department,
        r.nhso_authen_code, r.authen_status, r.endpoint_status, r.color_status,
        r.staff, r.check_claimcode
    ]);

    try {
        if (values.length === 0) return;
        await trackerPool.query(query, [values]);
        console.log(`✅ Saved/Updated ${results.length} records to internal DB.`);

    } catch (error) {
        console.error('❌ Save Tracking Error:', error.message);
        throw error;
    }
}

/**
 * ประมวลผลข้อมูลและอัปเดตระบบ HOSxP ด้วยคำสั่ง SQL ขั้นสูงตามที่กำหนด
 */
export async function executeAdvancedRunLogic(visitDate) {
    const query = `
        -- 1. ตั้งค่าวันที่ต้องการประมวลผล (ใส่เป็น ค.ศ.)
        SET @target_date = ?; 
        SET @thai_date = DATE_ADD(@target_date, INTERVAL 543 YEAR);

        -- 2. ล้างข้อมูลเก่าของวันที่นั้นในตาราง Temp (เพื่อป้องกันการทำงานซ้ำ)
        DELETE FROM temp_authen_code WHERE dateser = @target_date;

        -- 3. Import ข้อมูลและแปลงวันที่เป็น ค.ศ. ทันที
        INSERT INTO temp_authen_code (
            cid, name, claimcode, status_use, service, 
            authen_code_type, date_service, date_authen, dateser
        )
        SELECT 
            \`เลขบัตร\`, \`ชื่อ-สกุล\`, \`CLAIM CODE\`, \`รหัสการเข้ารับบริการ\`, \`บริการ\`, 
            \`ช่องทางการขอ Authen Code\`, \`วันที่เข้ารับบริการ\`, \`วันที่บันทึก Authen Code\`,
            @target_date -- ใช้ค่าตัวแปรโดยตรงเพื่อความแม่นยำ
        FROM authencode
        WHERE DATE(\`วันที่เข้ารับบริการ\`) = @thai_date;

        -- 4. Mark ตัวเลือกที่ดีที่สุด (Flag 'D') 
        -- เลือก E ล่าสุด ถ้าไม่มีเอา P ล่าสุด ของแต่ละ CID ในวันนั้น
        UPDATE temp_authen_code t
        JOIN (
            SELECT cid, claimcode,
                ROW_NUMBER() OVER (
                    PARTITION BY cid 
                    ORDER BY 
                        CASE WHEN claimcode LIKE 'E%' THEN 1 ELSE 2 END ASC, 
                        date_authen DESC
                ) as ranking
            FROM temp_authen_code
            WHERE dateser = @target_date AND status_use = 'E'
        ) ranking_table ON t.cid = ranking_table.cid AND t.claimcode = ranking_table.claimcode
        SET t.flag = 'D'
        WHERE ranking_table.ranking = 1 
        AND t.dateser = @target_date;

        -- 5. Update ข้อมูลเข้าตารางหลัก (visit_pttype)
        UPDATE visit_pttype vp
        JOIN vn_stat v ON v.vn = vp.vn
        JOIN temp_authen_code td ON td.cid = v.cid AND td.dateser = v.vstdate
        SET vp.pttype_note = td.authen_code_type,
            vp.auth_code = td.claimcode,
            vp.claim_code = td.claimcode
        WHERE v.vstdate = @target_date
        AND td.flag = 'D';
    `;

    try {
        await hosxpPool.query(query, [visitDate]);
        console.log(`✅ Executed advanced HOSxP update logic for date: ${visitDate}`);
    } catch (error) {
        console.error('❌ Advanced Run Logic Error:', error.message);
        throw error;
    }
}

/**
 * แปลงวันที่จาก Excel ให้เป็นรูปแบบที่ MySQL รองรับ (YYYY-MM-DD HH:mm:ss)
 * รองรับทั้งแบบ Date object และแบบ String (DD/MM/YYYY)
 */
function parseExcelDate(val) {
    if (!val) return null;

    // กรณีเป็น Date Object
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        let y = val.getFullYear();
        if (y < 2500) y += 543; // แปลง ค.ศ. เป็น พ.ศ. เพื่อความสอดคล้องของฐานข้อมูล
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        const h = String(val.getHours()).padStart(2, '0');
        const min = String(val.getMinutes()).padStart(2, '0');
        const s = String(val.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    // กรณีเป็น String
    const str = String(val).trim();
    
    // ตรวจสอบรูปแบบ YYYY-MM-DD (เช่น "2026-06-18 12:00:00")
    const ymdRegex = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;
    const ymdMatch = str.match(ymdRegex);
    if (ymdMatch) {
        let [_, y, m, d, h, min, s] = ymdMatch;
        let year = parseInt(y);
        if (year < 2500) year += 543; // แปลง ค.ศ. เป็น พ.ศ.
        y = year.toString().padStart(4, '0');
        m = m.padStart(2, '0');
        d = d.padStart(2, '0');
        h = h ? h.padStart(2, '0') : '00';
        min = min ? min.padStart(2, '0') : '00';
        s = s ? s.padStart(2, '0') : '00';
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    const dmYRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;
    const match = str.match(dmYRegex);

    if (match) {
        let [_, d, m, y, h, min, s] = match;
        let year = parseInt(y);
        if (year < 2500) year += 543; // แปลง ค.ศ. เป็น พ.ศ.
        y = year.toString().padStart(4, '0');
        m = m.padStart(2, '0');
        d = d.padStart(2, '0');
        h = h ? h.padStart(2, '0') : '00';
        min = min ? min.padStart(2, '0') : '00';
        s = s ? s.padStart(2, '0') : '00';
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    return str; // ปล่อยให้ MySQL จัดการถ้าไม่ใช่รูปแบบข้างต้น
}

/**
 * บันทึกข้อมูลดิบจาก Excel ลงในตาราง authencode เพื่อเก็บ Log
 */
export async function saveAuthenLog(excelData, visitDate) {
    if (!excelData || excelData.length === 0) return;

    const query = `
        INSERT INTO authencode 
        (\`รหัสหน่วย\`, \`ชื่อหน่วย\`, \`เลขบัตร\`, \`ชื่อ-สกุล\`, \`วันเกิด ปีเดือนวัน\`, \`เบอร์โทร\`, \`สิทธิหลัก\`, \`สิทธิย่อย\`, 
        \`รหัสการเข้ารับบริการ\`, \`CLAIM CODE\`, \`ประเภทการเข้ารับบริการ\`, \`รหัสบริการ\`, \`บริการ\`, \`HN CODE\`, 
        \`AN CODE\`, \`วันที่เข้ารับบริการ\`, \`วันที่บันทึก Authen Code\`, \`สถานะใช้งาน\`, \`ช่องทางการขอ Authen Code\`, 
        \`วิธีการพิสูจน์ตัวตน\`, \`ผู้จับของการเข้ารับบริการ\`, \`วันที่แก้ไข Authen Code\`, \`ชื่อผู้ที่แก้ใข Authen Code\`, 
        \`หมายเหตุการยกเลิก\`, \`dateser\`)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        \`รหัสหน่วย\` = VALUES(\`รหัสหน่วย\`),
        \`ชื่อหน่วย\` = VALUES(\`ชื่อหน่วย\`),
        \`เลขบัตร\` = VALUES(\`เลขบัตร\`),
        \`ชื่อ-สกุล\` = VALUES(\`ชื่อ-สกุล\`),
        \`วันเกิด ปีเดือนวัน\` = VALUES(\`วันเกิด ปีเดือนวัน\`),
        \`เบอร์โทร\` = VALUES(\`เบอร์โทร\`),
        \`สิทธิหลัก\` = VALUES(\`สิทธิหลัก\`),
        \`สิทธิย่อย\` = VALUES(\`สิทธิย่อย\`),
        \`รหัสการเข้ารับบริการ\` = VALUES(\`รหัสการเข้ารับบริการ\`),
        \`ประเภทการเข้ารับบริการ\` = VALUES(\`ประเภทการเข้ารับบริการ\`),
        \`รหัสบริการ\` = VALUES(\`รหัสบริการ\`),
        \`บริการ\` = VALUES(\`บริการ\`),
        \`HN CODE\` = VALUES(\`HN CODE\`),
        \`AN CODE\` = VALUES(\`AN CODE\`),
        \`วันที่เข้ารับบริการ\` = VALUES(\`วันที่เข้ารับบริการ\`),
        \`วันที่บันทึก Authen Code\` = VALUES(\`วันที่บันทึก Authen Code\`),
        \`สถานะใช้งาน\` = VALUES(\`สถานะใช้งาน\`),
        \`ช่องทางการขอ Authen Code\` = VALUES(\`ช่องทางการขอ Authen Code\`),
        \`วิธีการพิสูจน์ตัวตน\` = VALUES(\`วิธีการพิสูจน์ตัวตน\`),
        \`ผู้จับของการเข้ารับบริการ\` = VALUES(\`ผู้จับของการเข้ารับบริการ\`),
        \`วันที่แก้ไข Authen Code\` = VALUES(\`วันที่แก้ไข Authen Code\`),
        \`ชื่อผู้ที่แก้ใข Authen Code\` = VALUES(\`ชื่อผู้ที่แก้ใข Authen Code\`),
        \`หมายเหตุการยกเลิก\` = VALUES(\`หมายเหตุการยกเลิก\`),
        \`dateser\` = VALUES(\`dateser\`)
    `;

    // เตรียมข้อมูลให้ตรงกับ Column ใน DB
    const values = excelData.map(r => [
        r['รหัสหน่วย'] || null,
        r['ชื่อหน่วย'] || null,
        r['เลขบัตร'] || r.cid || null,
        r['ชื่อ-สกุล'] || r.fullName || null,
        r['วันเกิด ปีเดือนวัน'] || null,
        r['เบอร์โทร'] || null,
        r['สิทธิหลัก'] || null,
        r['สิทธิย่อย'] || null,
        r['รหัสการเข้ารับบริการ'] || r.statusUse || 'E',
        r['CLAIM CODE'] || r.authenCode || null,
        r['ประเภทการเข้ารับบริการ'] || null,
        r['รหัสบริการ'] || null,
        r['บริการ'] || null,
        r['HN CODE'] || null,
        r['AN CODE'] || null,
        parseExcelDate(r['วันที่เข้ารับบริการ'] || r.visitDate),
        parseExcelDate(r['วันที่บันทึก Authen Code'] || r.dateAuthen),
        r['สถานะใช้งาน'] || null,
        r['ช่องทางการขอ Authen Code'] || r.channel || null,
        r['วิธีการพิสูจน์ตัวตน'] || null,
        r['ผู้จับของการเข้ารับบริการ'] || null,
        r['วันที่แก้ไข Authen Code'] || null,
        r['ชื่อผู้ที่แก้ใข Authen Code'] || null,
        r['หมายเหตุการยกเลิก'] || null,
        visitDate || r['dateser'] || r.dateser || null
    ]);

    try {
        await trackerPool.query(query, [values]);
        console.log(`✅ Logged ${excelData.length} records to "authencode" table.`);
    } catch (error) {
        console.warn('⚠️ Could not save to authencode table (it might not exist or columns mismatch):', error.message);
    }
}

/**
 * เรียกใช้ NHSO API เพื่อตรวจสอบ Authen Code รายบุคคล
 */
export async function checkNhsoStatusViaApi(cid, date, serviceCode, token) {
    const url = `${process.env.NHSO_API_URL}?personalId=${cid}&serviceDate=${date}&serviceCode=${serviceCode}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 500) {
                // ถ้า 500 อาจจะเป็นเพราะยังไม่มีข้อมูลในระบบ หรือ Token ผิด
                return null;
            }
            throw new Error(`NHSO API Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`❌ CID ${cid} API Error:`, error.message);
        return null;
    }
}
