/**
 * ฟังก์ชันหลักในการเปรียบเทียบข้อมูล HOSxP กับ Excel ของ สปสช.
 */
export function processCrossCheck(hosxpData, excelData) {
    // 1. สร้าง Map สำหรับข้อมูล Excel (Key = CID) เพื่อการค้นหาที่รวดเร็ว
    // *หมายเหตุ: คอลัมน์ใน Excel ต้องถูก Map ให้ตรงกับชื่อ property เหล่านี้
    const excelMap = excelData.reduce((acc, row) => {
        // ดึงเลขบัตร (CID) - รองรับทั้งชื่อไทยและอังกฤษ
        const cid = String(row['เลขบัตร'] || row.cid || row.CID || '').trim();
        
        if (cid) {
            // ดึง Claim Code (Authen Code)
            const authenCode = row['CLAIM CODE'] || row.authenCode || row.CLAIM_CODE || null;
            const channel = String(row['ช่องทางการขอ Authen Code'] || '');
            
            acc[cid] = {
                authenCode: authenCode,
                channel: channel,
                isEndpointClosed: channel.toUpperCase() === 'ENDPOINT' && !!authenCode
            };
        }
        return acc;
    }, {});

    // 2. นับความถี่ของ CID เพื่อหาเคสที่คนไข้มาตรวจซ้ำในวันเดียวกัน
    const cidCounts = {};
    hosxpData.forEach(p => {
        const cid = String(p.cid || '').trim();
        if (cid) {
            cidCounts[cid] = (cidCounts[cid] || 0) + 1;
        }
    });

    // 3. วนลูปข้อมูล HOSxP เพื่อกำหนดสถานะสีและจับคู่เคลมโค้ด
    return hosxpData.map(patient => {
        const cid = String(patient.cid || '').trim();
        const nhso = excelMap[cid];

        let color = 'RED'; // เริ่มต้นที่สีแดง (ไม่พบข้อมูลใน Excel)
        let authenStatus = false;
        let endpointStatus = false;
        let authenCode = null;
        let authenCodeType = null;
        let checkClaimcode = 'ยังไม่ได้นำเข้า';

        if (nhso) {
            authenCode = nhso.authenCode;
            authenCodeType = nhso.channel;
            authenStatus = !!authenCode; // มี Authen Code ถือว่าเปิดแล้ว
            endpointStatus = nhso.isEndpointClosed;

            if (authenStatus && endpointStatus) {
                color = 'GREEN'; // ครบถ้วน
            } else if (authenStatus && !endpointStatus) {
                color = 'YELLOW'; // เปิด Authen แล้วแต่ยังไม่ปิด Endpoint
            }
        }

        // วิเคราะห์สถานะจับคู่เคลมโค้ด (เลียนแบบ Logic ใน Grafana)
        if (cid && cidCounts[cid] > 1) {
            checkClaimcode = 'ตรวจสอบ';
        } else if (authenCode) {
            // เปรียบเทียบรหัส claim_code ใน HOSxP (patient.claim_code) กับใน Excel/NHSO (authenCode)
            const hosxpClaim = String(patient.claim_code || '').trim();
            const nhsoClaim = String(authenCode || '').trim();
            if (hosxpClaim && nhsoClaim && hosxpClaim === nhsoClaim) {
                checkClaimcode = 'ตรง';
            } else {
                checkClaimcode = 'ไม่ตรง';
            }
        }

        return {
            vn: patient.vn,
            hn: patient.hn,
            cid: patient.cid,
            full_name: patient.fullName,
            visit_date: patient.visitDate,
            pttype: patient.pttype,
            pcode: patient.pcode,
            uc_money: patient.uc_money,
            department: patient.department,
            staff: patient.staff || null,
            // หากพบใน Excel ให้นำค่าใหม่มาแสดง มิฉะนั้นใช้ค่าเดิมจาก HOSxP
            claim_code: authenCode || patient.claim_code,
            authen_code_type: authenCodeType || patient.pttype_note,
            pttype_note: authenCodeType || patient.pttype_note, 
            nhso_authen_code: authenCode,
            authen_status: authenStatus,
            endpoint_status: endpointStatus,
            color_status: color,
            check_claimcode: checkClaimcode
        };
    });
}
