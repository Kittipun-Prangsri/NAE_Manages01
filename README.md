# NHSO Tracking System (ระบบติดตามและตรวจสอบการขอ Authen Code สปสช.)

ระบบเว็บแอปพลิเคชันสำหรับตรวจสอบและเปรียบเทียบข้อมูลการเข้ารับบริการของคนไข้ (Visits) ระหว่างฐานข้อมูลหลักของโรงพยาบาล (**HOSxP**) และข้อมูลการขอรหัสยืนยันสิทธิ์ (**Authen Code**) จากสำนักงานหลักประกันสุขภาพแห่งชาติ (**สปสช. / NHSO**) โดยการนำเข้าข้อมูลผ่านไฟล์ Excel และประมวลผลเปรียบเทียบแบบเรียลไทม์

---

## 🌟 คุณสมบัติเด่น (Key Features)

* **ตรวจสอบความถูกต้องของการ Authen**:
  * แสดงสถานะสี (Color Code) เพื่อแยกแยะผลการตรวจสอบ:
    * 🔴 **RED**: ยังไม่ได้ขอ Authen Code (ไม่พบข้อมูลในระบบ สปสช. Excel)
    * 🟡 **YELLOW**: มีการขอ Authen Code แล้ว แต่ยังไม่ได้เปิด/ปิดบริการที่ Endpoint
    * 🟢 **GREEN**: ตรวจสอบสิทธิ์ผ่านสมบูรณ์ครบถ้วน (มี Authen Code และ Endpoint ปิดเรียบร้อย)
* **จับคู่และเปรียบเทียบรหัสเคลม (Claim Code Match)**:
  * แสดงสถานะความถูกต้องของรหัสเคลม: `ตรง`, `ไม่ตรง`, `ตรวจสอบ` (กรณีมีรายการซ้ำซ้อนหรือตรวจซ้ำในวันเดียวกัน), และ `ยังไม่ได้นำเข้า`
* **การอ่านไฟล์ Excel อัตโนมัติ (Date Probing)**:
  * ตรวจจับวันที่ของสิทธิ์การรักษาจากเนื้อหาไฟล์ Excel โดยอัตโนมัติ ไม่จำเป็นต้องพิมพ์ระบุวันที่เอง
* **บันทึก SQL Query ได้แบบยืดหยุ่น**:
  * สามารถบันทึก แก้ไข หรือเลือกรูปแบบ SQL Query เพื่อนำไปใช้ดึงข้อมูลจาก HOSxP ได้โดยตรงผ่านหน้า UI
* **หน้า Dashboard ข้อมูลเชิงลึก**:
  * รายงานยอดสถิติจำนวนคนไข้ทั้งหมด, จำนวนที่ขอสิทธิ์ผ่านแล้ว, จำนวนที่ค้างขอสิทธิ์, อัตราความสำเร็จ (%) และสรุปยอดจำนวนเงินที่ได้รับสิทธิ์ UC
* **ระบบความปลอดภัยและการยืนยันตัวตน**:
  * ลงชื่อเข้าใช้งานด้วยชื่อผู้ใช้และรหัสผ่าน โดยใช้ระบบ JWT Token (JSON Web Tokens)
* **รองรับธีม Dark / Light Mode**:
  * หน้าตาผู้ใช้งานที่ออกแบบอย่างสวยงาม ทันสมัย มีลูกเล่น Glassmorphic สลับธีมได้ทันที และมี Digital Clock แสดงผลที่ Navbar

* **Sync แบบ atomic**: การนำเข้ารายงานและอัปเดตตาราง HOSxP ทำใน transaction เดียว หากขั้นตอนใดผิดพลาด ระบบจะ rollback เพื่อลดความเสี่ยงข้อมูลค้างระหว่างทาง

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

### **ฝั่งผู้ใช้งาน (Frontend)**
* **HTML5 & Vanilla Javascript (ES Modules)**
* **TailwindCSS v4.0** (สำหรับการทำ Responsive Layout และการปรับแต่งสไตล์ที่รวดเร็ว)
* **FontAwesome v6.4.0** (สำหรับไอคอนสวยงาม)
* **Vite** (เป็น Frontend Build Tool)

### **ฝั่งเซิร์ฟเวอร์ (Backend)**
* **Node.js** (รันไทม์หลัก)
* **Express.js v5.0** (ระบบเซิร์ฟเวอร์และ API Endpoints)
* **Multer** (สำหรับอัปโหลดและจัดการไฟล์ Excel ในหน่วยความจำ)
* **xlsx (SheetJS)** (สำหรับอ่านและประมวลผลข้อมูลจาก Excel)
* **jsonwebtoken** (สำหรับสร้างและยืนยันสิทธิ์ JWT Auth)

