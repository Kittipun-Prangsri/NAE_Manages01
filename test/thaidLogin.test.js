import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dataUrlToBuffer,
    getThaidTimeoutMs,
    isPortalAuthenticatedUrl,
    isThaidExpiredUrl,
    parseThaidCountdown,
    parseThaidRefCode
} from '../jobs/thaidLogin.js';

const thaidPageText = 'เข้าสู่ระบบ\nด้วย ThaID\nหมดเวลาใน : 00:55\nหมายเลขอ้างอิง : FECY3G\n';

test('parses ThaiD countdown and reference code', () => {
    assert.equal(parseThaidCountdown(thaidPageText), 55);
    assert.equal(parseThaidCountdown('หมดเวลาใน : 01:05'), 65);
    assert.equal(parseThaidCountdown('หมดเวลาแสดง QRcode'), null);
    assert.equal(parseThaidRefCode(thaidPageText), 'FECY3G');
    assert.equal(parseThaidRefCode(''), null);
});

test('classifies portal and ThaiD URLs', () => {
    assert.equal(isPortalAuthenticatedUrl('https://authenservice.nhso.go.th/authencode/report/eclaim'), true);
    assert.equal(isPortalAuthenticatedUrl('https://authenservice.nhso.go.th/authencode/login/oauth2/code/authencode'), false);
    assert.equal(isPortalAuthenticatedUrl('https://iam.nhso.go.th/realms/nhso/protocol/openid-connect/auth'), false);
    assert.equal(isThaidExpiredUrl('https://imauth.bora.dopa.go.th/oauth2/close'), true);
    assert.equal(isThaidExpiredUrl('https://imauth.bora.dopa.go.th/oauth2/?version=2#/'), false);
});

test('decodes QR data URLs and reads timeout config', () => {
    assert.deepEqual(dataUrlToBuffer('data:image/png;base64,AQID'), Buffer.from([1, 2, 3]));
    assert.equal(dataUrlToBuffer('/screenshots/thaid_qr.png'), null);
    assert.equal(getThaidTimeoutMs('5'), 5 * 60 * 1000);
    assert.equal(getThaidTimeoutMs(undefined), 10 * 60 * 1000);
    assert.equal(getThaidTimeoutMs('0'), 10 * 60 * 1000);
});
