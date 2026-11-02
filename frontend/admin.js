// admin.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState } from './state.js';
import { notify, confirmDialog } from './notify.js';
import { escapeHtml } from './uploader.js';

export async function loadAdminUsers() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchUsers(appState.token);
        if (ok) {
            ui.renderAdminUsers(data, openUserModal, handleDeleteUser, handleTestNotification);
        } else {
            console.error('Failed to fetch users:', data.message);
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    } finally {
        ui.setLoading(false);
    }
}

export function openUserModal(user = null) {
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const form = document.getElementById('user-form');

    if (!modal) return;

    form.reset();

    if (user) {
        title.textContent = 'แก้ไขข้อมูลผู้ใช้งาน';
        document.getElementById('modal-user-id').value = user.id;
        document.getElementById('modal-username').value = user.username;
        document.getElementById('modal-username').disabled = true;
        document.getElementById('modal-fullname').value = user.full_name || '';
        document.getElementById('modal-role').value = user.role || 'user';
        document.getElementById('modal-department').value = user.department || '';
        document.getElementById('modal-line-token').value = '';
        document.getElementById('modal-line-token').placeholder = user.has_line_token ? 'เก็บค่าเดิมไว้ (กรอกเมื่อต้องการเปลี่ยน)' : '';
        document.getElementById('modal-line-group-id').value = user.line_group_id || '';
        document.getElementById('modal-telegram-token').value = '';
        document.getElementById('modal-telegram-token').placeholder = user.has_telegram_token ? 'เก็บค่าเดิมไว้ (กรอกเมื่อต้องการเปลี่ยน)' : '';
        document.getElementById('modal-telegram-chat-id').value = user.telegram_chat_id || '';
        document.getElementById('modal-can-endpoint').checked = Boolean(user.can_endpoint);
        document.getElementById('modal-can-portal').checked = Boolean(user.can_portal);
    } else {
        title.textContent = 'เพิ่มผู้ใช้งานใหม่';
        document.getElementById('modal-user-id').value = '';
        document.getElementById('modal-username').disabled = false;
    }

    modal.classList.remove('hidden');
}

export function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
}

