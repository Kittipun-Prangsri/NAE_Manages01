// utils.js

/**
 * แปลงข้อมูล Array ของ Object เป็น CSV และดาวน์โหลด
 */
export function exportToCsv(filename, rows) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
        console.warn('exportToCsv is only supported in browser environment');
        return;
    }
    
    if (!rows || !rows.length) return;

    const separator = ',';
    const keys = Object.keys(rows[0]);
    
    // เพิ่ม BOM เพื่อให้ Excel เปิดภาษาไทย UTF-8 ได้
    const BOM = "\uFEFF"; 
    
    const csvContent =
        keys.join(separator) +
        '\n' +
        rows.map(row => {
            return keys.map(k => {
                let cell = row[k] === null || row[k] === undefined ? '' : row[k];
                cell = cell instanceof Date ? cell.toLocaleString() : cell.toString().replace(/"/g, '""');
                if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`;
                return cell;
            }).join(separator);
        }).join('\n');

    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    if (typeof navigator !== 'undefined' && navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, filename);
    } else {
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
}

/**
 * ตรวจสอบว่า JWT หมดอายุแล้วหรือไม่
 */
export function isTokenExpired(token) {
    if (!token) return true;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return true;
        // ถอดรหัส Base64 ของ payload
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload.exp) return false;
        const now = Math.floor(Date.now() / 1000);
        return payload.exp < now;
    } catch (e) {
        return true;
    }
}
