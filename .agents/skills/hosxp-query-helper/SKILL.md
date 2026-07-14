---
name: hosxp-query-helper
description: Assists in writing, reviewing, and validating HOSxP SQL queries, checking schema fields, and ensuring compatibilities with TIS620/UTF-8 charsets.
---

# HOSxP SQL Query Helper Skill

คู่มือแนวทางและกฎการสร้าง/แก้ไขคำสั่ง SQL Query เพื่อสืบค้นข้อมูลจากฐานข้อมูล **HOSxP** และส่งต่อประมวลผลไปยังระบบติดตาม Authen Code สปสช. ของแอปพลิเคชันนี้

---

## 🔑 โครงสร้างตารางหลักใน HOSxP (Core Schema)

คำสั่งคิวรีสำหรับระบบตรวจสอบ Authen มักเกี่ยวข้องกับตารางต่าง ๆ ดังนี้:

### 1. `vn_stat` (ข้อมูลการเข้าตรวจของผู้ป่วยนอกหลัก)
* `vn`: รหัสตรวจ (Primary Key / Unique)
* `hn`: รหัสประจำตัวผู้ป่วย
* `cid`: เลขประจำตัวประชาชน 13 หลัก
* `vstdate`: วันที่รับบริการ (DATE)
* `pttype`: สิทธิ์การรักษาพยาบาลหลัก ณ วันนั้น
* `uc_money`: จำนวนเงินค่ารักษาในส่วนของสิทธิ์ UC (สปสช.)

### 2. `ovst` (การลงทะเบียน OPD)
* `vn`: รหัสตรวจ
* `hn`: รหัสประจำตัวผู้ป่วย
* `vstdate`: วันที่รับบริการ
* `main_dep`: แผนกที่คนไข้รับบริการ (เชื่อมกับ `kskdepartment.depcode`)
* `staff`: ผู้ลงบันทึกรับบริการ

### 3. `visit_pttype` (สิทธิ์รักษาตาม Visit)
* `vn`: รหัสตรวจ
* `pttype`: รหัสสิทธิ์
* `claim_code`: รหัสการเบิกจ่าย/เคลมสิทธิ์
* `Auth_Code`: รหัสอนุมัติ/รหัสยืนยันสิทธิ์จาก สปสช.
* `pttype_note`: หมายเหตุ หรือประเภทการยืนยัน
* `staff`: เจ้าหน้าที่ผู้ตรวจสอบ/ปรับสิทธิ์

### 4. `pttype` (ข้อมูลการตั้งค่าสิทธิ์)
* `pttype`: รหัสสิทธิ์ (Primary Key)
* `name`: ชื่อสิทธิ์รักษา
* `hipdata_code`: รหัสกลุ่มสิทธิ์ระดับชาติ (เช่น `UCS`, `WEL`, `OFC`, `SSS`)
* `pttype_spp_id`: รหัสประเภทการเบิก/กลุ่มสิทธิย่อย ใช้กับการ์ดสรุปสิทธิรายวัน
* `pttype_group1`: กลุ่มสิทธิ์หลักทั่วไป (เช่น `UC`)

---

## ⚙️ ระบบแทนที่ตัวแปรมาโคร (Grafana-like Macros)

