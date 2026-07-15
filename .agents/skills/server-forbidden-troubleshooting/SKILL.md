---
name: server-forbidden-troubleshooting
description: >-
  Instructions for diagnosing and resolving "403 Forbidden" or login issues when deploying the application on a server (e.g. CentOS/RHEL/Ubuntu) using PM2, Nginx, or Apache.
---

# Server Forbidden Troubleshooting

## Overview
This skill provides step-by-step instructions for troubleshooting and resolving the "403 Forbidden" status code error, session expiration issues, or git conflicts when deploying the application to a production server like CentOS or Rocky Linux.

## Dependencies
None.

## Quick Start
To begin troubleshooting a "Forbidden" or permission issue on the server, follow the workflow below.

## Workflow

### 1. Check Backend Server Logs via PM2
Identify if the backend is throwing JWT verification errors or proxy errors:
- Run `pm2 logs nae-manage-server --lines 50` (or the specific process ID, e.g., `23`).
- If you see `❌ JWT Verification Failed: invalid signature`, it means the client browser is sending an outdated or mismatched token. Proceed to **Step 2**.
- If you see `Error: connect ECONNREFUSED 127.0.0.1:3000`, it means Vite is trying to proxy API requests to the wrong port (e.g., 3000 instead of 3005). Proceed to **Step 3**.

### 2. Clear Browser Local Storage (Client-side Reset)
If there is a token signature mismatch:
- Open Developer Tools in the browser (`F12`).
- Go to the **Application** or **Storage** tab.
- Select **Local Storage** and select the website's IP/domain.
- Right-click and delete/clear `nhso_token` and `nhso_user`.
- Refresh the page and log in again.

### 3. Verify Server Code Status & Git Conflicts
Ensure the server is running the latest code without conflicts:
- `cd` into the project directory on the server (e.g. `/var/www/nae-manage`).
- Try running `git pull origin main`.
- If Git fails with *unmerged files* or *unresolved conflicts*:
  1. Fetch all updates: `git fetch --all`
  2. Overwrite local server changes: `git reset --hard origin/main`
- Re-run `npm install` and restart PM2: `pm2 restart all`.

### 4. SELinux & Web Server Permissions (OS-level)
If Nginx or Apache returns 403 Forbidden when trying to access the static files:
- **Test SELinux** by temporarily setting it to Permissive: `setenforce 0`. If the error resolves, configure SELinux permissions:
  - Allow proxy network connections: `setsebool -P httpd_can_network_connect 1`
  - Allow reading dist directory: `chcon -Rt httpd_sys_content_t /var/www/nae-manage/dist`
  - Re-enable SELinux: `setenforce 1`
- **File Permissions**: Ensure the web server user (e.g. `nginx`) has read/execute access to the folder path:
  - Run `chmod -R 755 /var/www/nae-manage/dist`.

## Common Mistakes
- **Running git pull from root `/`**: Always `cd` to the project directory first. Use `pm2 show <process-id>` to find the directory path if you forgot it.
- **Forgetting to rebuild**: After pulling new code, remember to run `npm run build` if the frontend is served statically.
- **Stuck with cached token**: Mismatched tokens will cause a continuous loop of 403 errors if the browser local storage is not manually cleared.
