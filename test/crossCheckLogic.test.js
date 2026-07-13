import test from 'node:test';
import assert from 'node:assert/strict';
import { processCrossCheck } from '../backend/crossCheckLogic.js';

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
