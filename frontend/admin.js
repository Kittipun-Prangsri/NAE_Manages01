// admin.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState } from './state.js';

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
        telegram_chat_id: document.getElementById('modal-telegram-chat-id').value || null
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
            alert(response.data.message || 'บันทึกสำเร็จ');
            closeUserModal();
            loadAdminUsers();
        } else {
            alert(response.data.message || 'เกิดข้อผิดพลาดในการบันทึก');
        }
    } catch (error) {
        console.error('Error saving user:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

export async function handleDeleteUser(id) {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้นี้ออกจากระบบ?')) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteUser(id, appState.token);
        if (ok) {
            alert(data.message || 'ลบผู้ใช้สำเร็จ');
            loadAdminUsers();
        } else {
            alert(data.message || 'ลบผู้ใช้ไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}

export async function handleTestNotification(type, user) {
    const hasToken = type === 'line' ? user.has_line_token : user.has_telegram_token;
    const targetVal = type === 'line' ? user.line_group_id : user.telegram_chat_id;
    if (!hasToken || !targetVal) {
        alert('กรุณากรอกข้อมูล Token และ ID ปลายทางให้ครบถ้วนก่อนทดสอบ');
        return;
    }

    ui.setLoading(true);
    try {
        const { ok, data } = await api.testStoredNotification(user.id, type, appState.token);
        if (ok) {
            alert(data.message || 'ส่งข้อความทดสอบสำเร็จ!');
        } else {
            alert(data.message || 'ส่งข้อความทดสอบล้มเหลว');
        }
    } catch (error) {
        console.error('Error testing notification:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + error.message);
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

export function handleAdminSubtabSwitch(subtab) {
    const btnUsers = document.getElementById('admin-subtab-users');
    const btnSchedules = document.getElementById('admin-subtab-schedules');
    const btnSyncRuns = document.getElementById('admin-subtab-sync-runs');
    const btnAuditLogs = document.getElementById('admin-subtab-audit-logs');
    const viewUsers = document.getElementById('admin-subview-users');
    const viewSchedules = document.getElementById('admin-subview-schedules');
    const viewSyncRuns = document.getElementById('admin-subview-sync-runs');
    const viewAuditLogs = document.getElementById('admin-subview-audit-logs');

    if (!btnUsers || !btnSchedules || !btnSyncRuns || !btnAuditLogs || !viewUsers || !viewSchedules || !viewSyncRuns || !viewAuditLogs) return;

    const activeClass = 'flex-1 px-4 py-2 text-xs font-bold tracking-wide rounded-lg transition cursor-pointer text-center bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400';
    const inactiveClass = 'flex-1 px-4 py-2 text-xs font-bold tracking-wide rounded-lg transition cursor-pointer text-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';

    if (subtab === 'users') {
        btnUsers.className = activeClass;
        btnSchedules.className = inactiveClass;
        btnSyncRuns.className = inactiveClass;
        btnAuditLogs.className = inactiveClass;
        viewUsers.classList.remove('hidden');
        viewSchedules.classList.add('hidden');
        viewSyncRuns.classList.add('hidden');
        viewAuditLogs.classList.add('hidden');
        loadAdminUsers();
    } else if (subtab === 'schedules') {
        btnUsers.className = inactiveClass;
        btnSchedules.className = activeClass;
        btnSyncRuns.className = inactiveClass;
        btnAuditLogs.className = inactiveClass;
        viewUsers.classList.add('hidden');
        viewSchedules.classList.remove('hidden');
        viewSyncRuns.classList.add('hidden');
        viewAuditLogs.classList.add('hidden');
        loadAdminSchedules();
    } else if (subtab === 'sync-runs') {
        btnUsers.className = inactiveClass;
        btnSchedules.className = inactiveClass;
        btnSyncRuns.className = activeClass;
        btnAuditLogs.className = inactiveClass;
        viewUsers.classList.add('hidden');
        viewSchedules.classList.add('hidden');
        viewSyncRuns.classList.remove('hidden');
        viewAuditLogs.classList.add('hidden');
        loadAdminSyncRuns();
    } else if (subtab === 'audit-logs') {
        btnUsers.className = inactiveClass;
        btnSchedules.className = inactiveClass;
        btnSyncRuns.className = inactiveClass;
        btnAuditLogs.className = activeClass;
        viewUsers.classList.add('hidden');
        viewSchedules.classList.add('hidden');
        viewSyncRuns.classList.add('hidden');
        viewAuditLogs.classList.remove('hidden');
        loadAdminAuditLogs();
    }
}

export async function handleAddSchedule(e) {
    e.preventDefault();
    const timeInput = document.getElementById('new-schedule-time');
    if (!timeInput || !timeInput.value) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.createSchedule(timeInput.value, appState.token);
        if (ok) {
            alert(data.message || 'เพิ่มเวลาทำงานสำเร็จ');
            timeInput.value = '';
            loadAdminSchedules();
        } else {
            alert(data.message || 'เพิ่มเวลาทำงานไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
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
            alert(data.message || 'อัปเดตสถานะไม่สำเร็จ');
            loadAdminSchedules();
        }
    } catch (error) {
        console.error('Error toggling schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        loadAdminSchedules();
    }
}

export async function handleDeleteSchedule(id, timeStr) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบเวลาทำงาน ${timeStr} น. ออกจากระบบ?`)) return;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.deleteSchedule(id, appState.token);
        if (ok) {
            alert(data.message || 'ลบเวลาทำงานสำเร็จ');
            loadAdminSchedules();
        } else {
            alert(data.message || 'ลบไม่สำเร็จ');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}
