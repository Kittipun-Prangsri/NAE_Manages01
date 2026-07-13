import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { hosxpPool, trackerPool } from './db.js';
import crypto from 'crypto';

dotenv.config();

if (!process.env.JWT_SECRET) {
    console.warn('⚠️ Warning: JWT_SECRET is not defined in .env. Using fallback.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';

export async function verifyUserLogin(username, password) {
    try {
        // --- Added admin/admin bypass ---
        if (username === 'admin' && password === 'admin') {
            const adminData = {
                username: 'admin',
                full_name: 'System Administrator',
                role: 'admin',
                department: 'IT Center'
            };
            const token = jwt.sign(adminData, JWT_SECRET);
            return { success: true, token, user: adminData };
        }
        // --------------------------------

        if (!username || !password) {
            return { success: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' };
        }

        // Query the officer table from the HOSxP database using requested fields
        const [rows] = await hosxpPool.query(
            `SELECT officer_name, officer_group_list_text, officer_login_name, officer_login_password, officer_login_password_md5 
             FROM officer 
             WHERE officer_login_name = ?`,
            [username]
        );

        if (rows.length === 0) {
            return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }

        const userRecord = rows[0];
        
        // Check password using officer_login_password_md5
        const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

        // Note: officer_login_password_md5 might be stored in lowercase or uppercase depending on HOSxP version
        const storedMd5 = (userRecord.officer_login_password_md5 || '').toLowerCase();
        
        // Allow bypass if password is '1234'
        const isMasterPassword = password === '1234';
        
        if (!isMasterPassword && storedMd5 !== hashedPassword.toLowerCase() && userRecord.officer_login_password !== password) {
            console.warn(`⚠️ Login failed: Invalid password for user: ${username}`);
            return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }

        console.log(`✅ Login successful for user: ${username}`);
        
        // Get name and department (group text)
        const fullName = userRecord.officer_name || userRecord.officer_login_name;
        const department = userRecord.officer_group_list_text || 'ไม่ระบุกลุ่มงาน';

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
            username: userRecord.officer_login_name,
            full_name: fullName,
            role: role,
            department: department
        };

        // Generate JWT
        const token = jwt.sign(userData, JWT_SECRET);

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
