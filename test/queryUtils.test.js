import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMultipleStatements, isReadOnlySql, replaceGrafanaMacros } from '../backend/queryUtils.js';

test('replaceGrafanaMacros expands date and hipdata macros', () => {
    const query = 'SELECT * FROM vn_stat WHERE $__timeFilter(vstdate) AND hipdata_code IN ($hipdata_code)';
    const processed = replaceGrafanaMacros(query, '2026-07-13', "'UCS','OFC'");

    assert.equal(processed, "SELECT * FROM vn_stat WHERE vstdate = '2026-07-13' AND hipdata_code IN ('UCS','OFC')");
});

test('isReadOnlySql allows read statements only', () => {
    assert.equal(isReadOnlySql('select * from visit_tracking'), true);
    assert.equal(isReadOnlySql('SHOW TABLES'), true);
    assert.equal(isReadOnlySql('EXPLAIN SELECT * FROM visit_tracking'), true);
    assert.equal(isReadOnlySql('WITH cte AS (SELECT 1) SELECT * FROM cte'), false);
    assert.equal(isReadOnlySql('UPDATE visit_tracking SET color_status = "GREEN"'), false);
    assert.equal(isReadOnlySql('SELECT * INTO OUTFILE "/tmp/export" FROM visit_tracking'), false);
    assert.equal(isReadOnlySql('/* SELECT */ DELETE FROM visit_tracking'), false);
});

test('hasMultipleStatements detects stacked SQL statements', () => {
    assert.equal(hasMultipleStatements('SELECT 1;'), false);
    assert.equal(hasMultipleStatements('SELECT 1; DELETE FROM users'), true);
});
