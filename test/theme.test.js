import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getClaimStatusPresentation,
    getColorStatusPresentation,
    getNextThemePreference,
    getSyncRunStatusPresentation,
    normalizeThemePreference,
    resolveTheme
} from '../frontend/ui.js';

test('theme preference supports system, light, and dark with a safe default', () => {
    assert.equal(normalizeThemePreference('system'), 'system');
    assert.equal(normalizeThemePreference('invalid'), 'system');
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
});

test('theme picker cycles system, light, dark', () => {
    assert.equal(getNextThemePreference('system'), 'light');
    assert.equal(getNextThemePreference('light'), 'dark');
    assert.equal(getNextThemePreference('dark'), 'system');
});

test('status presentation always includes a semantic tone and non-color cue', () => {
    assert.deepEqual(getClaimStatusPresentation('ตรง'), {
        tone: 'success', icon: 'fa-circle-check', label: 'ตรง', description: 'ข้อมูลตรงกัน'
    });
    assert.equal(getColorStatusPresentation('YELLOW').tone, 'warning');
    assert.equal(getSyncRunStatusPresentation('failed').icon, 'fa-circle-xmark');
    assert.equal(getSyncRunStatusPresentation('running').label, 'กำลังทำงาน');
});
