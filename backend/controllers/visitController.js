import * as visitService from '../services/visitService.js';

export async function getTodayByTambon(req, res) {
  try {
    const ampCode = process.env.AMPHOE_CODE || '2705'; // รหัสอำเภอคลองหาด (27 = สระแก้ว, 05 = คลองหาด)
    const data = await visitService.getTodayVisitSummary(ampCode);
    res.json(data);
  } catch (err) {
    console.error('[visitController] error:', err);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลผู้ป่วยได้ในขณะนี้' });
  }
}
