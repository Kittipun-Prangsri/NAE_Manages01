import * as visitRepository from '../repositories/visitRepository.js';

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 20000; // สั้นกว่ารอบ poll ฝั่ง client (30s) เล็กน้อย

export async function getTodayVisitSummary(ampCode) {
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) {
    return cache.data;
  }
  const rows = await visitRepository.getTodayVisitCountByTambon(ampCode);
  const data = rows.map(r => ({
    code: 'T' + String(r.tambon_code).padStart(2, '0'),
    name: r.tambon_name,
    count: Number(r.visit_count),
  }));
  cache = { data, expiresAt: now + CACHE_TTL_MS };
  return data;
}
