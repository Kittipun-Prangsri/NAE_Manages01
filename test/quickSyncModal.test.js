import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('quick sync modal elements exist in index.html and app.js', () => {
    const htmlPath = path.resolve('frontend/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('id="quick-sync-modal"'), 'quick-sync-modal should exist');
    assert.ok(htmlContent.includes('id="quick-sync-trigger-btn"'), 'quick-sync-trigger-btn should exist');
    assert.ok(htmlContent.includes('id="quick-sync-sidebar-btn"'), 'quick-sync-sidebar-btn should exist');
    assert.ok(htmlContent.includes('id="quick-import-file"'), 'quick-import-file should exist');
    assert.ok(htmlContent.includes('id="quick-sync-submit-btn"'), 'quick-sync-submit-btn should exist');

    const appPath = path.resolve('frontend/app.js');
    const appContent = fs.readFileSync(appPath, 'utf8');

    assert.ok(appContent.includes('openQuickSyncModal'), 'openQuickSyncModal should exist');
    assert.ok(appContent.includes('closeQuickSyncModal'), 'closeQuickSyncModal should exist');
    assert.ok(appContent.includes("e.key === 'Escape'"), 'Escape shortcut should exist');
});
