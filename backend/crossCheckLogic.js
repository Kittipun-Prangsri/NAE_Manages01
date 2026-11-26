const ENDPOINT_CHANNELS = ['EP', 'ENDPOINT'];

const text = value => String(value ?? '').trim();
const pad = value => String(value ?? 0).padStart(2, '0');

/**
 * แปลงวันที่จากรายงานหรือ HOSxP (Date, YYYY-MM-DD, DD/MM/YYYY, พ.ศ. หรือ ค.ศ.)
 * ให้เป็น "YYYY-MM-DD HH:mm:ss" แบบ ค.ศ. คืน null เมื่ออ่านไม่ได้
 */
function toGregorianDateTime(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }

    const str = text(value);
    const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(str);
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str);
    if (!ymd && !dmy) return null;

    const [year, month, day] = ymd ? [ymd[1], ymd[2], ymd[3]] : [dmy[3], dmy[2], dmy[1]];
    const gregorianYear = Number(year) > 2400 ? Number(year) - 543 : Number(year);
    const [, hour, minute, second] = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(str) || [];
    return `${gregorianYear}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

const toDate = value => toGregorianDateTime(value)?.slice(0, 10) || null;

// รายงาน สปสช. เก็บสถานะ E / C ไว้ในคอลัมน์ "รหัสการเข้ารับบริการ"
// (คอลัมน์เดียวกับที่ขั้นตอนอัปเดต HOSxP ใช้กรองรายการยกเลิก)
function isCancelled(row) {
    return [row['รหัสการเข้ารับบริการ'], row.statusUse, row['สถานะใช้งาน']]
        .map(value => text(value).toUpperCase())
        .some(value => value === 'C' || value.includes('ยกเลิก'));
}

function readReportRow(row) {
    // ค่าที่ผู้ใช้จับคู่คอลัมน์ไว้ (cid, authenCode, channel, visitDate) มาก่อนหัวคอลัมน์มาตรฐาน
    const authenCode = row.authenCode || row['CLAIM CODE'] || row.CLAIM_CODE || null;
    const channel = text(row.channel || row['ช่องทางการขอ Authen Code']);

    return {
        cid: text(row.cid || row['เลขบัตร'] || row.CID),
        authenCode,
        channel,
        isEndpoint: Boolean(authenCode) && ENDPOINT_CHANNELS.includes(channel.toUpperCase()),
        serviceDate: toDate(row.visitDate || row['วันที่เข้ารับบริการ'] || row.dateser),
        recordedAt: toGregorianDateTime(row.dateAuthen || row['วันที่บันทึก Authen Code']) || ''
    };
}

// ลำดับเดียวกับการเลือก flag 'D' ใน HOSxP: มีรหัสก่อน, รหัสขึ้นต้น E ก่อน, แล้วรายการล่าสุด
function compareReportRows(a, b) {
    const startsWithE = row => text(row.authenCode).toUpperCase().startsWith('E');
    return (Boolean(a.authenCode) - Boolean(b.authenCode))
        || (startsWithE(a) - startsWithE(b))
        || (a.isEndpoint - b.isEndpoint)
        || a.recordedAt.localeCompare(b.recordedAt);
}

/**
 * ฟังก์ชันหลักในการเปรียบเทียบข้อมูล HOSxP กับ Excel ของ สปสช.
 */
export function processCrossCheck(hosxpData, excelData) {
    // 1. จัดกลุ่มข้อมูล Excel ตาม CID (ไม่นับรายการที่ถูกยกเลิก)
    const reportRowsByCid = new Map();
    excelData.filter(row => !isCancelled(row)).map(readReportRow).forEach(row => {
        if (!row.cid) return;
        if (!reportRowsByCid.has(row.cid)) reportRowsByCid.set(row.cid, []);
        reportRowsByCid.get(row.cid).push(row);
    });

    // 2. นับความถี่ของ CID เพื่อหาเคสที่คนไข้มาตรวจซ้ำในวันเดียวกัน
    const cidCounts = {};
    hosxpData.forEach(p => {
        const cid = text(p.cid);
        if (cid) {
            cidCounts[cid] = (cidCounts[cid] || 0) + 1;
        }
    });

    // 3. วนลูปข้อมูล HOSxP เพื่อกำหนดสถานะสีและจับคู่เคลมโค้ด
    return hosxpData.map(patient => {
        const cid = text(patient.cid);
        const visitDate = toDate(patient.visitDate);
        // ใช้เฉพาะรายการของวันที่เข้ารับบริการ (รายการที่ไม่ระบุวันที่ถือว่าใช้ได้)
        const nhso = (reportRowsByCid.get(cid) || [])
            .filter(row => !row.serviceDate || !visitDate || row.serviceDate === visitDate)
            .reduce((best, row) => (!best || compareReportRows(row, best) >= 0 ? row : best), null);

        const authenCode = nhso?.authenCode || null;
        const authenCodeType = nhso?.channel || null;
        const authenStatus = Boolean(authenCode);
        const endpointStatus = Boolean(nhso?.isEndpoint);

        // RED = ไม่พบ Authen Code, YELLOW = มีรหัสแต่ยังไม่ปิด Endpoint, GREEN = ครบถ้วน
        let color = 'RED';
        if (endpointStatus) {
            color = 'GREEN';
        } else if (authenStatus) {
            color = 'YELLOW';
        }

        // วิเคราะห์สถานะจับคู่เคลมโค้ด (เลียนแบบ Logic ใน Grafana)
        let checkClaimcode = 'ยังไม่ได้นำเข้า';
        if (cid && cidCounts[cid] > 1) {
            checkClaimcode = 'ตรวจสอบ';
        } else if (authenCode) {
            // เปรียบเทียบรหัส claim_code ใน HOSxP (patient.claim_code) กับใน Excel/NHSO (authenCode)
            const hosxpClaim = text(patient.claim_code);
            checkClaimcode = hosxpClaim && hosxpClaim === text(authenCode) ? 'ตรง' : 'ไม่ตรง';
        }

        return {
            vn: patient.vn,
            hn: patient.hn,
            cid: patient.cid,
            full_name: patient.fullName,
            visit_date: patient.visitDate,
            pttype: patient.pttype,
            pcode: patient.pcode,
            uc_money: patient.uc_money,
            item_money: patient.item_money,
            department: patient.department,
            subdistrict_code: patient.subdistrict_code,
            subdistrict_name: patient.subdistrict_name,
            staff: patient.staff || null,
            // หากพบใน Excel ให้นำค่าใหม่มาแสดง มิฉะนั้นใช้ค่าเดิมจาก HOSxP
            claim_code: authenCode || patient.claim_code,
            authen_code_type: authenCodeType || patient.pttype_note,
            pttype_note: authenCodeType || patient.pttype_note,
            nhso_authen_code: authenCode,
            authen_status: authenStatus,
            endpoint_status: endpointStatus,
            color_status: color,
            check_claimcode: checkClaimcode
        };
    });
}
