import hosxpPool from '../db/hosxpPool.js';

/**
 * นับจำนวนผู้ป่วยที่ vstdate = วันนี้ แยกตามตำบลที่อยู่ตามทะเบียนบ้าน
 * นับ DISTINCT vn เพื่อไม่ให้ผู้ป่วยคนเดียวมาหลายแผนกถูกนับซ้ำ
 */
export async function getTodayVisitCountByTambon(ampCode) {
  const changwat = ampCode.substring(0, 2);
  const ampur = ampCode.substring(2, 4);
  const sql = `
    SELECT
      p.tmbpart            AS tambon_code,
      CONVERT(t.name USING utf8) AS tambon_name,
      COUNT(DISTINCT o.vn) AS visit_count
    FROM ovst o
    INNER JOIN patient p ON p.hn = o.hn
    LEFT JOIN thaiaddress t
      ON t.chwpart = p.chwpart
     AND t.amppart = p.amppart
     AND t.tmbpart = p.tmbpart
    WHERE o.vstdate = CURDATE()
      AND p.chwpart = ?
      AND p.amppart = ?
      AND p.tmbpart <> '00'
    GROUP BY p.tmbpart, t.name
    ORDER BY visit_count DESC
  `;
  const [rows] = await hosxpPool.query(sql, [changwat, ampur]);
  return rows;
}
