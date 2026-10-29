// Runs on the NHSO portal.  On the "ยืนยันตัวตนแทนผู้เข้ารับบริการ" page it shows a
// panel with today's endpoint cases from NHSO Tracker; after the officer approves
// the list it does each case the way staff do by hand, letting the page's own
// Smart Card Agent read the officer's card (inserted in this PC's reader).
// One case per page load: the run state lives in chrome.storage so it resumes
// after the page reloads for the next case.

(() => {
    const BEHALF_URL = 'https://authenservice.nhso.go.th/authencode/nhso-endpoint/create/behalf';
    const RELATION = 'เจ้าหน้าที่ผู้ดูแล';
    const IDS = { caregiver: 'guarantorType_T', recorder: 'guarantorType_S', relation: 'guarantor_relation-nosmc' };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const api = (path, options) => chrome.runtime.sendMessage({ type: 'api', path, options });
    const getRun = async () => (await chrome.storage.local.get('run')).run || null;
    const setRun = run => chrome.storage.local.set({ run });
    const onBehalfPage = () => location.pathname.includes('/nhso-endpoint/create/behalf');
    const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;

    async function waitFor(check, timeoutMs, stepName) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const value = check();
            if (value) return value;
            await sleep(300);
        }
        throw new Error(`รอ "${stepName}" นานเกิน ${Math.round(timeoutMs / 1000)} วินาที`);
    }

    function setValue(el, value) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function selectByText(select, text) {
        const option = [...select.options].find(o => o.text.trim() === text);
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function buttonByText(pattern, root = document) {
        return [...root.querySelectorAll('button, a')].filter(el => visible(el) && pattern.test(el.innerText.trim())).pop() || null;
    }

    /** Error texts the portal shows next to fields or in alerts, for messages to staff. */
    function portalErrors() {
        return [...document.querySelectorAll('gt-error, .invalid-feedback, .text-danger, .alert-danger, .toast, .swal2-html-container')]
            .filter(visible).map(el => el.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4).join(' | ');
    }

    function openModal() {
        return [...document.querySelectorAll('.modal.show, .modal[style*="display: block"], [role="dialog"], .swal2-popup')].find(visible) || null;
    }

    // ---- one case -------------------------------------------------------------

    async function searchPatient(c) {
        const pid = await waitFor(() => document.getElementById('search-pid'), 20000, 'ช่องเลขบัตร');
        setValue(pid, c.cid);
        const search = buttonByText(/^ค้นหา$/);
        if (!search) throw new Error('ไม่พบปุ่ม "ค้นหา"');
        search.click();
        await waitFor(() => document.getElementById('identity-reason'), 20000, 'ผลการค้นหาผู้ป่วย');
        await sleep(800);
        const drugs = Number((/จำนวนทั้งหมด\s*([\d,]+)\s*รายการ/.exec(document.body.innerText) || [])[1]?.replace(/,/g, '') || 0);
        if (drugs > 0) throw new Error(`มีรายการรับยาผิดปกติ ${drugs} รายการ ต้องให้เจ้าหน้าที่ตรวจเอง`);
    }

    function fillForm(c) {
        if (!c.reason) throw new Error('ไม่มีเหตุผลที่ตรงเงื่อนไข (ให้ผู้ดูแลระบบตั้ง ENDPOINT_DEFAULT_REASON)');
        if (!selectByText(document.getElementById('identity-reason'), c.reason)) throw new Error(`ไม่พบเหตุผล "${c.reason}" ในฟอร์ม`);
        setValue(document.getElementById('paidAmount'), c.amount);
        const general = document.getElementById('servicetype0');
        if (general && !general.checked) general.click();
    }

    /** Officer = the card in this PC's reader, read by the page through the NHSO Agent. */
    async function readOfficerCard() {
        const ready = () => document.querySelector('input[id^="guarantorType_"]') || buttonByText(/^ยืนยันไม่มีผู้ดูแล$/);
        if (!ready()) {
            buttonByText(/ตรวจสอบ\s*Agent/)?.click();
            try {
                await waitFor(ready, 20000, 'อ่านบัตรผู้รับรองจากเครื่องอ่านบัตร');
            } catch {
                const agentDown = /ไม่สามารถเชื่อมต่อ Smart Card/.test(document.body.innerText);
                throw new Error(agentDown
                    ? 'ต่อเครื่องอ่านบัตรไม่ได้: เปิดโปรแกรม Agent ของ สปสช. และเสียบบัตรประชาชนของคุณ แล้วกดเริ่มใหม่'
                    : 'อ่านบัตรผู้รับรองไม่สำเร็จ: ตรวจว่าเสียบบัตรประชาชนของคุณแล้ว');
            }
        }
    }

    /** Same rules as the server bot: recorder after "ยืนยันไม่มีผู้ดูแล", or caregiver when the portal locks it. */
    async function setCertifier() {
        const confirmNoCaregiver = buttonByText(/^ยืนยันไม่มีผู้ดูแล$/);
        if (confirmNoCaregiver) { confirmNoCaregiver.click(); await sleep(800); }
        const caregiver = document.getElementById(IDS.caregiver);
        const recorder = document.getElementById(IDS.recorder);
        if (caregiver && recorder && !caregiver.checked && !recorder.checked && !caregiver.disabled) {
            (document.querySelector(`label[for="${IDS.caregiver}"]`) || caregiver).click();
            await sleep(500);
            const confirm = await waitFor(() => buttonByText(/^ยืนยันไม่มีผู้ดูแล$/), 5000, 'กล่องยืนยันไม่มีผู้ดูแล').catch(() => null);
            confirm?.click();
            await sleep(800);
        }
        const relation = await waitFor(() => {
            const select = document.getElementById(IDS.relation);
            return select && [...select.options].some(o => o.text.trim() === RELATION) ? select : null;
        }, 8000, 'รายการความสัมพันธ์');
        selectByText(relation, RELATION);
        await sleep(400);
        const recorderOk = recorder?.checked;
        const caregiverLocked = caregiver?.checked && recorder?.disabled;
        const relationOk = relation.options[relation.selectedIndex]?.text.trim() === RELATION;
        if (!(recorderOk || caregiverLocked) || !relationOk) throw new Error('ตั้งผู้รับรอง/ความสัมพันธ์ไม่ได้ — ไม่บันทึก');
    }

    function formLooksFilled(c) {
        return Number(document.getElementById('paidAmount')?.value) === Number(c.amount)
            && document.getElementById('identity-reason')?.selectedIndex > 0
            && document.getElementById('servicetype0')?.checked;
    }

    /** Save, confirm the "ยืนยันการบันทึก" prompt, and treat the print prompt as success. */
    async function save() {
        const button = buttonByText(/^บันทึก$/);
        if (!button) throw new Error('ไม่พบปุ่ม "บันทึก"');
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
            throw new Error(`ปุ่มบันทึกยังกดไม่ได้ — ฟอร์มยังไม่ครบ${portalErrors() ? `: ${portalErrors()}` : ''}`);
        }
        button.click();
        let confirms = 0;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            await sleep(800);
            const modal = openModal();
            const text = modal?.innerText.replace(/\s+/g, ' ') || '';
            if (modal && (/พิมพ์/.test(text) || /สำเร็จ/.test(text))) {
                buttonByText(/^(ยกเลิก|ปิด)$/, modal)?.click();
                return;
            }
            const confirm = modal && buttonByText(/^(ยืนยัน|ตกลง|ใช่|OK|Yes)$/i, modal);
            if (confirm && confirms < 2) { confirms += 1; confirm.click(); }
        }
        const shown = portalErrors() || openModal()?.innerText.replace(/\s+/g, ' ').trim().slice(0, 150) || '';
        throw Object.assign(new Error(`กดบันทึกแล้วไม่เห็นหน้าพิมพ์${shown ? ` (หน้าเว็บแสดง: ${shown})` : ''} — หยุด ให้ตรวจในเมนู "ค้นหา/ลบรายการที่ยืนยันแล้ว" ก่อน`), { unconfirmed: true });
    }

    async function doCase(c) {
        await searchPatient(c);
        fillForm(c);
        await readOfficerCard();
        await setCertifier();
        if (!formLooksFilled(c)) throw new Error('ข้อมูลในฟอร์มไม่ครบ — ไม่บันทึก');
        await save();
    }

    // ---- run loop + panel -----------------------------------------------------

    async function continueRun() {
        const run = await getRun();
        if (!run || !run.running || !onBehalfPage()) return render();
        const c = run.queue[run.index];
        if (!c) {
            run.running = false;
            run.message = `เสร็จแล้ว: บันทึก ${run.results.filter(r => r.ok).length}/${run.queue.length} ราย`;
            await setRun(run);
            return render();
        }
        run.message = `ราย ${run.index + 1}/${run.queue.length}: VN ${c.vn} (${c.amount} บาท)`;
        await setRun(run);
        render();
        try {
            await doCase(c);
            await api('/endpoint/manual-done', { method: 'POST', body: { vn: c.vn, method: 'extension' } });
            run.results.push({ vn: c.vn, ok: true, text: `✅ บันทึกแล้ว VN ${c.vn} (${c.amount} บาท)` });
            run.index += 1;
            await setRun(run);
            await sleep(1500);
            location.href = BEHALF_URL; // fresh form for the next case; resumes on load
        } catch (err) {
            // Stop on the first problem: staff check it before anything else is certified.
            run.running = false;
            if (err.unconfirmed) {
                // May have been saved on the portal: hold it back from the next run until checked.
                await api('/endpoint/manual-done', { method: 'POST', body: { vn: c.vn, method: 'extension', status: 'unconfirmed', note: err.message } });
            }
            run.results.push({ vn: c.vn, ok: false, text: `⛔ หยุดที่ VN ${c.vn}: ${err.message}${err.unconfirmed ? ' (รายนี้ถูกพักไว้ ไม่ทำซ้ำจนกว่าผู้ดูแลระบบจะปลดล็อก)' : ''}` });
            run.message = `หยุดที่ราย ${run.index + 1}/${run.queue.length}`;
            await setRun(run);
            render();
        }
    }

    async function loadCases() {
        const response = await api('/endpoint/manual-cases');
        if (!response?.ok) throw new Error(response?.data?.message || 'โหลดรายการไม่สำเร็จ');
        return (response.data.cases || []).filter(c => !c.done);
    }

    let panel;
    function ensurePanel() {
        if (panel && document.body.contains(panel)) return panel;
        panel = document.createElement('div');
        panel.id = 'nae-endpoint-helper';
        panel.style.cssText = 'position:fixed;right:16px;top:72px;z-index:2147483647;width:340px;max-height:45vh;overflow:auto;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.25);font:13px system-ui,sans-serif;padding:12px;';
        document.body.appendChild(panel);
        return panel;
    }

    function esc(text) {
        return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    let pendingCases = null;
    async function render() {
        if (!onBehalfPage()) { panel?.remove(); return; }
        const el = ensurePanel();
        const run = await getRun();
        const btn = 'border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font-size:13px;';
        const log = (run?.results || []).slice(-8).map(r => `<div style="margin-top:4px">${esc(r.text)}</div>`).join('');
        if (run?.running) {
            el.innerHTML = `<b>🩺 Endpoint อัตโนมัติ (Smart Card)</b><div style="margin-top:6px">${esc(run.message)}</div>${log}
                <button id="nae-stop" style="${btn}margin-top:10px;background:#fee2e2;color:#991b1b;width:100%">หยุด</button>`;
            el.querySelector('#nae-stop').onclick = async () => { const r = await getRun(); r.running = false; r.message = 'หยุดโดยผู้ใช้'; await setRun(r); render(); };
            return;
        }
        el.innerHTML = `<b>🩺 Endpoint ด้วยเครื่องอ่านบัตร</b>
            <div style="margin-top:6px;color:#475569">เสียบบัตรประชาชนของคุณในเครื่องอ่านบัตร และเปิดโปรแกรม Agent ของ สปสช. ก่อนเริ่ม</div>
            ${run?.message ? `<div style="margin-top:8px">${esc(run.message)}</div>${log}` : ''}
            <div id="nae-list" style="margin-top:8px;color:#475569">กำลังโหลดรายการ...</div>`;
        try {
            pendingCases = await loadCases();
        } catch (err) {
            el.querySelector('#nae-list').innerHTML = `<span style="color:#b91c1c">${esc(err.message)}</span>`;
            return;
        }
        const list = el.querySelector('#nae-list');
        if (pendingCases.length === 0) { list.textContent = 'วันนี้ไม่มีรายการที่ต้องทำ Endpoint'; return; }
        const total = pendingCases.reduce((sum, c) => sum + Number(c.amount), 0);
        // One radio group: "ทั้งหมด" (value "") or a single case, like the web app's list.
        list.innerHTML = `<label style="display:block;margin-top:4px;color:#0f172a;cursor:pointer"><input type="radio" name="nae-pick" value="" checked> <b>ทั้งหมด</b> (${pendingCases.length} ราย • ${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)</label>
            ${pendingCases.map(c => `<label style="display:block;margin-top:6px;color:#0f172a;cursor:pointer"><input type="radio" name="nae-pick" value="${esc(c.vn)}"> VN ${esc(c.vn)} • ${esc(c.amount)} บาท<br><span style="margin-left:20px;color:#64748b;font-size:12px">${esc(c.reason || 'ไม่มีเหตุผล (จะหยุดที่รายนี้)')}</span></label>`).join('')}
            <div style="margin-top:8px;font-size:12px;color:#92400e">บัตรที่เสียบอยู่จะใช้รับรองทุกรายที่เลือก ตรวจยอดและเหตุผลก่อนกดอนุมัติ</div>
            <button id="nae-start" style="${btn}margin-top:10px;background:#059669;color:#fff;width:100%">อนุมัติและเริ่ม (${pendingCases.length} ราย)</button>`;
        const picked = () => pendingCases.find(c => c.vn === el.querySelector('input[name="nae-pick"]:checked')?.value) || null;
        el.querySelectorAll('input[name="nae-pick"]').forEach(radio => radio.addEventListener('change', () => {
            const one = picked();
            el.querySelector('#nae-start').textContent = one ? `อนุมัติและทำ VN ${one.vn}` : `อนุมัติและเริ่ม (${pendingCases.length} ราย)`;
        }));
        el.querySelector('#nae-start').onclick = async () => {
            const one = picked();
            const queue = one ? [one] : pendingCases;
            const sum = queue.reduce((s, c) => s + Number(c.amount), 0);
            if (!confirm(one
                ? `ยืนยันทำ Endpoint VN ${one.vn} (${one.amount} บาท) โดยใช้บัตรที่เสียบอยู่รับรอง?`
                : `ยืนยันทำ Endpoint ${queue.length} ราย รวม ${sum.toFixed(2)} บาท โดยใช้บัตรที่เสียบอยู่รับรองทุกราย?`)) return;
            await setRun({ running: true, queue, index: 0, results: [], message: 'กำลังเริ่ม...', startedAt: Date.now() });
            if (!onBehalfPage()) { location.href = BEHALF_URL; return; }
            continueRun();
        };
    }

    // The portal is a single-page app: react to route changes as well as page loads.
    let lastPath = '';
    setInterval(() => {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            setTimeout(continueRun, 1500);
        }
    }, 1000);
})();
