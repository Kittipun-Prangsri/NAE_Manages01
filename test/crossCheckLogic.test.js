import test from 'node:test';
import assert from 'node:assert/strict';
import { processCrossCheck } from '../backend/crossCheckLogic.js';
import { normalizeExcelRows } from '../backend/excelMapping.js';

test('processCrossCheck marks missing NHSO data as RED', () => {
    const result = processCrossCheck([
        {
            vn: '1001',
            hn: '1',
            cid: '1111111111111',
            fullName: 'Test Patient',
            visitDate: '2026-07-13',
            pttype: 'UC',
            pcode: 'UCS',
            claim_code: null
        }
    ], []);

    assert.equal(result[0].color_status, 'RED');
    assert.equal(result[0].authen_status, false);
    assert.equal(result[0].check_claimcode, 'ยังไม่ได้นำเข้า');
});

test('processCrossCheck marks endpoint Authen Code as GREEN with matching claim', () => {
    const result = processCrossCheck([
        {
            vn: '1002',
            hn: '2',
            cid: '2222222222222',
            fullName: 'Endpoint Patient',
            visitDate: '2026-07-13',
            pttype: 'UC',
            pcode: 'UCS',
            claim_code: 'E123'
        }
    ], [
        {
            'เลขบัตร': '2222222222222',
            'CLAIM CODE': 'E123',
            'ช่องทางการขอ Authen Code': 'ENDPOINT'
        }
    ]);

    assert.equal(result[0].color_status, 'GREEN');
    assert.equal(result[0].endpoint_status, true);
    assert.equal(result[0].check_claimcode, 'ตรง');
});

test('processCrossCheck marks duplicate CID visits for review', () => {
    const hosxpData = [
        { vn: '1003', hn: '3', cid: '3333333333333', fullName: 'Dup One', visitDate: '2026-07-13', claim_code: 'E1' },
        { vn: '1004', hn: '3', cid: '3333333333333', fullName: 'Dup Two', visitDate: '2026-07-13', claim_code: 'E1' }
    ];

    const result = processCrossCheck(hosxpData, [
        { cid: '3333333333333', authenCode: 'E1', channel: 'ENDPOINT' }
    ]);

    assert.equal(result[0].check_claimcode, 'ตรวจสอบ');
    assert.equal(result[1].check_claimcode, 'ตรวจสอบ');
});

const ENDPOINT_ROW = {
    'เลขบัตร': '4444444444444',
    'CLAIM CODE': 'EP000000000001',
    'ช่องทางการขอ Authen Code': 'ENDPOINT',
    'รหัสการเข้ารับบริการ': 'E',
    'วันที่เข้ารับบริการ': '06/07/2569 09:00:00',
    'วันที่บันทึก Authen Code': '06/07/2569 10:00:00'
};
const AUTHEN_ROW = {
    ...ENDPOINT_ROW,
    'CLAIM CODE': 'PP000000000001',
    'ช่องทางการขอ Authen Code': 'AUTHENCODE',
    'วันที่บันทึก Authen Code': '06/07/2569 09:05:00'
};
// HOSxP returns vstdate as a Date at local midnight.
const patient = {
    vn: '690706090000', hn: '4', cid: '4444444444444', fullName: 'Report Patient',
    visitDate: new Date(2026, 6, 6), pcode: 'UCS', claim_code: 'EP000000000001', uc_money: 100, item_money: 250
};
const check = (rows, overrides = {}) => processCrossCheck([{ ...patient, ...overrides }], rows)[0];

test('an AUTHENCODE row without an endpoint is YELLOW', () => {
    const result = check([AUTHEN_ROW]);
    assert.equal(result.color_status, 'YELLOW');
    assert.equal(result.authen_status, true);
    assert.equal(result.endpoint_status, false);
});

test('a claim code from an unrecognised channel is YELLOW, never assumed closed', () => {
    const result = check([{ cid: patient.cid, authenCode: 'EP000000000001', channel: 'API Direct' }]);
    assert.equal(result.color_status, 'YELLOW');
});

test('channel comes from the mapped column whatever its header is', () => {
    const raw = [{ 'เลขประจำตัว': patient.cid, 'รหัส': 'EP000000000001', 'วิธีขอ': 'ENDPOINT', 'วันบริการ': '2026-07-06' }];
    const mapped = normalizeExcelRows(raw, { cid: 'เลขประจำตัว', authenCode: 'รหัส', channel: 'วิธีขอ', visitDate: 'วันบริการ' });
    assert.equal(check(mapped).color_status, 'GREEN');
});

test('a row from the direct NHSO API keeps its endpoint channel', () => {
    const result = check([{ cid: patient.cid, authenCode: 'EP000000000001', channel: 'ENDPOINT', visitDate: '2026-07-06', statusUse: 'E' }]);
    assert.equal(result.color_status, 'GREEN');
});

test('the endpoint row wins over an AUTHENCODE row in either order', () => {
    for (const rows of [[ENDPOINT_ROW, AUTHEN_ROW], [AUTHEN_ROW, ENDPOINT_ROW]]) {
        const result = check(rows);
        assert.equal(result.color_status, 'GREEN');
        assert.equal(result.nhso_authen_code, 'EP000000000001');
        assert.equal(result.check_claimcode, 'ตรง');
    }
});

test('the latest record wins between rows of the same kind', () => {
    const older = { ...AUTHEN_ROW, 'CLAIM CODE': 'PP000000000002', 'วันที่บันทึก Authen Code': '06/07/2569 08:00:00' };
    for (const rows of [[AUTHEN_ROW, older], [older, AUTHEN_ROW]]) {
        assert.equal(check(rows).nhso_authen_code, 'PP000000000001');
    }
});

test('cancelled rows are ignored', () => {
    const cancellations = [{ 'รหัสการเข้ารับบริการ': 'C' }, { 'สถานะใช้งาน': 'ยกเลิก' }, { statusUse: 'c' }];
    for (const cancellation of cancellations) {
        const cancelled = { ...ENDPOINT_ROW, ...cancellation };
        assert.equal(check([cancelled]).color_status, 'RED');
        assert.equal(check([cancelled]).nhso_authen_code, null);
        assert.equal(check([AUTHEN_ROW, cancelled]).color_status, 'YELLOW');
    }
});

test('rows for another service date are ignored', () => {
    const yesterday = { ...ENDPOINT_ROW, 'วันที่เข้ารับบริการ': '05/07/2569 09:00:00' };
    assert.equal(check([yesterday]).color_status, 'RED');
    assert.equal(check([AUTHEN_ROW, yesterday]).color_status, 'YELLOW');
});

test('service dates match across B.E./A.D. and report formats', () => {
    for (const date of ['06/07/2569 09:00:00', '2569-07-06 09:00:00', '2026-07-06', '6/7/2026']) {
        const rows = [{ ...ENDPOINT_ROW, 'วันที่เข้ารับบริการ': date }];
        assert.equal(check(rows).color_status, 'GREEN', date);
        assert.equal(check(rows, { visitDate: '2026-07-06' }).color_status, 'GREEN', date);
    }
});

test('item_money is carried through to the tracking result', () => {
    assert.equal(check([ENDPOINT_ROW]).item_money, 250);
    assert.equal(check([]).item_money, 250);
});
