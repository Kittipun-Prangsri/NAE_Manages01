// Watches /api/health and reports when the web system stops working, and when it
// is back.  A single failed check (for example during a restart) is ignored.

/** One check of a health URL: { ok, detail }.  Details never include database error text. */
export async function checkHealthUrl(url, fetchImpl = fetch) {
    let response;
    try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    } catch (err) {
        return { ok: false, detail: `ติดต่อ server ไม่ได้ (${err.cause?.code || err.name})` };
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success !== false) return { ok: true, detail: '' };
    const down = Object.entries(body?.database || {}).filter(([, up]) => !up).map(([name]) => name);
    const issues = body?.configuration?.valid === false ? ['config ไม่ครบ'] : [];
    const reasons = [down.length ? `ฐานข้อมูลต่อไม่ได้: ${down.join(', ')}` : '', ...issues].filter(Boolean);
    return { ok: false, detail: `HTTP ${response.status}${reasons.length ? ` — ${reasons.join(', ')}` : ''}` };
}

/** Returns tick(): call it on an interval.  repeatEvery: remind after this many more failures. */
export function createHealthMonitor({ check, notify, failuresBeforeAlert = 2, repeatEvery = 12 }) {
    let failures = 0;
    return async function tick() {
        const { ok, detail } = await check();
        if (ok) {
            if (failures >= failuresBeforeAlert) await notify('✅ ระบบ NHSO Tracker กลับมาใช้งานได้แล้ว');
            failures = 0;
            return;
        }
        failures += 1;
        const since = failures - failuresBeforeAlert;
        if (since >= 0 && since % repeatEvery === 0) {
            await notify(`🚨 ระบบ NHSO Tracker มีปัญหา (ตรวจไม่ผ่าน ${failures} ครั้งติด)\n${detail}`);
        }
    };
}