แอปพลิเคชันในไฟล์ [server.js](file:///D:/website/NAE_Manages01/server.js) มีฟังก์ชัน `replaceGrafanaMacros()` ซึ่งทำหน้าที่แปลงมาโครต่าง ๆ ก่อนส่งคิวรีไปฐานข้อมูลจริง:

1. **`$__timeFilter(column_name)`**
   * จะถูกแทนที่ด้วย `column_name = 'YYYY-MM-DD'` (โดย `YYYY-MM-DD` มาจากวันที่ที่ผู้ใช้เลือกในปฏิทินของระบบ)
   * **ตัวอย่างการใช้:** `WHERE $__timeFilter(v.vstdate)`
2. **`$hipdata_code`**
   * จะถูกแทนที่ด้วยรายการรหัสสิทธิ์ในเครื่องหมายคำพูดเดี่ยวคั่นด้วยจุลภาค เช่น `'UCS','WEL'`
   * **ตัวอย่างการใช้:** `WHERE py.hipdata_code IN ($hipdata_code)`

---

## 🧾 มาตรฐานการ์ดสรุปสิทธิรายวัน (Right Card Daily Summary)

ใช้เมื่อต้องแสดงจำนวนผู้ป่วยแยกตามประเภทสิทธิบนการ์ดรายวัน โดยนับจาก HOSxP จริงแบบวันต่อวัน เช่น Today หรือวันที่ที่ผู้ใช้เลือกในระบบ

### หลักการนับ
* ใช้ `COUNT(DISTINCT v.hn)` เพื่อ “นับคนไข้ไม่ซ้ำ” ตามสูตร Grafana เดิม
* ใช้ `py.pttype_spp_id` เป็นตัวแบ่งกลุ่มสิทธิ ไม่ใช้ `hipdata_code` สำหรับการ์ดชุดนี้
* ใช้ `v.vstdate = ?` หรือ `$__timeFilter(v.vstdate)` เพื่อจำกัดวันที่เสมอ
* เอาเฉพาะ OPD ด้วย `ov.an IS NULL`
* ตัด subtype ที่ไม่ต้องนับด้วย `COALESCE(ov.pt_subtype, '') <> '1'`
* ไม่ต้องกรอง `EP`, `ENDPOINT`, `PP`, `claimcode` สำหรับการ์ดชุดนี้ เพราะต้องเป็นยอดรวมผู้มารับบริการรายวันตามสิทธิ ไม่ใช่ยอดค้าง endpoint

### Mapping มาตรฐาน `pttype_spp_id`
* `1` → เบิกจ่ายตรงกรมบัญชีกลาง
* `11` → เบิกต้นสังกัด
* `7` → เบิกจ่ายตรง อปท.
* `3,4` → บัตรทอง
* `5,8` → คนต่างด้าว
* `10` → ผู้มีปัญหาสถานะและสิทธิ
* `2` → บัตรประกันสังคม
* `9` → พรบ.ผู้ประสบภัยจากรถ
* `6` → อื่นๆ/ชำระเงินเอง

### Query Template
```sql
SELECT
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 1 THEN v.hn ELSE NULL END) AS "เบิกจ่ายตรงกรมบัญชีกลาง",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 11 THEN v.hn ELSE NULL END) AS "เบิกต้นสังกัด",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 7 THEN v.hn ELSE NULL END) AS "เบิกจ่ายตรง อปท.",
    COUNT(DISTINCT CASE WHEN py.pttype_spp_id IN (3,4) THEN v.hn ELSE NULL END) AS "บัตรทอง",
    COUNT(DISTINCT CASE WHEN py.pttype_spp_id IN (5,8) THEN v.hn ELSE NULL END) AS "คนต่างด้าว",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 10 THEN v.hn ELSE NULL END) AS "ผู้มีปัญหาสถานะและสิทธิ",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 2 THEN v.hn ELSE NULL END) AS "บัตรประกันสังคม",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 9 THEN v.hn ELSE NULL END) AS "พรบ.ผู้ประสบภัยจากรถ",
    COUNT(DISTINCT CASE py.pttype_spp_id WHEN 6 THEN v.hn ELSE NULL END) AS "อื่นๆ (ชำระเงินเอง)"
FROM vn_stat v
LEFT JOIN ovst ov ON ov.vn = v.vn
LEFT JOIN pttype py ON py.pttype = v.pttype
WHERE v.vstdate = ?
  AND COALESCE(ov.pt_subtype, '') <> '1'
  AND ov.an IS NULL;
```

### แยกจาก Metric ลูกหนี้/Endpoint
* ยอด “การ์ดสิทธิรายวัน” ใช้ `pttype_spp_id` และไม่ดู endpoint
* ยอด “ค่ารักษาลูกหนี้ UC” หรือ “UC Pending” เป็นคนละ metric สามารถใช้ `hipdata_code = 'UCS'` และเงื่อนไข `temp_authen_code`/`authen_code_type` เพื่อดูสถานะค้าง endpoint ได้
* ห้ามนำ filter endpoint ไปใส่ใน Right Card Daily Summary เพราะจะทำให้ยอดสิทธิรายวันไม่ตรงกับยอดผู้รับบริการจริง

---

## 🛑 กฎและข้อควรระวังเรื่องประสิทธิภาพ (Performance & Safety Rules)

1. **ห้ามรัน Query แบบ Full Table Scan บนตารางใหญ่**:
   * ตารางอย่าง `vn_stat` และ `ovst` มีปริมาณข้อมูลมหาศาล (หลายล้านเรคคอร์ด)
   * **ต้องใช้ดัชนี (Index)** เสมอ โดยการเพิ่มตัวกรองวันที่ เช่น `$__timeFilter(vstdate)` หรือกรองด้วย `vn` เสมอ
2. **จำกัดคอลัมน์และข้อมูลที่คืนกลับ**:
   * หลีกเลี่ยง `SELECT *` ให้ระบุชื่อคอลัมน์ที่จำเป็นเท่านั้น เพื่อลดขนาดทราฟฟิกเครือข่ายและหน่วยความจำ
3. **ตรวจสอบความปลอดภัยคำสั่ง SQL**:
   * หากไม่ใช่ผู้ใช้ระดับ `admin` ระบบจะยอมรับเฉพาะคำสั่งแบบอ่านข้อมูล (Read-only) ที่ขึ้นต้นด้วย:
     * `SELECT`
     * `WITH`
     * `SHOW`
     * `DESCRIBE`
   * การเขียน Query ต้องระมัดระวังการทำ SQL Injection

---

## 🇹🇭 การจัดการรหัสภาษา (Charset Encoding)

ฐานข้อมูล HOSxP รุ่นเก่ามักใช้การเข้ารหัสภาษาแบบ **TIS-620** (ภาษาไทยดั้งเดิม) ขณะที่ Node.js และเว็บแอปพลิเคชันยุคใหม่ประมวลผลบน **UTF-8**:
* ในไฟล์กำหนดค่า [.env](file:///D:/website/NAE_Manages01/.env) มีการระบุ `TRACKER_CHARSET=tis620`
* หากมีปัญหาภาษาไทยอ่านไม่ออกหรือเปรียบเทียบข้อความภาษาไทยไม่สำเร็จ ให้ตรวจสอบการแปลง Charset และ Collation ใน Database Driver
