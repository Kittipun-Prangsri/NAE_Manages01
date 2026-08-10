import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('standalone quick-sync.html micro-app contains required sync & import elements', () => {
    const htmlPath = path.resolve('frontend/quick-sync.html');
    assert.ok(fs.existsSync(htmlPath), 'frontend/quick-sync.html file should exist');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('id="quick-sync-form"'), 'quick-sync-form should exist');
    assert.ok(htmlContent.includes('id="visit-date"'), 'visit-date picker should exist');
    assert.ok(htmlContent.includes('id="excel-file"'), 'excel-file input should exist');
    assert.ok(htmlContent.includes('id="dropzone"'), 'dropzone area should exist');
    assert.ok(htmlContent.includes('id="submit-btn"'), 'submit sync button should exist');
    assert.ok(htmlContent.includes('id="status-terminal"'), 'status terminal feedback area should exist');
    assert.ok(htmlContent.includes("api.processSync"), 'should use api.processSync for backend sync');
    assert.ok(htmlContent.includes("api.probeDate"), 'should use api.probeDate for auto date probing');
});
