const send = message => chrome.runtime.sendMessage(message);

async function render() {
    const { data } = await send({ type: 'whoami' });
    const loggedIn = Boolean(data?.token);
    document.getElementById('logged-in').hidden = !loggedIn;
    document.getElementById('login-form').hidden = loggedIn;
    if (loggedIn) document.getElementById('who').textContent = data.user?.full_name || data.user?.username || '';
    if (data?.server) document.getElementById('server').value = data.server;
}

document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const msg = document.getElementById('msg');
    msg.textContent = 'กำลังเข้าสู่ระบบ...';
    const result = await send({
        type: 'login',
        server: document.getElementById('server').value.trim(),
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
    });
    msg.textContent = result.ok ? '' : (result.data?.message || 'เข้าสู่ระบบไม่สำเร็จ');
    if (result.ok) render();
});

document.getElementById('logout').addEventListener('click', async () => {
    await send({ type: 'logout' });
    render();
});

render();