### **ระบบฐานข้อมูล (Database)**
* **MySQL / MariaDB** (เชื่อมต่อผ่าน `mysql2/promise` ใน Node.js)
  * **HOSxP Database**: ดึงข้อมูลคนไข้และการให้บริการ (สิทธิ์ Read-Only)
  * **Tracker Database**: ตารางภายในระบบ สำหรับบันทึกข้อมูลการเปรียบเทียบ, ข้อมูลผู้ใช้, และบันทึก SQL Query ที่ใช้บ่อย

---

## 📁 โครงสร้างไฟล์ในระบบ (Project Directory Structure)

* 📄 **[server.js](file:///D:/website/NAE_Manages01/server.js)**: ไฟล์ทางเข้าเซิร์ฟเวอร์ Express.js หลัก จัดการ API Routing ทั้งหมด และควบคุม Static file delivery
* 📄 **[db.js](file:///D:/website/NAE_Manages01/db.js)**: จัดการการเชื่อมต่อ Connection Pool ไปยังฐานข้อมูล HOSxP และระบบ Tracker
* 📄 **[initDb.js](file:///D:/website/NAE_Manages01/initDb.js)**: ทำหน้าที่สร้างโครงสร้างตารางข้อมูลที่จำเป็น (`visit_tracking`, `saved_queries`, `users`) และเขียน SQL Query ตั้งต้นในกรณีติดตั้งระบบครั้งแรก
* 📄 **[crossCheckLogic.js](file:///D:/website/NAE_Manages01/crossCheckLogic.js)**: ส่วนประมวลผลตรรกะการเปรียบเทียบข้อมูลระหว่าง HOSxP กับสปสช. Excel เพื่อวิเคราะห์สถานะ สี และความถูกต้อง
* 📄 **[dataService.js](file:///D:/website/NAE_Manages01/dataService.js)**: บริการคิวรีฐานข้อมูลและดึงข้อมูลผลลัพธ์การคัดกรอง บันทึก Log และเรียกภายนอก API สปสช.
* 📄 **[auth.js](file:///D:/website/NAE_Manages01/auth.js)**: จัดการเกี่ยวกับการยืนยันตัวตน เช่น การตรวจสอบพาสเวิร์ด และ Middleware สำหรับ Verify JWT Token
* 📄 **[index.html](file:///D:/website/NAE_Manages01/index.html)**: หน้าตาหลักของแอปพลิเคชัน (Single Page Application Layout)
* 📄 **[app.js](file:///D:/website/NAE_Manages01/app.js)**: โค้ดควบคุมหลักทางฝั่ง Frontend ในการรับ-ส่งข้อมูลกับ API
* 📄 **[ui.js](file:///D:/website/NAE_Manages01/ui.js)**: ควบคุมการโต้ตอบหน้าเว็บและ Render ตารางสถิติ ข้อมูลตัวเลข และ Popups
* 📄 **[utils.js](file:///D:/website/NAE_Manages01/utils.js)**: ฟังก์ชันช่วยเหลือฝั่ง Client เช่น ตัวจัดการแปลงวันที่, คอนเวอร์เตอร์สกุลเงิน และการแจ้งเตือน
* 📄 **[style.css](file:///D:/website/NAE_Manages01/style.css)**: กำหนดสไตล์ เอฟเฟกต์เบลอ การเปลี่ยนสี และอะนิเมชันของระบบ
* 📄 **[package.json](file:///D:/website/NAE_Manages01/package.json)**: ไฟล์ระบุ Dependencies และ Scripts ในการควบคุมโปรเจกต์

---

## ⚙️ การตั้งค่าระบบก่อนใช้งาน (Configuration)

ก่อนเริ่มต้นใช้งานโปรเจกต์ คุณจำเป็นต้องคัดลอกไฟล์ต้นแบบการตั้งค่า และตั้งชื่อเป็นไฟล์ `.env` ที่อยู่ในโฟลเดอร์ราก (Root Directory) ของโปรเจกต์:

```env
# HOSxP Database (Read-Only — must have SELECT only)
HOSXP_HOST=192.168.1.4
HOSXP_USER=your_hosxp_username
HOSXP_PASS=your_hosxp_password
HOSXP_DB=hos
HOSXP_PORT=3306

# HOSxP Sync Database (Write access — only required for Sync operations)
# Grant this account only the minimum permissions on authencode,
# temp_authen_code, and visit_pttype. Do not reuse the read-only account.
HOSXP_WRITE_USER=your_hosxp_sync_username
HOSXP_WRITE_PASS=your_hosxp_sync_password

# Internal Tracking Database
TRACKER_HOST=192.168.1.4
TRACKER_USER=your_tracker_username
TRACKER_PASS=your_tracker_password
TRACKER_DB=hos
TRACKER_PORT=3306
TRACKER_CHARSET=tis620

# Authentication & JWT
JWT_SECRET=replace_with_a_unique_secret_of_at_least_32_characters
# Separate 32+ character secret used to encrypt per-user LINE/Telegram tokens in MySQL
NOTIFICATION_CREDENTIALS_KEY=replace_with_a_separate_32_character_or_longer_secret
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email

# Server Config
PORT=3000
NODE_ENV=development
# Optional development URL used by the Puppeteer dashboard capture (defaults to http://localhost:5174)
LOCAL_DASHBOARD_URL=http://localhost:5174
# Optional in production: comma-separated browser origins allowed to call the API
CORS_ORIGINS=https://tracker.example.go.th
# Excel uploads are kept in memory; choose a value between 1 MB and 100 MB
MAX_EXCEL_UPLOAD_BYTES=20971520
# Screenshots are authenticated by default. Enable only when an external service must fetch them by public URL.
ALLOW_PUBLIC_SCREENSHOTS=false
# Prevent duplicate scheduled jobs across server/worker instances (minimum 60 seconds)
SCHEDULER_LOCK_TTL_SECONDS=1800

# NHSO API Configuration
NHSO_API_URL=https://test.nhso.go.th/authencodestatus/api/check-authen-status
NHSO_BEARER_TOKEN=YOUR_BEARER_TOKEN_HERE
NHSO_SERVICE_CODE=PG0060001
```

---

## 🚀 วิธีการติดตั้งและเริ่มทำงาน (Installation & Setup)

ก่อนเริ่มระบบหรือ deploy ตรวจค่า environment ได้โดยไม่เปิดเผย secret:

```bash
npm run check:config
# ตรวจการเชื่อมต่อฐานข้อมูลเพิ่ม
npm run check:config:db
```

### 1. ติดตั้ง Node Modules
เปิด Command Prompt หรือ PowerShell ในโฟลเดอร์ของโปรเจกต์แล้วรันคำสั่ง:
```bash
npm install
```

### 2. รันแอปพลิเคชันในโหมดพัฒนา (Development Mode)
คำสั่งนี้จะรัน Frontend (Vite) และ Backend (Express ด้วย Nodemon) ไปพร้อมกันด้วยการประมวลผลแบบคู่ขนาน:
```bash
npm run dev
```
เมื่อรันสำเร็จ สามารถเข้าใช้งานแอปพลิเคชันผ่านเบราว์เซอร์ที่:
* หน้าหลัก (Vite): [http://localhost:5174](http://localhost:5174)
* เซิร์ฟเวอร์ API: [http://localhost:3005](http://localhost:3005)

กำหนด `PORT=3005` ใน `.env` เมื่อใช้ `npm run dev` เพราะ Vite proxy ถูกตั้งให้ส่ง `/api` ไปยังพอร์ตนี้

### 3. รันบนโปรดักชัน (Production Mode)
เมื่อทดสอบการใช้งานเสร็จสิ้นและต้องการนำขึ้นใช้งานจริง ให้รันคำสั่งเหล่านี้เพื่อคอมไพล์โปรเจกต์:
```bash
# คอมไพล์และบิลด์โค้ดฝั่ง Frontend ไปยังโฟลเดอร์ dist
npm run build

# รัน Express เซิร์ฟเวอร์จริง
npm run start
```

### 4. รันบน Production ด้วย PM2 (แนะนำ)

PM2 จะดูแลให้ web server และ worker เริ่มใหม่หากหยุดทำงาน โดยโปรเจกต์กำหนดให้มี worker เพียงหนึ่ง process สำหรับ Cron และ Telegram polling เพื่อไม่ให้สั่ง Sync ซ้ำ

```bash
# ติดตั้ง PM2 เพียงครั้งเดียว
npm install --global pm2

# ตรวจค่า production และทดสอบฐานข้อมูลจากเครื่องที่จะ deploy
NODE_ENV=production npm run check:config:db

# สร้าง frontend สำหรับ production แล้วเริ่มทั้ง server และ worker
npm run build
npm run pm2:start

# ตรวจสอบและดู log
pm2 status
npm run pm2:logs
pm2 logs nae-worker --lines 100
```

เมื่อแก้ `.env` หรืออัปเดตโค้ด ให้ build และ restart ทั้งสอง process:

```bash
npm run build
npm run pm2:restart
```

ตั้งให้ PM2 เริ่มเองหลังเครื่องรีบูต (รันคำสั่งที่ PM2 แสดงให้ครบ):

```bash
pm2 startup
pm2 save
```

ก่อนใช้งาน production ต้องตั้งอย่างน้อย `NODE_ENV=production`, `PORT`, `JWT_SECRET`, `NOTIFICATION_CREDENTIALS_KEY`, `CORS_ORIGINS` และ `LOCAL_DASHBOARD_URL` ให้เป็น URL ที่ worker เข้าถึงได้ เช่น `http://127.0.0.1:3005` เมื่อ Express serve `dist` เอง

---

## 📂 ตารางข้อมูลในฐานข้อมูลภายใน (Database Tables Schema)

เมื่อระบบเริ่มต้นทำงานครั้งแรก ตัวเซิร์ฟเวอร์จะทำขั้นตอนตรวจสอบและสร้างตารางฐานข้อมูลที่กำหนดไว้ในไฟล์ **[initDb.js](file:///D:/website/NAE_Manages01/initDb.js)** โดยอัตโนมัติ:

1. **`users`**: บันทึกข้อมูลเจ้าหน้าที่และผู้ดูแลระบบที่มีสิทธิ์ล็อกอินเข้าใช้งาน
2. **`visit_tracking`**: บันทึกผลการเปรียบเทียบข้อมูลและประวัติรหัสสิทธิ์รักษาของแต่ละวัน/เคสตรวจ
3. **`saved_queries`**: บันทึก SQL Query ที่ใช้บ่อยเพื่อให้ดึงข้อมูลจาก HOSxP ได้รวดเร็วและเป็นมาตรฐานเดียวกัน

---

## 💬 คำสั่งใช้งานผ่าน Chatbot (LINE / Telegram)

ระบบรองรับการสั่งงานและดึงข้อมูลรายงานการบริการรูปแบบ **LINE Flex Message** และส่งรูปภาพหน้าจอ Dashboard (Grafana) ผ่านทาง LINE และ Telegram Chatbot โดยมีคำสั่งดังนี้:

### 1. คำสั่งผ่าน LINE Chat
ส่งข้อความทางแชทหา LINE Bot เพื่อดึงข้อมูล Flex Message สรุปยอดสถิติ:
*   `นำเข้าข้อมูล` — สรุปข้อมูลสถิติของ**วันนี้** (ตามเขตเวลาประเทศไทย)
*   `นำเข้าข้อมูล YYYY-MM-DD` (เช่น `นำเข้าข้อมูล 2026-07-17`) — สรุปข้อมูลสถิติของ**วันที่ระบุเจาะจง**

**ข้อมูลที่ส่งกลับใน Flex Message:**
*   จำนวนผู้มารับบริการ (ครั้ง) ประจำวัน
*   ยอดรวมค่ารักษาลูกหนี้ (UC Money Sum)
*   สถานะ Visit Authen code (ENDPOINT, ยังไม่นำเข้า, AUTHENCODE)
*   สิทธิการรักษา 3 ลำดับแรก (Top 3 Rights)
*   ยอดคนไข้สิทธิ์บัตรทองที่ค้างสิทธิ์ (UCS ไม่ได้ปิดสิทธิ) พร้อมจุดบริการ/แผนกที่ยังค้างดำเนินการ 3 ลำดับแรก

### 2. คำสั่งซิงก์ข้อมูลผ่าน Telegram Bot (คู่ขนาน)
เมื่อพิมพ์ข้อความเหล่านี้ในห้องแชท Telegram ที่เชื่อมต่อไว้:
*   `เข้าระบบ` / `ดึงข้อมูล` / `/login` / `/sync`

**ขั้นตอนการทำงานอัตโนมัติ:**
1.  เซิร์ฟเวอร์จำลองเปิดเว็บ สปสช. (NHSO) เพื่อดาวน์โหลดรายงาน
2.  ส่งข้อความสถานะรายงานแจ้งเตือนเข้ามายังห้องแชท LINE และ Telegram
3.  ประมวลผลเปรียบเทียบข้อมูลลงฐานข้อมูล พร้อมดึงรูปภาพหน้าจอจาก Grafana Dashboard 
4.  ส่งสรุปยอด (Flex Message) และภาพ Dashboard แจ้งเตือนเข้าห้องแชทโดยอัตโนมัติ

> 💡 **หมายเหตุการตั้งค่า:** ตรวจสอบการตั้งค่าในไฟล์ `.env` สำหรับ `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_GROUP_ID`, `TELEGRAM_BOT_TOKEN`, และ `TELEGRAM_CHAT_ID` เพื่อให้บอททำงานได้อย่างถูกต้อง และปิด `DISABLE_NOTIFICATIONS=false`

