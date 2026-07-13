import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { hosxpPool, trackerPool } from './db.js';
import crypto from 'crypto';

dotenv.config();

if (!process.env.JWT_SECRET) {
    console.warn('⚠️ Warning: JWT_SECRET is not defined in .env. Using fallback.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const DEV_LOGIN_PASSWORD = process.env.HOSXP_DEV_LOGIN_PASSWORD || '';

export function hasOfficerPassword(userRecord) {
    return Boolean(userRecord?.officer_login_password || userRecord?.officer_login_password_md5);
}

export function matchesOfficerPassword(userRecord, password) {
    if (!userRecord || !password) return false;

    const hashedPassword = crypto.createHash('md5').update(password).digest('hex').toLowerCase();
    const storedMd5 = String(userRecord.officer_login_password_md5 || '').toLowerCase();
    const storedPlain = String(userRecord.officer_login_password || '');

    return Boolean((storedMd5 && storedMd5 === hashedPassword) || (storedPlain && storedPlain === password));
}

export function hasOpduserPassword(userRecord) {
    return Boolean(userRecord?.password || userRecord?.passweb || userRecord?.password_text);
}

export function matchesOpduserPassword(userRecord, password) {
    if (!userRecord || !password) return false;

    const hashedPassword = crypto.createHash('md5').update(password).digest('hex').toLowerCase();
    const storedPassweb = String(userRecord.passweb || '').toLowerCase();
    const storedPassword = String(userRecord.password || '');
    const storedPasswordText = String(userRecord.password_text || '');

    return Boolean(
        (storedPassweb && storedPassweb === hashedPassword) ||
        (storedPasswordText && storedPasswordText === password) ||
        (storedPassword && storedPassword === password)
    );
}

function canUseDevLoginPassword(password) {
    return process.env.NODE_ENV !== 'production' && DEV_LOGIN_PASSWORD && password === DEV_LOGIN_PASSWORD;
}

export async function verifyUserLogin(username, password) {
    try {
        if (!username || !password) {
            return { success: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' };
        }

        // Query the officer table first for staff metadata.
        const [rows] = await hosxpPool.query(
            `SELECT officer_name, officer_group_list_text, officer_login_name, officer_login_password, officer_login_password_md5 
             FROM officer 
             WHERE officer_login_name = ?`,
            [username]
        );

        const [opduserRows] = await hosxpPool.query(
            `SELECT loginname, name, groupname, password, passweb, password_text
             FROM opduser
             WHERE loginname = ?
             LIMIT 1`,
            [username]
        );

        const officerRecord = rows[0] || null;
        const opduserRecord = opduserRows[0] || null;

        if (!officerRecord && !opduserRecord) {
            return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }

        const matchedOfficer = matchesOfficerPassword(officerRecord, password);
        const matchedOpduser = matchesOpduserPassword(opduserRecord, password);

        if (!hasOfficerPassword(officerRecord) && !hasOpduserPassword(opduserRecord)) {
            if (!canUseDevLoginPassword(password)) {
                console.warn(`⚠️ Login failed: HOSxP user has no password set: ${username}`);
                return { success: false, message: 'บัญชี HOSxP นี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาตั้งรหัสผ่านใน HOSxP หรือกำหนด HOSXP_DEV_LOGIN_PASSWORD เฉพาะเครื่องพัฒนา' };
            }
            console.warn(`⚠️ Development login override used for HOSxP user without password: ${username}`);
        } else if (!matchedOfficer && !matchedOpduser) {
            console.warn(`⚠️ Login failed: Invalid password for user: ${username}`);
            return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }

        console.log(`✅ Login successful for user: ${username}`);
        
        // Get name and department (group text)
        const loginName = officerRecord?.officer_login_name || opduserRecord?.loginname || username;
        const fullName = officerRecord?.officer_name || opduserRecord?.name || loginName;
        const department = officerRecord?.officer_group_list_text || opduserRecord?.groupname || 'ไม่ระบุกลุ่มงาน';

        // --- Sync with Internal users table ---
        let role = 'user';
        try {
            // Check if user exists in our internal DB
            const [internalUser] = await trackerPool.query('SELECT role FROM users WHERE username = ?', [username]);
            
            if (internalUser.length > 0) {
                role = internalUser[0].role;
                // Update their info in case it changed in HOSxP
                await trackerPool.query(
                    'UPDATE users SET full_name = ?, department = ? WHERE username = ?',
                    [fullName, department, username]
                );
            } else {
                // First time login, insert them
                await trackerPool.query(
                    'INSERT INTO users (username, full_name, department, role) VALUES (?, ?, ?, ?)',
                    [username, fullName, department, role]
                );
            }
        } catch (dbErr) {
            console.error('❌ Internal DB Sync Error:', dbErr.message);
            // We continue even if sync fails, but role stays 'user'
        }

        const userData = {
            username: loginName,
            full_name: fullName,
            role: role,
            department: department
        };

        // Generate JWT
        const token = jwt.sign(userData, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        return { success: true, token, user: userData };
        
    } catch (error) {
        console.error("❌ Auth Error Details:", error.message);
        return { success: false, message: `เกิดข้อผิดพลาด: ${error.message}` };
    }
}

// Middleware to protect routes
export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // If token is expired → 401 so the client can auto-logout / refresh
            if (err.name === 'TokenExpiredError') {
                console.warn(`⚠️ JWT Expired: ${err.message}`);
                return res.status(401).json({ 
                    message: 'Session Expired', 
                    error: 'token_expired',
                    details: err.message 
                });
            }
            
            // Any other JWT error (invalid signature, malformed, etc.) → 401 (Unauthorized) so the client auto-logs out
            console.error(`❌ JWT Verification Failed: ${err.message}`);
            return res.status(401).json({ 
                success: false,
                message: 'Session Expired or Invalid Token', 
                error: err.message 
            });
        }
        req.user = user;
        next();
    });
}
