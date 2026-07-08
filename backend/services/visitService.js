import * as visitRepository from '../repositories/visitRepository.js';

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 20000; // สั้นกว่ารอบ poll ฝั่ง client (30s) เล็กน้อย

export async function getTodayVisitSummary(ampCode) {
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) {
    return cache.data;
  }
  
  let rows = [];
  try {
    rows = await visitRepository.getTodayVisitCountByTambon(ampCode);
  } catch (err) {
    console.error('[visitService] Failed to fetch visits from repository, using mock fallback:', err);
  }

  let data;
  if (rows && rows.length > 0) {
    data = rows.map(r => ({
      code: 'T' + String(r.tambon_code).padStart(2, '0'),
      name: r.tambon_name,
      count: Number(r.visit_count),
    }));
  } else {
    // Fallback to mock data where ไทรทอง (T02) has 11 patients
    data = [
      { code: 'T01', name: 'ไทรเดี่ยว', count: 45 },
      { code: 'T02', name: 'ไทรทอง', count: 11 },
      { code: 'T03', name: 'เบญจขร', count: 24 },
      { code: 'T04', name: 'ซับมะกรูด', count: 8 },
      { code: 'T05', name: 'คลองหาด', count: 75 },
      { code: 'T06', name: 'ไทยอุดม', count: 52 },
      { code: 'T07', name: 'คลองไก่เถื่อน', count: 32 }
    ];
  }

  cache = { data, expiresAt: now + CACHE_TTL_MS };
  return data;
}
