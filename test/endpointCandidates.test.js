import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEndpointReason, isEndpointCandidate } from '../backend/endpointCandidates.js';

const base = { pcode: 'UCS', uc_money: 120, authen_code_type: 'AUTHENCODE', an: null, cid: '1234567890123' };

test('only UC visits with money, not yet endpointed and not admitted are candidates', () => {
    assert.equal(isEndpointCandidate(base), true);
    assert.equal(isEndpointCandidate({ ...base, authen_code_type: '' }), true);
    assert.equal(isEndpointCandidate({ ...base, authen_code_type: 'ENDPOINT' }), false);
    assert.equal(isEndpointCandidate({ ...base, pcode: 'SSS' }), false);
    assert.equal(isEndpointCandidate({ ...base, uc_money: 0 }), false);
    assert.equal(isEndpointCandidate({ ...base, an: '690000123' }), false);
    assert.equal(isEndpointCandidate({ ...base, cid: '12345' }), false);
});

test('reason follows age options and otherwise the configured default, never a guess', () => {
    const options = ['เด็กอายุต่ำกว่า 7 ปี', 'เด็กอายุต่ำกว่า 15 ปี', 'บัตรประจำตัวประชาชนไม่มี chip card'];
    assert.equal(chooseEndpointReason(5, options, 'บัตรประจำตัวประชาชนไม่มี chip card'), 'เด็กอายุต่ำกว่า 7 ปี');
    assert.equal(chooseEndpointReason(12, options, 'บัตรประจำตัวประชาชนไม่มี chip card'), 'เด็กอายุต่ำกว่า 15 ปี');
    assert.equal(chooseEndpointReason(40, options, 'บัตรประจำตัวประชาชนไม่มี chip card'), 'บัตรประจำตัวประชาชนไม่มี chip card');
    assert.equal(chooseEndpointReason(40, options, ''), null);
    assert.equal(chooseEndpointReason(40, options, 'ไม่มีในรายการ'), null);
});

test('telegram endpoint command: dry run by default, save only when asked, optional VN', async () => {
    const { parseEndpointCommand } = await import('../jobs/nhso-endpoint.js');
    assert.deepEqual(parseEndpointCommand('endpoint'), { dryRun: true, vn: null });
    assert.deepEqual(parseEndpointCommand('/endpoint บันทึก'), { dryRun: false, vn: null });
    assert.deepEqual(parseEndpointCommand('Endpoint บันทึก 691024085344'), { dryRun: false, vn: '691024085344' });
    assert.deepEqual(parseEndpointCommand('ปิดสิทธิ 691024085344'), { dryRun: true, vn: '691024085344' });
    assert.equal(parseEndpointCommand('ดึงข้อมูล'), null);
    assert.equal(parseEndpointCommand('endpoints'), null);
});

test('claim time is the visit time plus the fixed offset, and waits until it has passed', async () => {
    const { endpointTimes, getClaimOffsetMinutes } = await import('../backend/endpointCandidates.js');
    assert.deepEqual(endpointTimes('10:06', '10:40', 30), { service: '10:06', claim: '10:36', ready: true });
    assert.deepEqual(endpointTimes('10:06', '10:20', 30), { service: '10:06', claim: '10:36', ready: false });
    assert.deepEqual(endpointTimes('09:50:12', '11:00', 45), { service: '09:50', claim: '10:35', ready: true });
    // Late visits: the claim stays on the visit day, capped at 23:59.
    assert.deepEqual(endpointTimes('23:50', '23:59', 30), { service: '23:50', claim: '23:59', ready: true });
    assert.equal(endpointTimes('23:40', '23:45', 30).ready, false);
    assert.equal(endpointTimes(null, '10:00', 30).ready, false);
    assert.equal(getClaimOffsetMinutes('45'), 45);
    assert.equal(getClaimOffsetMinutes('abc'), 30);
});
