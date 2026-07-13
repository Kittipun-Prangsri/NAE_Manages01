import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hasOfficerPassword, hasOpduserPassword, matchesOfficerPassword, matchesOpduserPassword } from '../backend/auth.js';

test('hasOfficerPassword detects empty HOSxP password records', () => {
    assert.equal(hasOfficerPassword({ officer_login_password: '', officer_login_password_md5: null }), false);
    assert.equal(hasOfficerPassword({ officer_login_password: 'secret', officer_login_password_md5: null }), true);
});

test('matchesOfficerPassword supports plain and md5 HOSxP fields', () => {
    const md5 = crypto.createHash('md5').update('secret').digest('hex');

    assert.equal(matchesOfficerPassword({ officer_login_password: 'secret', officer_login_password_md5: null }, 'secret'), true);
    assert.equal(matchesOfficerPassword({ officer_login_password: '', officer_login_password_md5: md5 }, 'secret'), true);
    assert.equal(matchesOfficerPassword({ officer_login_password: '', officer_login_password_md5: md5.toUpperCase() }, 'secret'), true);
    assert.equal(matchesOfficerPassword({ officer_login_password: '', officer_login_password_md5: md5 }, 'wrong'), false);
});

test('matchesOpduserPassword supports passweb md5 and password_text', () => {
    const md5 = crypto.createHash('md5').update('TT1122').digest('hex');

    assert.equal(hasOpduserPassword({ password: '', passweb: md5, password_text: '' }), true);
    assert.equal(matchesOpduserPassword({ password: '', passweb: md5, password_text: '' }, 'TT1122'), true);
    assert.equal(matchesOpduserPassword({ password: '', passweb: '', password_text: 'TT1122' }, 'TT1122'), true);
    assert.equal(matchesOpduserPassword({ password: '', passweb: md5, password_text: '' }, 'wrong'), false);
});
