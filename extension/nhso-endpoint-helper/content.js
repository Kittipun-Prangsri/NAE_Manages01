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

    const MANUAL_CARD_WAIT_MS = 3 * 60 * 1000;

    /**
     * Officer = the card in this PC's reader.  The portal reads it when someone
     * presses "ตรวจสอบข้อมูลจากบัตร Smart Card" for every case.
     * mode 'auto': the helper presses it.  mode 'manual': the helper points at it
     * and waits for the officer to press it (their own confirmation of the case).
     */
    async function readOfficerCard(mode, setStatus) {
        const ready = () => document.querySelector('input[id^="guarantorType_"]') || buttonByText(/^ยืนยันไม่มีผู้ดูแล$/);
        if (ready()) return;
        const cardButton = () => buttonByText(/ตรวจสอบข้อมูลจากบัตร/);
        if (!cardButton()) {
            // Agent not connected yet: ask the page to look for it again.
            buttonByText(/ตรวจสอบ\s*Agent/)?.click();
            await waitFor(cardButton, 10000, 'ปุ่มตรวจสอบข้อมูลจากบัตร').catch(() => {
                throw new Error('ต่อเครื่องอ่านบัตรไม่ได้: เปิดโปรแกรม Agent ของ สปสช. และเสียบบัตรประชาชนของคุณ แล้วกดเริ่มใหม่');
            });
        }
        if (mode === 'manual') {
            const button = cardButton();
            button.scrollIntoView({ block: 'center' });
            button.style.outline = '4px solid #f59e0b';
            button.style.outlineOffset = '3px';
            await setStatus('👉 กดปุ่ม "ตรวจสอบข้อมูลจากบัตร Smart Card" (กรอบสีส้ม) เพื่อรับรองรายนี้');
            const deadline = Date.now() + MANUAL_CARD_WAIT_MS;
            while (!ready()) {
                if (Date.now() > deadline) throw new Error('รอการกดอ่านบัตรนานเกิน 3 นาที');
                if (!(await getRun())?.running) throw new Error('หยุดโดยผู้ใช้');
                await sleep(500);
            }
            button.style.outline = '';
            return;
        }
        cardButton().click();
        await waitFor(ready, 20000, 'อ่านบัตรผู้รับรอง').catch(() => {
            throw new Error('อ่านบัตรผู้รับรองไม่สำเร็จ: ตรวจว่าเสียบบัตรประชาชนของคุณในเครื่องอ่านบัตรแล้ว');
        });
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

    async function doCase(c, mode, setStatus) {
        await searchPatient(c);
        fillForm(c);
        await readOfficerCard(mode, setStatus);
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
        const setStatus = async text => {
            const current = await getRun();
            if (!current) return;
            current.message = `ราย ${run.index + 1}/${run.queue.length}: VN ${c.vn} (${c.amount} บาท) — ${text}`;
            await setRun(current);
            render();
        };
        try {
            await doCase(c, run.cardMode || 'auto', setStatus);
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
        // Tick the cases to do; choose who presses "ตรวจสอบข้อมูลจากบัตร Smart Card".
        const cardMode = (await chrome.storage.local.get('cardMode')).cardMode || 'manual';
        list.innerHTML = `<label style="display:block;margin-top:4px;color:#0f172a;cursor:pointer"><input type="checkbox" id="nae-all" checked> <b>เลือกทั้งหมด</b> (${pendingCases.length} ราย)</label>
            ${pendingCases.map(c => `<label style="display:block;margin-top:6px;color:#0f172a;cursor:pointer"><input type="checkbox" class="nae-pick" value="${esc(c.vn)}" checked> VN ${esc(c.vn)} • ${esc(c.amount)} บาท<br><span style="margin-left:20px;color:#64748b;font-size:12px">${esc(c.reason || 'ไม่มีเหตุผล (จะหยุดที่รายนี้)')}</span></label>`).join('')}
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;color:#0f172a"><b>ปุ่ม "ตรวจสอบข้อมูลจากบัตร Smart Card"</b>
                <label style="display:block;margin-top:4px;cursor:pointer"><input type="radio" name="nae-mode" value="manual" ${cardMode === 'manual' ? 'checked' : ''}> กดเองทุกราย (ระบบกรอกให้แล้วรอให้กด)</label>
                <label style="display:block;margin-top:4px;cursor:pointer"><input type="radio" name="nae-mode" value="auto" ${cardMode === 'auto' ? 'checked' : ''}> ให้ระบบกดให้ (อัตโนมัติทั้งหมด)</label>
            </div>
            <div id="nae-sum" style="margin-top:8px;color:#0f172a"></div>
            <div style="margin-top:6px;font-size:12px;color:#92400e">บัตรที่เสียบอยู่จะใช้รับรองทุกรายที่เลือก ตรวจยอดและเหตุผลก่อนกดอนุมัติ</div>
            <button id="nae-start" style="${btn}margin-top:10px;background:#059669;color:#fff;width:100%"></button>`;
        const selected = () => [...el.querySelectorAll('.nae-pick:checked')].map(box => pendingCases.find(c => c.vn === box.value)).filter(Boolean);
        const refresh = () => {
            const chosen = selected();
            const sum = chosen.reduce((s, c) => s + Number(c.amount), 0);
            el.querySelector('#nae-all').checked = chosen.length === pendingCases.length;
            el.querySelector('#nae-sum').textContent = `เลือก ${chosen.length} ราย • ${sum.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
            const start = el.querySelector('#nae-start');
            start.textContent = chosen.length ? `อนุมัติและเริ่ม (${chosen.length} ราย)` : 'เลือกอย่างน้อย 1 ราย';
            start.disabled = chosen.length === 0;
        };
        el.querySelector('#nae-all').addEventListener('change', event => {
            el.querySelectorAll('.nae-pick').forEach(box => { box.checked = event.target.checked; });
            refresh();
        });
        el.querySelectorAll('.nae-pick').forEach(box => box.addEventListener('change', refresh));
        el.querySelectorAll('input[name="nae-mode"]').forEach(radio => radio.addEventListener('change', () => chrome.storage.local.set({ cardMode: radio.value })));
        refresh();
        el.querySelector('#nae-start').onclick = async () => {
            const queue = selected();
            if (!queue.length) return;
            const mode = el.querySelector('input[name="nae-mode"]:checked')?.value || 'manual';
            const sum = queue.reduce((s, c) => s + Number(c.amount), 0);
            if (!confirm(`ยืนยันทำ Endpoint ${queue.length} ราย รวม ${sum.toFixed(2)} บาท\n${mode === 'manual' ? 'คุณจะกดอ่านบัตรเองทีละราย' : 'ระบบจะกดอ่านบัตรที่เสียบอยู่ให้ทุกราย'}`)) return;
            await chrome.storage.local.set({ cardMode: mode });
            await setRun({ running: true, queue, cardMode: mode, index: 0, results: [], message: 'กำลังเริ่ม...', startedAt: Date.now() });
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
