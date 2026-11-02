import { hosxpPool } from './db.js';

// Visits that still need an NHSO endpoint: the same rows the web app shows in
// "รายการ UCS ที่ต้องติดตาม" (UC right, UC money > 0, authen type still
// AUTHENCODE or empty, not admitted).

/** Pure filter shared by the endpoint job and its tests. */
export function isEndpointCandidate(row) {
    const pcode = String(row.pcode || '').toUpperCase();
    const authenType = String(row.authen_code_type || row.pttype_note || '').toUpperCase().trim();
    return ['UC', 'UCS'].includes(pcode)
        && Number(row.uc_money) > 0
        && (authenType === 'AUTHENCODE' || authenType === '')
        && !row.an
        && /^\d{13}$/.test(String(row.cid || ''));
}

/**
 * Picks the "เหตุผลการไม่ยืนยันตัวตนด้วยตนเอง" option for a patient.
 * Children use the matching age option from the form; everyone else uses the
 * reason configured by the hospital (ENDPOINT_DEFAULT_REASON).  Returns null
 * when nothing matches, so the case is skipped instead of guessed.
 */
export function chooseEndpointReason(ageYears, optionTexts, defaultReason = process.env.ENDPOINT_DEFAULT_REASON) {
    const find = pattern => optionTexts.find(text => pattern.test(text)) || null;
    if (Number.isFinite(ageYears)) {
        if (ageYears < 7) {
            const under7 = find(/7\s*ปี/);
            if (under7) return under7;
        }
        if (ageYears < 15) {
            const under15 = find(/15\s*ปี/);
            if (under15) return under15;
        }
    }
    if (!defaultReason) return null;
    return optionTexts.find(text => text.trim() === defaultReason.trim()) || null;
}

export async function getEndpointCandidates(visitDate) {
    const [rows] = await hosxpPool.query(
        `SELECT
            v.vn,
            v.cid,
            v.hn,
            v.age_y,
            v.uc_money,
            DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
            TIME_FORMAT(ov.vsttime, '%H:%i') AS vsttime,
            ov.an,
            py.hipdata_code AS pcode,
            td.authen_code_type,
            vp.pttype_note,
            CAST(CONVERT(k.department USING utf8) AS CHAR) AS department
         FROM vn_stat v
         LEFT JOIN visit_pttype vp ON vp.vn = v.vn
         LEFT JOIN temp_authen_code td ON td.cid = v.cid
            AND td.status_use <> 'C'
            AND td.dateser = v.vstdate
            AND td.flag = 'D'
         LEFT JOIN pttype py ON py.pttype = v.pttype
         LEFT JOIN ovst ov ON ov.vn = v.vn
         LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
         WHERE v.vstdate = ?
         GROUP BY v.vn
         ORDER BY ov.vsttime`,
        [visitDate]
    );
    return rows.filter(isEndpointCandidate);
}

/**
 * Visits that have no Authen Code yet: the rows behind the "ยังไม่นำเข้า" figure
 * (UCS right, not admitted, no usable temp_authen_code claim), newest first so the
 * patient standing at the counter is at the top.
 */
export async function getAuthenCandidates(visitDate) {
    const [rows] = await hosxpPool.query(
        `SELECT
            v.vn,
            v.cid,
            v.hn,
            v.age_y,
            TIME_FORMAT(ov.vsttime, '%H:%i') AS vsttime,
            CAST(CONVERT(k.department USING utf8) AS CHAR) AS department
         FROM vn_stat v
         LEFT JOIN ovst ov ON ov.vn = v.vn
         LEFT JOIN temp_authen_code td ON td.cid = v.cid
            AND td.status_use <> 'C'
            AND td.dateser = v.vstdate
            AND td.flag = 'D'
         LEFT JOIN pttype py ON py.pttype = v.pttype
         LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
         WHERE v.vstdate = ?
           AND UPPER(py.hipdata_code) = 'UCS'
           AND COALESCE(ov.pt_subtype, '') <> '1'
           AND ov.an IS NULL
           AND td.claimcode IS NULL
         GROUP BY v.vn
         ORDER BY ov.vsttime DESC`,
        [visitDate]
    );
    return rows.filter(row => /^\d{13}$/.test(String(row.cid || '')));
}

/** "22:30" -> { hour, minute }; empty / "off" / invalid -> null (reminder disabled). */
export function parseReminderTime(value = process.env.ENDPOINT_REMINDER_TIME ?? '22:30') {
    const text = String(value).trim().toLowerCase();
    if (!text || text === 'off') return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/**
 * End-of-day message listing what is still open, or null when nothing is.
 * endpoint: cases still to do ({ count, amount }), held: cases whose save was
 * never confirmed (a person must check the portal), authen: visits without an
 * Authen Code.
 */
export function formatEndOfDayReminder({ visitDate, endpoint, held, authen }, deadline = '23:59') {
    if (!endpoint.count && !held.length && !authen.count) return null;
    const lines = [`🔔 สรุปรายการค้างวันที่ ${visitDate} (ทำได้ถึง ${deadline})`];
    if (endpoint.count) {
        lines.push(`• Endpoint ที่ยังไม่ได้ทำ: ${endpoint.count} ราย รวม ${Number(endpoint.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`);
    }
    if (held.length) {
        lines.push(`• พักไว้รอตรวจในเว็บ สปสช. (ไม่แน่ใจว่าบันทึกแล้ว): ${held.length} ราย — ผู้ดูแลระบบปลดล็อกได้ในหน้าจัดการระบบ`);
    }
    if (authen.count) {
        lines.push(`• ยังไม่ได้ขอ Authen Code: ${authen.count} ราย`);
    }
    lines.push('ใช้ปุ่ม "ทำ Endpoint" ในเว็บ หรือส่วนเสริม Chrome ที่เคาน์เตอร์');
    return lines.join('\n');
}

export function getClaimOffsetMinutes(value = process.env.ENDPOINT_CLAIM_OFFSET_MINUTES) {
    const minutes = Number(value);
    return Number.isInteger(minutes) && minutes >= 0 && minutes <= 240 ? minutes : 30;
}

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * Times for the NHSO form: service = the visit time in HOSxP; claim
 * ("วันที่เบิกสิทธิ") = service + the hospital's fixed offset, capped at 23:59 so it
 * stays on the visit day (missed cases are closed the same day).  A claim time
 * still in the future is not ready yet, so the case waits for a later run.
 */
export function endpointTimes(vsttime, nowHHMM, offsetMinutes = getClaimOffsetMinutes()) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(vsttime || ''));
    if (!match) return { service: null, claim: null, ready: false };
    const serviceMin = Number(match[1]) * 60 + Number(match[2]);
    const claimMin = Math.min(serviceMin + offsetMinutes, LAST_MINUTE_OF_DAY);
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const [nh, nm] = String(nowHHMM).split(':').map(Number);
    return {
        service: fmt(serviceMin),
        claim: fmt(claimMin),
        ready: claimMin <= nh * 60 + nm
    };
}

/** Current time in Bangkok as HH:MM (the server's clock zone may differ). */
export function bangkokNowHHMM(date = new Date()) {
    return date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}
