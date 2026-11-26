// Which rights get an NHSO endpoint, and the LINE summary section for the non-UC
// ones.  No database import here: the Express server and the Vercel LINE webhook
// each pass in their own pool.

// Non-UC rights that also need an endpoint, by HOSxP pttype code.  Matched by
// code, not hipdata_code, which they share with rights that are not included.
const OTHER_RIGHTS = Object.freeze([
    { pttype: '16', label: 'อปท.' },       // เบิกจ่ายตรง อปท. (LGO)
    { pttype: '43', label: 'การรถไฟ' }     // เบิกจ่ายตรงการรถไฟแห่งประเทศไทย
]);

export const ENDPOINT_PTTYPES = Object.freeze(OTHER_RIGHTS.map(right => right.pttype));

/** True when the visit's main right is one that gets an endpoint. */
export function isEndpointRight({ pcode, pttype }) {
    return ['UC', 'UCS'].includes(String(pcode || '').toUpperCase())
        || ENDPOINT_PTTYPES.includes(String(pttype || '').trim());
}

// "Endpoint not closed" with the same conditions as the UCS figures of each source.
const PENDING_SQL = {
    // NOT EXISTS rather than a join: several authen rows must not repeat the amount.
    hosxp: `SELECT v.pttype, COUNT(*) AS cnt, COALESCE(SUM(v.uc_money), 0) AS money
        FROM vn_stat v
        LEFT JOIN ovst ov ON ov.vn = v.vn
        WHERE v.vstdate = ?
          AND v.pttype IN (?)
          AND COALESCE(ov.pt_subtype, '') <> '1'
          AND ov.an IS NULL
          AND COALESCE(v.uc_money, 0) > 0
          AND NOT EXISTS (
              SELECT 1 FROM temp_authen_code td
              WHERE td.cid = v.cid
                AND td.status_use <> 'C'
                AND td.dateser = v.vstdate
                AND td.flag = 'D'
                AND td.claimcode IS NOT NULL
                AND UPPER(td.authen_code_type) IN ('EP', 'ENDPOINT'))
        GROUP BY v.pttype`,
    tracker: `SELECT pttype, COUNT(*) AS cnt, COALESCE(SUM(uc_money), 0) AS money
        FROM visit_tracking
        WHERE visit_date = ?
          AND pttype IN (?)
          AND color_status IN ('RED', 'YELLOW')
          AND COALESCE(uc_money, 0) > 0
        GROUP BY pttype`
};

/**
 * Open endpoint visits per non-UC right on one day: [{ label, count, money }],
 * with a zero row for a right that has none.  source: 'hosxp' or 'tracker'.
 */
export async function getOtherRightsPending(pool, visitDate, source) {
    const [rows] = await pool.query(PENDING_SQL[source], [visitDate, ENDPOINT_PTTYPES]);
    return OTHER_RIGHTS.map(({ pttype, label }) => {
        const row = rows.find(r => String(r.pttype).trim() === pttype);
        return { label, count: Number(row?.cnt || 0), money: Number(row?.money || 0) };
    });
}

/** Flex contents of the section.  null = could not be read, shown as such instead of zero. */
export function buildOtherRightsFlexContents(pending) {
    const total = pending ? String(pending.reduce((sum, right) => sum + right.count, 0)) : '-';
    const header = {
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'text', text: 'อปท./การรถไฟ ไม่ได้ปิดสิทธิ', color: '#ffffff', size: 'sm', weight: 'bold', flex: 5 },
            { type: 'text', text: total, color: '#ff4d4d', size: 'md', align: 'end', weight: 'bold', flex: 1 }
        ]
    };
    if (!pending) {
        return [header, { type: 'text', text: ' - ไม่มีข้อมูล', color: '#8c8c8c', size: 'xs' }];
    }
    return [header, ...pending.map(({ label, count, money }) => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'text', text: ` - ${label}`, color: '#8c8c8c', size: 'xs', flex: 3 },
            { type: 'text', text: String(count), color: '#ffffff', size: 'xs', align: 'end', flex: 1 },
            { type: 'text', text: `${money.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`, color: '#ffffff', size: 'xs', align: 'end', flex: 3 }
        ]
    }))];
}
