// auth.js
import { api } from './api.js';
import { ui } from './ui.js';
import { appState, isLoggingOut, domRefs } from './state.js';

export function updateAdminLoginBtnVisibility() {
    const btn = document.getElementById('admin-login-btn');
    const roleEl = document.getElementById('user-role');
    if (appState.value) return; // safety
    if (appState) {
        if (roleEl) {
            roleEl.textContent = appState.user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' :
                appState.user.role === 'viewer' ? 'ผู้เข้าชม (Viewer)' : 'ผู้ใช้งาน (User)';
        }
        if (btn) {
            if (appState.user.role === 'admin') {
                btn.classList.add('hidden');
            } else {
                btn.classList.remove('hidden');
            }
        }
    }
}

export function openAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    if (modal) {
        document.getElementById('admin-login-password').value = '';
        modal.classList.remove('hidden');
        document.getElementById('admin-login-password').focus();
    }
}

export function closeAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    if (modal) modal.classList.add('hidden');
}

export function handleApiResponse(response) {
    if (!response.ok) {
        if (response.status === 401) {
            console.warn('Session expired or unauthorized. Logging out.');
            if (!isLoggingOut.value) {
                isLoggingOut.value = true;
                alert('เซสชั่นหมดอายุหรือคุณไม่มีสิทธิ์เข้าใช้งาน กรุณาเข้าสู่ระบบใหม่');
                handleLogout();
            }
            return false;
        }
        if (response.status === 403) {
            alert(response.data.message || 'คุณไม่มีสิทธิ์ในการดำเนินการนี้ (Forbidden)');
            return false;
        }
    }
    return response.ok;
}

export async function handleLogin(e, onLoadCallbackObj) {
    e.preventDefault();
    const userInp = document.getElementById('username').value;
    const passInp = document.getElementById('password').value;

    const { ok, data } = await api.login(userInp, passInp);
    if (ok) {
        appState.token = data.token;
        appState.user = data.user;

        localStorage.setItem('nhso_token', data.token);
        localStorage.setItem('nhso_user', JSON.stringify(data.user));
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('fullname', data.user.full_name);
        localStorage.setItem('department', data.user.department || '');
        localStorage.setItem('role', data.user.role);

        if (data.user.role === 'admin') {
            document.getElementById('tab-admin')?.classList.remove('hidden');
        }
        updateAdminLoginBtnVisibility();
        ui.showDashboard(data.user.full_name);
        if (domRefs.visitDateInput) domRefs.visitDateInput.valueAsDate = new Date();
        
        if (onLoadCallbackObj && typeof onLoadCallbackObj.loadDashboardData === 'function') {
            onLoadCallbackObj.loadDashboardData();
        }
        if (onLoadCallbackObj && typeof onLoadCallbackObj.loadHipdataCodes === 'function') {
            onLoadCallbackObj.loadHipdataCodes();
        }
        if (onLoadCallbackObj && typeof onLoadCallbackObj.loadWeeklySummary === 'function') {
            onLoadCallbackObj.loadWeeklySummary();
        }
    } else {
        ui.showLoginError(data.message || 'รหัสผ่านไม่ถูกต้อง');
    }
}

export function handleLogout(onLogoutCallbackObj) {
    isLoggingOut.value = true;
    if (onLogoutCallbackObj && typeof onLogoutCallbackObj.stopLiveDashboardAutoRefresh === 'function') {
        onLogoutCallbackObj.stopLiveDashboardAutoRefresh();
    }
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('nhso_token');
        localStorage.removeItem('nhso_user');
        localStorage.removeItem('username');
        localStorage.removeItem('fullname');
        localStorage.removeItem('department');
        localStorage.removeItem('role');
    }
    if (typeof location !== 'undefined') {
        location.reload();
    }
}

export async function handleAdminQuickLogin(e, onLoadCallbackObj) {
    e.preventDefault();
    const password = document.getElementById('admin-login-password').value;

    ui.setLoading(true);
    try {
        const { ok, data } = await api.login('admin', password);
        if (ok) {
            appState.token = data.token;
            appState.user = data.user;

            localStorage.setItem('nhso_token', data.token);
            localStorage.setItem('nhso_user', JSON.stringify(data.user));
            localStorage.setItem('username', data.user.username);
            localStorage.setItem('fullname', data.user.full_name);
            localStorage.setItem('department', data.user.department || '');
            localStorage.setItem('role', data.user.role);

            document.getElementById('tab-admin')?.classList.remove('hidden');

            closeAdminLoginModal();
            updateAdminLoginBtnVisibility();

            alert('เข้าสู่ระบบสิทธิ์ Admin สำเร็จ!');

            ui.showDashboard(data.user.full_name);

            if (onLoadCallbackObj && typeof onLoadCallbackObj.handleTabSwitch === 'function') {
                onLoadCallbackObj.handleTabSwitch('tab-admin');
            }
        } else {
            alert(data.message || 'รหัสผ่าน Admin ไม่ถูกต้อง');
        }
    } catch (err) {
        console.error('Admin quick login error:', err);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
        ui.setLoading(false);
    }
}