export async function handleUserFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('modal-user-id').value;
    const userData = {
        username: document.getElementById('modal-username').value,
        full_name: document.getElementById('modal-fullname').value,
        role: document.getElementById('modal-role').value,
        department: document.getElementById('modal-department').value,
        line_token: document.getElementById('modal-line-token').value || null,
        line_group_id: document.getElementById('modal-line-group-id').value || null,
        telegram_token: document.getElementById('modal-telegram-token').value || null,
        telegram_chat_id: document.getElementById('modal-telegram-chat-id').value || null,
        can_endpoint: document.getElementById('modal-can-endpoint').checked,
        can_portal: document.getElementById('modal-can-portal').checked
    };

    ui.setLoading(true);
    try {
        let response;
        if (id) {
            response = await api.updateUser(id, userData, appState.token);
        } else {
            response = await api.createUser(userData, appState.token);
        }

        if (response.ok) {
            notify.success(response.data.message || 'บันทึกสำเร็จ');
            closeUserModal();
            loadAdminUsers();
        } else {
            notify.error(response.data.message || 'เกิดข้อผิดพลาดในการบันทึก');
        }
    } catch (error) {
        console.error('Error saving user:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

export async function handleDeleteUser(id) {
    if (!await confirmDialog('คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้นี้ออกจากระบบ?', { title: 'ลบผู้ใช้งาน', confirmText: 'ลบผู้ใช้', danger: true })) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteUser(id, appState.token);
        if (ok) {
            notify.success(data.message || 'ลบผู้ใช้สำเร็จ');
            loadAdminUsers();
        } else {
            notify.error(data.message || 'ลบผู้ใช้ไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

export async function handleTestNotification(type, user) {
    const hasToken = type === 'line' ? user.has_line_token : user.has_telegram_token;
    const targetVal = type === 'line' ? user.line_group_id : user.telegram_chat_id;
    if (!hasToken || !targetVal) {
        notify.warning('กรุณากรอกข้อมูล Token และ ID ปลายทางให้ครบถ้วนก่อนทดสอบ');
        return;
    }

    ui.setLoading(true);
    try {
        const { ok, data } = await api.testStoredNotification(user.id, type, appState.token);
        if (ok) {
            notify.success(data.message || 'ส่งข้อความทดสอบสำเร็จ!');
        } else {
            notify.error(data.message || 'ส่งข้อความทดสอบล้มเหลว');
        }
    } catch (error) {
        console.error('Error testing notification:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + error.message);
    } finally {
        ui.setLoading(false);
    }
}

export async function loadAdminSyncRuns() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchSyncRuns(appState.token);
        if (ok) {
            ui.renderAdminSyncRuns(data.runs || [], data.summary || null);
        } else {
            console.error('Failed to fetch sync runs:', data.message);
        }
    } catch (error) {
        console.error('Error loading sync runs:', error);
    } finally {
        ui.setLoading(false);
    }
}

export async function loadAdminAuditLogs() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchAuditLogs(appState.token);
        if (ok) {
            ui.renderAdminAuditLogs(data.logs || []);
        } else {
            console.error('Failed to fetch audit logs:', data.message);
        }
    } catch (error) {
        console.error('Error loading audit logs:', error);
    } finally {
        ui.setLoading(false);
    }
}

export async function loadAdminSchedules() {
    if (!appState.token || appState.user.role !== 'admin') return;
    ui.setLoading(true);
    try {
        const { ok, data } = await api.fetchSchedules(appState.token);
        if (ok) {
            ui.renderAdminSchedules(data.schedules, handleToggleSchedule, handleDeleteSchedule);
        } else {
            console.error('Failed to fetch schedules:', data.message);
        }
    } catch (error) {
        console.error('Error loading admin schedules:', error);
    } finally {
        ui.setLoading(false);
    }
}

// One entry per admin sub-view: its loader runs when the tab is opened.
const ADMIN_SUBTABS = {
    users: () => loadAdminUsers(),
    schedules: () => loadAdminSchedules(),
    'sync-runs': () => loadAdminSyncRuns(),
    endpoint: () => loadAdminEndpointLog(),
    'audit-logs': () => loadAdminAuditLogs()
};

export function handleAdminSubtabSwitch(subtab) {
    if (!ADMIN_SUBTABS[subtab]) return;
    const parts = Object.keys(ADMIN_SUBTABS).map(name => [
        name,
        document.getElementById(`admin-subtab-${name}`),
        document.getElementById(`admin-subview-${name}`)
    ]);
    if (parts.some(([, button, view]) => !button || !view)) return;
    for (const [name, button, view] of parts) {
        const active = name === subtab;
        button.className = active ? 'seg-btn flex-1 is-active' : 'seg-btn flex-1';
        view.classList.toggle('hidden', !active);
    }
    ADMIN_SUBTABS[subtab]();
}

export async function handleAddSchedule(e) {
    e.preventDefault();
    const timeInput = document.getElementById('new-schedule-time');
    if (!timeInput || !timeInput.value) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.createSchedule(timeInput.value, appState.token);
        if (ok) {
            notify.success(data.message || 'เพิ่มเวลาทำงานสำเร็จ');
            timeInput.value = '';
            loadAdminSchedules();
        } else {
            notify.error(data.message || 'เพิ่มเวลาทำงานไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

export async function handleToggleSchedule(id, enabled) {
    try {
        const { ok, data } = await api.updateSchedule(id, { is_enabled: enabled }, appState.token);
        if (ok) {
            loadAdminSchedules();
        } else {
            notify.error(data.message || 'อัปเดตสถานะไม่สำเร็จ');
            loadAdminSchedules();
        }
    } catch (error) {
        console.error('Error toggling schedule:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        loadAdminSchedules();
    }
}

export async function handleDeleteSchedule(id, timeStr) {
    if (!await confirmDialog(`คุณแน่ใจหรือไม่ว่าต้องการลบเวลาทำงาน ${timeStr} น. ออกจากระบบ?`, { title: 'ลบเวลาทำงาน', confirmText: 'ลบ', danger: true })) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteSchedule(id, appState.token);
        if (ok) {
            notify.success(data.message || 'ลบเวลาทำงานสำเร็จ');
            loadAdminSchedules();
        } else {
            notify.error(data.message || 'ลบไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        notify.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

const ENDPOINT_STATUS_LABEL = {
    saved: '✅ บันทึกแล้ว',
    dry_run: '👁️ ทดลอง',
    save_unconfirmed: '❓ พักไว้',
    released: '🔓 ปลดล็อกแล้ว',
    not_scanned: '⌛ ไม่ได้สแกน',
    needs_review: '🔎 ต้องตรวจเอง',
    no_reason: '⚠️ ไม่มีเหตุผล',
    failed: '❌ ผิดพลาด'
};

export async function loadAdminEndpointLog() {
    if (!appState.token || appState.user.role !== 'admin') return;
    const heldBox = document.getElementById('admin-endpoint-held');
    const body = document.getElementById('admin-endpoint-log-body');
    if (!heldBox || !body) return;
    const { ok, data } = await api.fetchEndpointLog(appState.token);
    if (!ok) {
        heldBox.textContent = data?.message || 'โหลดไม่สำเร็จ';
        return;
    }
    const rows = data.rows || [];
    const time = value => new Date(value).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const held = rows.filter(row => row.is_held);

    heldBox.innerHTML = held.length ? '' : '<p class="text-slate-500">ไม่มีรายการที่พักไว้</p>';
    held.forEach(row => {
        const item = document.createElement('div');
        item.className = 'flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10';
        item.innerHTML = `<span class="font-mono font-semibold">VN ${escapeHtml(row.vn)}</span>
            <span>${Number(row.amount).toFixed(2)} บาท • ${escapeHtml(row.requested_by || '-')} • ${escapeHtml(time(row.created_at))}</span>
            <span class="w-full text-xs text-slate-500">${escapeHtml(row.message || '')}</span>
            <button type="button" class="btn btn-sm btn-success h-8" data-action="saved">บันทึกแล้ว (ตรวจแล้ว)</button>
            <button type="button" class="btn btn-sm h-8" data-action="retry">ไม่พบรายการ — ปลดล็อกให้ทำใหม่</button>`;
        item.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
            const action = button.dataset.action;
            const text = action === 'saved'
                ? `ยืนยันว่า VN ${row.vn} มีรายการบันทึกแล้วในเว็บ สปสช.?`
                : `ยืนยันว่า VN ${row.vn} ไม่มีรายการในเว็บ สปสช. และให้ทำใหม่ได้?`;
            if (!await confirmDialog(text, { title: 'ตรวจในเว็บ สปสช. แล้ว', confirmText: 'ยืนยัน' })) return;
            const result = await api.resolveEndpointHold(row.id, action, appState.token);
            if (!result.ok) { notify.warning(result.data?.message || 'ดำเนินการไม่สำเร็จ'); return; }
            notify.success(action === 'saved' ? 'บันทึกสถานะแล้ว' : 'ปลดล็อกแล้ว ทำใหม่ได้');
            loadAdminEndpointLog();
        }));
        heldBox.appendChild(item);
    });

    body.innerHTML = rows.slice(0, 100).map(row => `<tr class="border-b border-slate-100 dark:border-slate-800">
        <td class="py-2 px-3 whitespace-nowrap">${escapeHtml(time(row.created_at))}</td>
        <td class="py-2 px-3 font-mono">${escapeHtml(row.vn)}</td>
        <td class="py-2 px-3 text-right">${Number(row.amount).toFixed(2)}</td>
        <td class="py-2 px-3 whitespace-nowrap">${escapeHtml(ENDPOINT_STATUS_LABEL[row.status] || row.status)}</td>
        <td class="py-2 px-3">${escapeHtml(row.requested_by || '-')}</td>
        <td class="py-2 px-3 max-w-[320px] truncate" title="${escapeHtml(row.message || '')}">${escapeHtml(row.message || '')}</td></tr>`).join('')
        || '<tr><td colspan="6" class="py-4 text-center text-slate-500">ยังไม่มีประวัติ</td></tr>';
}
