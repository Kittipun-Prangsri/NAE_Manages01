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
