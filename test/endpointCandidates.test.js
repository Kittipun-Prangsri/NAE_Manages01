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
